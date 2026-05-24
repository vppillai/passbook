package repository

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
)

const (
	PKConfig     = "CONFIG"
	SKConfig     = "CONFIG"
	PKBalance    = "BALANCE"
	SKBalance    = "BALANCE"
	// Rate-limit rows are scoped per source IP: PK = "RATELIMIT#<ip>".
	// A bare "RATELIMIT#" prefix (empty ip) means the caller did not provide
	// an IP — we still serve the request but with a shared "unknown" bucket.
	RateLimitPrefix = "RATELIMIT#"
	SKRateLimit     = "RATELIMIT"
	MonthPrefix     = "MONTH#"
	SKSummary       = "SUMMARY"
	ExpensePrefix   = "EXP#"
	SessionPrefix   = "SESSION#"
)

// ErrConfigAlreadyExists is returned by CreateConfig when a CONFIG row
// already exists. SetupPIN translates this to service.ErrPINAlreadySet.
var ErrConfigAlreadyExists = errors.New("config already exists")

// rateLimitPK returns the per-IP partition key for rate-limit rows.
// Empty ip degrades to a shared "unknown" bucket — never collides with
// the legacy bare-"RATELIMIT" key that this refactor replaces.
func rateLimitPK(sourceIP string) string {
	if sourceIP == "" {
		return RateLimitPrefix + "unknown"
	}
	return RateLimitPrefix + sourceIP
}

type Repository struct {
	client    *dynamodb.Client
	tableName string
}

func NewRepository(client *dynamodb.Client, tableName string) *Repository {
	return &Repository{
		client:    client,
		tableName: tableName,
	}
}

// Config operations

func (r *Repository) GetConfig(ctx context.Context) (*model.Config, error) {
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKConfig},
			"SK": &types.AttributeValueMemberS{Value: SKConfig},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get config: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}

	var config model.Config
	if err := attributevalue.UnmarshalMap(result.Item, &config); err != nil {
		return nil, fmt.Errorf("failed to unmarshal config: %w", err)
	}
	return &config, nil
}

func (r *Repository) SaveConfig(ctx context.Context, config *model.Config) error {
	config.PK = PKConfig
	config.SK = SKConfig
	config.UpdatedAt = time.Now()
	if config.CreatedAt.IsZero() {
		config.CreatedAt = config.UpdatedAt
	}

	item, err := attributevalue.MarshalMap(config)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}
	return nil
}

// CreateConfig writes a new CONFIG row atomically, refusing if one already
// exists. Used by SetupPIN to close the first-deploy race where an adversary
// scraping new instance config from GitHub could curl /api/auth/setup before
// the owner does. ChangePIN continues to use SaveConfig for in-place update.
func (r *Repository) CreateConfig(ctx context.Context, config *model.Config) error {
	config.PK = PKConfig
	config.SK = SKConfig
	config.UpdatedAt = time.Now()
	if config.CreatedAt.IsZero() {
		config.CreatedAt = config.UpdatedAt
	}

	item, err := attributevalue.MarshalMap(config)
	if err != nil {
		return fmt.Errorf("failed to marshal config: %w", err)
	}

	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(r.tableName),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	if err != nil {
		var condErr *types.ConditionalCheckFailedException
		if errors.As(err, &condErr) {
			return ErrConfigAlreadyExists
		}
		return fmt.Errorf("failed to create config: %w", err)
	}
	return nil
}

// Balance operations

func (r *Repository) GetBalance(ctx context.Context) (*model.Balance, error) {
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKBalance},
			"SK": &types.AttributeValueMemberS{Value: SKBalance},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get balance: %w", err)
	}
	if result.Item == nil {
		return &model.Balance{TotalBalance: 0}, nil
	}

	var balance model.Balance
	if err := attributevalue.UnmarshalMap(result.Item, &balance); err != nil {
		return nil, fmt.Errorf("failed to unmarshal balance: %w", err)
	}
	return &balance, nil
}

func (r *Repository) UpdateBalance(ctx context.Context, delta float64) (*model.Balance, error) {
	result, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKBalance},
			"SK": &types.AttributeValueMemberS{Value: SKBalance},
		},
		UpdateExpression: aws.String("SET total_balance = if_not_exists(total_balance, :zero) + :delta, updated_at = :now"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":delta": &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", delta)},
			":zero":  &types.AttributeValueMemberN{Value: "0"},
			":now":   &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to update balance: %w", err)
	}

	var balance model.Balance
	if err := attributevalue.UnmarshalMap(result.Attributes, &balance); err != nil {
		return nil, fmt.Errorf("failed to unmarshal balance: %w", err)
	}
	return &balance, nil
}

// Month operations

func (r *Repository) GetMonthSummary(ctx context.Context, month string) (*model.MonthSummary, error) {
	pk := MonthPrefix + month
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: SKSummary},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get month summary: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}

	var summary model.MonthSummary
	if err := attributevalue.UnmarshalMap(result.Item, &summary); err != nil {
		return nil, fmt.Errorf("failed to unmarshal month summary: %w", err)
	}
	return &summary, nil
}

func (r *Repository) SaveMonthSummary(ctx context.Context, summary *model.MonthSummary) error {
	summary.PK = MonthPrefix + summary.Month
	summary.SK = SKSummary
	summary.UpdatedAt = time.Now()
	if summary.CreatedAt.IsZero() {
		summary.CreatedAt = summary.UpdatedAt
	}

	item, err := attributevalue.MarshalMap(summary)
	if err != nil {
		return fmt.Errorf("failed to marshal month summary: %w", err)
	}

	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("failed to save month summary: %w", err)
	}
	return nil
}

func (r *Repository) UpdateMonthExpenses(ctx context.Context, month string, expenseDelta float64) error {
	pk := MonthPrefix + month
	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: SKSummary},
		},
		UpdateExpression: aws.String("SET total_expenses = total_expenses + :delta, ending_balance = ending_balance - :delta, updated_at = :now"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":delta": &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", expenseDelta)},
			":now":   &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to update month expenses: %w", err)
	}
	return nil
}

// ListAllMonths performs a full table scan to retrieve every month summary
// item (PK begins with "MONTH#", SK equals "SUMMARY"). It handles DynamoDB
// pagination internally, collecting all pages before returning the complete
// slice. The results are returned in no guaranteed order; callers should sort
// as needed.
func (r *Repository) ListAllMonths(ctx context.Context) ([]model.MonthSummary, error) {
	var allMonths []model.MonthSummary
	var lastKey map[string]types.AttributeValue

	for {
		input := &dynamodb.ScanInput{
			TableName:        aws.String(r.tableName),
			FilterExpression: aws.String("begins_with(PK, :prefix) AND SK = :summary"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":prefix":  &types.AttributeValueMemberS{Value: MonthPrefix},
				":summary": &types.AttributeValueMemberS{Value: SKSummary},
			},
		}
		if lastKey != nil {
			input.ExclusiveStartKey = lastKey
		}

		result, err := r.client.Scan(ctx, input)
		if err != nil {
			return nil, fmt.Errorf("failed to list months: %w", err)
		}

		var months []model.MonthSummary
		if err := attributevalue.UnmarshalListOfMaps(result.Items, &months); err != nil {
			return nil, fmt.Errorf("failed to unmarshal months: %w", err)
		}
		allMonths = append(allMonths, months...)

		if result.LastEvaluatedKey == nil {
			break
		}
		lastKey = result.LastEvaluatedKey
	}

	return allMonths, nil
}

// Expense operations

func (r *Repository) AddExpense(ctx context.Context, month string, expense *model.Expense) error {
	expense.PK = MonthPrefix + month
	// SK format: EXP#<timestamp>#<uuid> - already set by caller

	item, err := attributevalue.MarshalMap(expense)
	if err != nil {
		return fmt.Errorf("failed to marshal expense: %w", err)
	}

	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("failed to save expense: %w", err)
	}
	return nil
}

// GetExpenses queries all expenses for a given month, sorted by most recent
// first (descending sort key). It supports cursor-based pagination: pass a
// non-nil cursor from a previous call to fetch the next page. The limit
// parameter caps the number of items returned per page (0 means no limit).
// Returns the expenses, the DynamoDB LastEvaluatedKey for the next page
// (nil when there are no more results), and any error.
func (r *Repository) GetExpenses(ctx context.Context, month string, limit int32, cursor map[string]types.AttributeValue) ([]model.Expense, map[string]types.AttributeValue, error) {
	pk := MonthPrefix + month
	input := &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: pk},
			":prefix": &types.AttributeValueMemberS{Value: ExpensePrefix},
		},
		ScanIndexForward: aws.Bool(false), // Most recent first
	}

	if limit > 0 {
		input.Limit = aws.Int32(limit)
	}
	if cursor != nil {
		input.ExclusiveStartKey = cursor
	}

	result, err := r.client.Query(ctx, input)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get expenses: %w", err)
	}

	var expenses []model.Expense
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &expenses); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal expenses: %w", err)
	}
	return expenses, result.LastEvaluatedKey, nil
}

// GetExpense fetches a single expense by its month and sort key (expenseID).
// Returns nil (without error) if the expense does not exist.
func (r *Repository) GetExpense(ctx context.Context, month string, expenseID string) (*model.Expense, error) {
	pk := MonthPrefix + month
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: expenseID},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get expense: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}

	var expense model.Expense
	if err := attributevalue.UnmarshalMap(result.Item, &expense); err != nil {
		return nil, fmt.Errorf("failed to unmarshal expense: %w", err)
	}
	return &expense, nil
}

// UpdateExpense atomically updates an expense's amount and description in
// DynamoDB. The condition expression also requires SK to begin with "EXP#" —
// defense-in-depth against record-type confusion. Even if the handler-level
// prefix check is bypassed, this update cannot touch SUMMARY rows or any
// other non-expense SK in the same partition. Returns the OLD expense
// values so the caller can compute the amount delta. Returns nil (without
// error) if the expense does not exist (ConditionalCheckFailedException).
func (r *Repository) UpdateExpense(ctx context.Context, month string, expenseID string, amount float64, description string) (*model.Expense, error) {
	pk := MonthPrefix + month
	result, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: expenseID},
		},
		UpdateExpression:    aws.String("SET amount = :amount, description = :desc"),
		ConditionExpression: aws.String("attribute_exists(PK) AND begins_with(SK, :expensePrefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":amount":        &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", amount)},
			":desc":          &types.AttributeValueMemberS{Value: description},
			":expensePrefix": &types.AttributeValueMemberS{Value: ExpensePrefix},
		},
		ReturnValues: types.ReturnValueAllOld,
	})
	if err != nil {
		var condErr *types.ConditionalCheckFailedException
		if errors.As(err, &condErr) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to update expense: %w", err)
	}

	var oldExpense model.Expense
	if err := attributevalue.UnmarshalMap(result.Attributes, &oldExpense); err != nil {
		return nil, fmt.Errorf("failed to unmarshal old expense: %w", err)
	}
	return &oldExpense, nil
}

// UpdateMonthAllowance atomically increments a month's allowance_added and
// ending_balance by fundsDelta. This is used when adding supplemental funds
// to an existing month. The condition expression ensures the month summary
// item exists before the update is applied.
func (r *Repository) UpdateMonthAllowance(ctx context.Context, month string, fundsDelta float64) error {
	pk := MonthPrefix + month
	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: SKSummary},
		},
		UpdateExpression:    aws.String("SET allowance_added = allowance_added + :delta, ending_balance = ending_balance + :delta, updated_at = :now"),
		ConditionExpression: aws.String("attribute_exists(PK)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":delta": &types.AttributeValueMemberN{Value: fmt.Sprintf("%.2f", fundsDelta)},
			":now":   &types.AttributeValueMemberS{Value: time.Now().Format(time.RFC3339)},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to update month allowance: %w", err)
	}
	return nil
}

// DeleteExpense removes an expense row. The condition expression requires
// SK to begin with "EXP#" — defense-in-depth against record-type confusion
// so the expense API cannot delete SUMMARY rows or other non-expense SKs.
// Returns the deleted expense (for caller bookkeeping), nil if the row
// did not exist or did not satisfy the condition.
func (r *Repository) DeleteExpense(ctx context.Context, month string, expenseID string) (*model.Expense, error) {
	pk := MonthPrefix + month
	result, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: expenseID},
		},
		ConditionExpression: aws.String("begins_with(SK, :expensePrefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":expensePrefix": &types.AttributeValueMemberS{Value: ExpensePrefix},
		},
		ReturnValues: types.ReturnValueAllOld,
	})
	if err != nil {
		var condErr *types.ConditionalCheckFailedException
		if errors.As(err, &condErr) {
			return nil, nil
		}
		return nil, fmt.Errorf("failed to delete expense: %w", err)
	}
	if result.Attributes == nil {
		return nil, nil
	}

	var expense model.Expense
	if err := attributevalue.UnmarshalMap(result.Attributes, &expense); err != nil {
		return nil, fmt.Errorf("failed to unmarshal expense: %w", err)
	}
	return &expense, nil
}

// Session operations

func (r *Repository) CreateSession(ctx context.Context, token string, ttlHours int) error {
	now := time.Now()
	session := model.Session{
		PK:        SessionPrefix + token,
		SK:        SessionPrefix + token,
		Token:     token,
		CreatedAt: now.Unix(),
		TTL:       now.Add(time.Duration(ttlHours) * time.Hour).Unix(),
	}

	item, err := attributevalue.MarshalMap(session)
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}

	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("failed to save session: %w", err)
	}
	return nil
}

func (r *Repository) GetSession(ctx context.Context, token string) (*model.Session, error) {
	pk := SessionPrefix + token
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}

	var session model.Session
	if err := attributevalue.UnmarshalMap(result.Item, &session); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session: %w", err)
	}

	// Check if expired (in case TTL hasn't kicked in yet)
	if session.TTL < time.Now().Unix() {
		return nil, nil
	}

	return &session, nil
}

func (r *Repository) DeleteSession(ctx context.Context, token string) error {
	pk := SessionPrefix + token
	_, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to delete session: %w", err)
	}
	return nil
}

// DeleteAllSessions removes every SESSION# row in the table. Called by
// ChangePIN so that a stolen token cannot survive a PIN rotation.
// Implemented as a Scan + BatchWriteItem loop (25 items per batch).
// For a single-user family app the session-row count is tiny so this
// is fine; if it ever grows, replace with a GSI on entity_type.
func (r *Repository) DeleteAllSessions(ctx context.Context) error {
	var lastKey map[string]types.AttributeValue
	for {
		scanResult, err := r.client.Scan(ctx, &dynamodb.ScanInput{
			TableName:            aws.String(r.tableName),
			FilterExpression:     aws.String("begins_with(PK, :prefix)"),
			ProjectionExpression: aws.String("PK, SK"),
			ExpressionAttributeValues: map[string]types.AttributeValue{
				":prefix": &types.AttributeValueMemberS{Value: SessionPrefix},
			},
			ExclusiveStartKey: lastKey,
		})
		if err != nil {
			return fmt.Errorf("failed to scan sessions: %w", err)
		}

		// Batch delete in chunks of 25 (DynamoDB BatchWriteItem limit).
		for i := 0; i < len(scanResult.Items); i += 25 {
			end := i + 25
			if end > len(scanResult.Items) {
				end = len(scanResult.Items)
			}
			writes := make([]types.WriteRequest, 0, end-i)
			for _, item := range scanResult.Items[i:end] {
				writes = append(writes, types.WriteRequest{
					DeleteRequest: &types.DeleteRequest{
						Key: map[string]types.AttributeValue{
							"PK": item["PK"],
							"SK": item["SK"],
						},
					},
				})
			}
			_, err := r.client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
				RequestItems: map[string][]types.WriteRequest{
					r.tableName: writes,
				},
			})
			if err != nil {
				return fmt.Errorf("failed to batch delete sessions: %w", err)
			}
		}

		if scanResult.LastEvaluatedKey == nil {
			return nil
		}
		lastKey = scanResult.LastEvaluatedKey
	}
}

// Rate limiting operations
//
// All rate-limit methods take a sourceIP parameter that scopes the
// counter to that client. Two attackers from different IPs get
// independent counters, so one cannot lock the legitimate family out.
// The empty string degrades to a shared "unknown" bucket (used when
// the request did not include an authoritative IP).

func (r *Repository) GetRateLimitEntry(ctx context.Context, sourceIP string) (*model.RateLimitEntry, error) {
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: rateLimitPK(sourceIP)},
			"SK": &types.AttributeValueMemberS{Value: SKRateLimit},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get rate limit entry: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}

	var entry model.RateLimitEntry
	if err := attributevalue.UnmarshalMap(result.Item, &entry); err != nil {
		return nil, fmt.Errorf("failed to unmarshal rate limit entry: %w", err)
	}

	// Check if expired
	if entry.TTL < time.Now().Unix() {
		return nil, nil
	}

	return &entry, nil
}

func (r *Repository) IncrementFailedAttempts(ctx context.Context, sourceIP string) (*model.RateLimitEntry, error) {
	now := time.Now()
	ttl := now.Add(15 * time.Minute).Unix() // 15-minute window

	result, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: rateLimitPK(sourceIP)},
			"SK": &types.AttributeValueMemberS{Value: SKRateLimit},
		},
		UpdateExpression: aws.String("SET attempts = if_not_exists(attempts, :zero) + :one, updated_at = :now, #ttl = :ttl"),
		ExpressionAttributeNames: map[string]string{
			"#ttl": "ttl",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":zero": &types.AttributeValueMemberN{Value: "0"},
			":one":  &types.AttributeValueMemberN{Value: "1"},
			":now":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", now.Unix())},
			":ttl":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", ttl)},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to increment failed attempts: %w", err)
	}

	var entry model.RateLimitEntry
	if err := attributevalue.UnmarshalMap(result.Attributes, &entry); err != nil {
		return nil, fmt.Errorf("failed to unmarshal rate limit entry: %w", err)
	}
	return &entry, nil
}

// SetLockout writes a hard lockout. The conditional update prevents an
// in-flight IncrementFailedAttempts from clobbering the longer lockout TTL
// with its shorter 15-minute window.
func (r *Repository) SetLockout(ctx context.Context, sourceIP string, lockoutMinutes int) error {
	now := time.Now()
	lockoutUntil := now.Add(time.Duration(lockoutMinutes) * time.Minute)

	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: rateLimitPK(sourceIP)},
			"SK": &types.AttributeValueMemberS{Value: SKRateLimit},
		},
		UpdateExpression: aws.String("SET locked_at = :locked, #ttl = :ttl, updated_at = :now"),
		ConditionExpression: aws.String("attribute_not_exists(locked_at) OR locked_at < :now"),
		ExpressionAttributeNames: map[string]string{
			"#ttl": "ttl",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":locked": &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", lockoutUntil.Unix())},
			":ttl":    &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", lockoutUntil.Unix())},
			":now":    &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", now.Unix())},
		},
	})
	if err != nil {
		// A pre-existing active lockout is fine — the caller's intent is
		// satisfied either way.
		var condErr *types.ConditionalCheckFailedException
		if errors.As(err, &condErr) {
			return nil
		}
		return fmt.Errorf("failed to set lockout: %w", err)
	}
	return nil
}

func (r *Repository) ClearRateLimit(ctx context.Context, sourceIP string) error {
	_, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: rateLimitPK(sourceIP)},
			"SK": &types.AttributeValueMemberS{Value: SKRateLimit},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to clear rate limit: %w", err)
	}
	return nil
}

// Helper to extract expense ID from SK
func ExtractExpenseID(sk string) string {
	return strings.TrimPrefix(sk, ExpensePrefix)
}
