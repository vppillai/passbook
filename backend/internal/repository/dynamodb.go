package repository

import (
	"context"
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
	PKRateLimit  = "RATELIMIT"
	SKRateLimit  = "RATELIMIT"
	MonthPrefix  = "MONTH#"
	SKSummary    = "SUMMARY"
	ExpensePrefix = "EXP#"
	SessionPrefix = "SESSION#"
)

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

func (r *Repository) ListMonths(ctx context.Context) ([]model.MonthSummary, error) {
	result, err := r.client.Scan(ctx, &dynamodb.ScanInput{
		TableName:        aws.String(r.tableName),
		FilterExpression: aws.String("begins_with(PK, :prefix) AND SK = :summary"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":prefix":  &types.AttributeValueMemberS{Value: MonthPrefix},
			":summary": &types.AttributeValueMemberS{Value: SKSummary},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list months: %w", err)
	}

	var months []model.MonthSummary
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &months); err != nil {
		return nil, fmt.Errorf("failed to unmarshal months: %w", err)
	}
	return months, nil
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

func (r *Repository) GetExpenses(ctx context.Context, month string) ([]model.Expense, error) {
	pk := MonthPrefix + month
	result, err := r.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :prefix)"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk":     &types.AttributeValueMemberS{Value: pk},
			":prefix": &types.AttributeValueMemberS{Value: ExpensePrefix},
		},
		ScanIndexForward: aws.Bool(false), // Most recent first
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get expenses: %w", err)
	}

	var expenses []model.Expense
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &expenses); err != nil {
		return nil, fmt.Errorf("failed to unmarshal expenses: %w", err)
	}
	return expenses, nil
}

func (r *Repository) DeleteExpense(ctx context.Context, month string, expenseID string) (*model.Expense, error) {
	pk := MonthPrefix + month
	result, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: expenseID},
		},
		ReturnValues: types.ReturnValueAllOld,
	})
	if err != nil {
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

// Rate limiting operations

func (r *Repository) GetRateLimitEntry(ctx context.Context) (*model.RateLimitEntry, error) {
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKRateLimit},
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

func (r *Repository) IncrementFailedAttempts(ctx context.Context) (*model.RateLimitEntry, error) {
	now := time.Now()
	ttl := now.Add(15 * time.Minute).Unix() // 15-minute window

	result, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKRateLimit},
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

func (r *Repository) SetLockout(ctx context.Context, lockoutMinutes int) error {
	now := time.Now()
	lockoutUntil := now.Add(time.Duration(lockoutMinutes) * time.Minute)

	_, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKRateLimit},
			"SK": &types.AttributeValueMemberS{Value: SKRateLimit},
		},
		UpdateExpression: aws.String("SET locked_at = :locked, #ttl = :ttl, updated_at = :now"),
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
		return fmt.Errorf("failed to set lockout: %w", err)
	}
	return nil
}

func (r *Repository) ClearRateLimit(ctx context.Context) error {
	_, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKRateLimit},
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
