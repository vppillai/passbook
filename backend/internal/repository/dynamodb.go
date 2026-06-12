package repository

import (
	"context"
	"errors"
	"fmt"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
)

const (
	PKConfig  = "CONFIG"
	SKConfig  = "CONFIG"
	PKBalance = "BALANCE"
	SKBalance = "BALANCE"
	// Rate-limit rows are scoped per source IP: PK = "RATELIMIT#<ip>".
	// A bare "RATELIMIT#" prefix (empty ip) means the caller did not provide
	// an IP — we still serve the request but with a shared "unknown" bucket.
	RateLimitPrefix = "RATELIMIT#"
	SKRateLimit     = "RATELIMIT"
	MonthPrefix     = "MONTH#"
	SKSummary       = "SUMMARY"
	ExpensePrefix   = "EXP#"
	SessionPrefix   = "SESSION#"
	// PKMonthList is the single partition under which a copy of every
	// month summary is stored (SK = "<yyyy-mm>"). Querying this one
	// partition (sorted, paginated by the native sort key) replaces the
	// old full-table Scan in the months-list path — that scan's cost grew
	// with every expense ever written.
	PKMonthList = "MONTHLIST"

	// WebAuthn storage keys.
	//   WACHAL#<challenge_id> — in-flight ceremony session (TTL row).
	//   WACRED#<credID-b64url> — a stored credential (PK=SK).
	//   WACREDLIST — single partition mirroring every credential
	//     (SK="<credID-b64url>") so login can enumerate all credentials
	//     with one Query, exactly like the MONTHLIST pattern.
	WebAuthnChallengePrefix  = "WACHAL#"
	WebAuthnCredentialPrefix = "WACRED#"
	PKWebAuthnCredentialList = "WACREDLIST"
)

// ErrConfigAlreadyExists is returned by CreateConfig when a CONFIG row
// already exists. SetupPIN translates this to service.ErrPINAlreadySet.
var ErrConfigAlreadyExists = errors.New("config already exists")

// ErrInsufficientBalance is returned by atomic expense methods when the
// transactional overspend check fails (ending_balance < amount). Service
// layer maps this to ErrInsufficientFunds.
var ErrInsufficientBalance = errors.New("insufficient balance")

// ErrExpenseStateMismatch is returned when an atomic update or delete
// finds the expense's amount has changed since the service read it (i.e.,
// a concurrent edit landed in between). Service layer maps to
// ErrExpenseNotFound so the client can re-fetch and try again.
var ErrExpenseStateMismatch = errors.New("expense state mismatch")

// ErrMonthAlreadyExists is returned by AtomicCreateMonth when the month
// summary already exists. Service layer maps to ErrMonthExists.
var ErrMonthAlreadyExists = errors.New("month already exists")

// ErrMonthHasExpenses is returned by AtomicDeleteMonth when the summary's
// delete condition fails — the month is missing or still has expenses
// (total_expenses != 0). Service layer maps to a 409 with a clear message.
var ErrMonthHasExpenses = errors.New("month has expenses or does not exist")

// ErrRateLimitCapReached is returned by IncrementFailedAttempts when the
// conditional increment fails because the per-IP counter is already at the
// cap. Lets the caller refuse atomically without burning Argon2 cycles (B6).
var ErrRateLimitCapReached = errors.New("rate limit cap reached")

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

// batchWriteWithRetry calls BatchWriteItem and retries any UnprocessedItems
// using exponential backoff with full jitter (up to 5 attempts, base 50 ms).
// If items remain unprocessed after all attempts, it returns an error naming
// the count. Context cancellation is respected between retries.
func (r *Repository) batchWriteWithRetry(ctx context.Context, items map[string][]types.WriteRequest) error {
	const maxAttempts = 5
	const baseDelay = 50 * time.Millisecond

	pending := items
	for attempt := 0; attempt < maxAttempts; attempt++ {
		if attempt > 0 {
			// Exponential backoff with full jitter: sleep up to base*2^attempt.
			cap := baseDelay * (1 << attempt)
			jitter := time.Duration(rand.Int64N(int64(cap)))
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(jitter):
			}
		}
		out, err := r.client.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{
			RequestItems: pending,
		})
		if err != nil {
			return err
		}
		if len(out.UnprocessedItems) == 0 {
			return nil
		}
		pending = out.UnprocessedItems
	}
	// Count total unprocessed write requests across all tables.
	total := 0
	for _, reqs := range pending {
		total += len(reqs)
	}
	return fmt.Errorf("batchWriteWithRetry: %d item(s) still unprocessed after %d attempts", total, maxAttempts)
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

	// Write the canonical MONTH#<m>/SUMMARY row and the MONTHLIST/<m>
	// index copy in a single transaction so the list never drifts from
	// the source of truth.
	listItem, err := monthListItem(summary)
	if err != nil {
		return err
	}
	_, err = r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: aws.String(r.tableName), Item: item}},
			{Put: &types.Put{TableName: aws.String(r.tableName), Item: listItem}},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to save month summary: %w", err)
	}
	return nil
}

// monthListItem builds the MONTHLIST index copy of a month summary: same
// attributes as the canonical row, but keyed PK="MONTHLIST", SK="<yyyy-mm>"
// so the list can be served by a single sorted Query instead of a Scan.
func monthListItem(summary *model.MonthSummary) (map[string]types.AttributeValue, error) {
	copy := *summary
	copy.PK = PKMonthList
	copy.SK = summary.Month
	item, err := attributevalue.MarshalMap(&copy)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal month list item: %w", err)
	}
	return item, nil
}

// monthListPut returns a TransactWriteItem that upserts the MONTHLIST copy
// of a summary. Used by AtomicCreateMonth so the index gets its first copy
// inside the same transaction as the canonical row.
func (r *Repository) monthListPut(summary *model.MonthSummary) (types.TransactWriteItem, error) {
	item, err := monthListItem(summary)
	if err != nil {
		return types.TransactWriteItem{}, err
	}
	return types.TransactWriteItem{Put: &types.Put{TableName: aws.String(r.tableName), Item: item}}, nil
}

// monthListUpdate mirrors an incremental summary Update onto the MONTHLIST
// index row for the same month. The MONTHLIST copy carries identical
// attribute names (total_expenses, ending_balance, allowance_added,
// updated_at), so the same UpdateExpression and values apply unchanged.
// The condition is attribute_exists(PK): the MONTHLIST copy is created
// alongside the canonical row (SaveMonthSummary / AtomicCreateMonth), and on
// legacy tables that predate the mirror the service back-fills it via
// EnsureMonthListMirror immediately before the mutation transaction — so for
// any month that can be mutated the copy is guaranteed to exist.
func (r *Repository) monthListUpdate(month, updateExpr string, values map[string]types.AttributeValue) types.TransactWriteItem {
	return types.TransactWriteItem{Update: &types.Update{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKMonthList},
			"SK": &types.AttributeValueMemberS{Value: month},
		},
		UpdateExpression:          aws.String(updateExpr),
		ConditionExpression:       aws.String("attribute_exists(PK)"),
		ExpressionAttributeValues: values,
	}}
}

// EnsureMonthListMirror guarantees the MONTHLIST mirror row (PK="MONTHLIST",
// SK="<yyyy-mm>") exists for a month before any mutation transaction that
// delta-updates it runs. On live tables written before the MONTHLIST scheme
// existed, the canonical MONTH#<m>/SUMMARY row has no mirror, so the
// attribute_exists(PK) condition on monthListUpdate would cancel the whole
// transaction (→ 500). This back-fills the single missing mirror first:
//
//  1. Point-read the mirror. If present, nothing to do.
//  2. Otherwise read the canonical summary and conditional-Put a full copy
//     of it (attribute_not_exists(PK)). The full-copy Put — never an
//     if_not_exists arithmetic seed — means the mirror carries every
//     attribute (starting/ending/allowance/total_expenses), so a later
//     delta update composes against correct values instead of corrupting
//     the month list with a partial row.
//
// Races are tolerated: if a concurrent caller created the mirror between our
// read and our Put, the conditional Put fails its condition and we treat the
// mirror as present (the concurrent copy is equally valid). A missing
// canonical summary is also tolerated (returns nil) — the caller's mutation
// transaction will then fail its own attribute_exists check with a precise
// error rather than this helper masking it.
func (r *Repository) EnsureMonthListMirror(ctx context.Context, month string) error {
	mirror, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: PKMonthList},
			"SK": &types.AttributeValueMemberS{Value: month},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to read month list mirror: %w", err)
	}
	if mirror.Item != nil {
		return nil
	}

	summary, err := r.GetMonthSummary(ctx, month)
	if err != nil {
		return err
	}
	if summary == nil {
		// No canonical row to mirror. Let the caller's transaction surface
		// the missing-month condition rather than fabricating a mirror.
		return nil
	}

	listItem, err := monthListItem(summary)
	if err != nil {
		return err
	}
	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(r.tableName),
		Item:                listItem,
		ConditionExpression: aws.String("attribute_not_exists(PK)"),
	})
	if err != nil {
		var condErr *types.ConditionalCheckFailedException
		if errors.As(err, &condErr) {
			// Lost the race; another caller created the mirror. Fine.
			return nil
		}
		return fmt.Errorf("failed to create month list mirror: %w", err)
	}
	return nil
}

// ListMonths returns one page of month summaries from the MONTHLIST index
// partition, sorted descending by month (most recent first) via the native
// sort key — no full-table Scan. limit caps the page size (0 means the
// DynamoDB default). cursor is a DynamoDB ExclusiveStartKey from a previous
// page (nil for the first page). Returns the page, the LastEvaluatedKey for
// the next page (nil when exhausted), and any error.
func (r *Repository) ListMonths(ctx context.Context, limit int32, cursor map[string]types.AttributeValue) ([]model.MonthSummary, map[string]types.AttributeValue, error) {
	input := &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		KeyConditionExpression: aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: PKMonthList},
		},
		ScanIndexForward: aws.Bool(false), // most recent first
	}
	if limit > 0 {
		input.Limit = aws.Int32(limit)
	}
	if cursor != nil {
		input.ExclusiveStartKey = cursor
	}

	result, err := r.client.Query(ctx, input)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list months: %w", err)
	}

	var months []model.MonthSummary
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &months); err != nil {
		return nil, nil, fmt.Errorf("failed to unmarshal months: %w", err)
	}
	return months, result.LastEvaluatedKey, nil
}

// listAllMonthsLegacy performs the old full-table Scan over the canonical
// MONTH#<m>/SUMMARY rows. Retained ONLY as the one-time lazy-migration
// source for tables written before the MONTHLIST index existed: when a
// MONTHLIST Query returns nothing, the service falls back to this scan and
// backfills the index (see BackfillMonthList). After backfill, the scan is
// never hit again.
func (r *Repository) listAllMonthsLegacy(ctx context.Context) ([]model.MonthSummary, error) {
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

// ListAllMonthsLegacy is the exported entry point the service layer uses
// for the one-time lazy migration fallback when the MONTHLIST partition is
// empty. See listAllMonthsLegacy.
func (r *Repository) ListAllMonthsLegacy(ctx context.Context) ([]model.MonthSummary, error) {
	return r.listAllMonthsLegacy(ctx)
}

// BackfillMonthList writes a MONTHLIST index copy for each supplied summary
// (idempotent upsert). Called once by the service when a ListMonths query
// found an empty MONTHLIST partition but the legacy scan found canonical
// rows — so subsequent list calls hit the Query path. Batched in chunks of
// 25 (BatchWriteItem limit).
func (r *Repository) BackfillMonthList(ctx context.Context, summaries []model.MonthSummary) error {
	for i := 0; i < len(summaries); i += 25 {
		end := i + 25
		if end > len(summaries) {
			end = len(summaries)
		}
		writes := make([]types.WriteRequest, 0, end-i)
		for j := i; j < end; j++ {
			s := summaries[j]
			item, err := monthListItem(&s)
			if err != nil {
				return err
			}
			writes = append(writes, types.WriteRequest{
				PutRequest: &types.PutRequest{Item: item},
			})
		}
		if err := r.batchWriteWithRetry(ctx, map[string][]types.WriteRequest{
			r.tableName: writes,
		}); err != nil {
			return fmt.Errorf("failed to backfill month list: %w", err)
		}
	}
	return nil
}

// Expense operations

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
			if err := r.batchWriteWithRetry(ctx, map[string][]types.WriteRequest{
				r.tableName: writes,
			}); err != nil {
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

// IncrementFailedAttempts atomically bumps the per-IP failed-attempt
// counter, but ONLY while it is still below maxAttempts. The conditional
// `attempts < :max` (with attribute_not_exists for the first failure)
// closes the check-then-increment race (B6): two parallel attempts that
// both read attempts=4 can no longer both succeed to 6 — the second
// write's condition re-evaluates against the just-incremented value and
// fails. A failed condition means the cap was already reached; the method
// returns ErrRateLimitCapReached so the caller can refuse without burning
// Argon2 cycles. The 15-minute window TTL is only (re)set when the counter
// is actually incremented, so it tracks the first failure of the window.
func (r *Repository) IncrementFailedAttempts(ctx context.Context, sourceIP string, maxAttempts int) (*model.RateLimitEntry, error) {
	now := time.Now()
	ttl := now.Add(15 * time.Minute).Unix() // 15-minute window

	result, err := r.client.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: rateLimitPK(sourceIP)},
			"SK": &types.AttributeValueMemberS{Value: SKRateLimit},
		},
		UpdateExpression:    aws.String("SET attempts = if_not_exists(attempts, :zero) + :one, updated_at = :now, #ttl = :ttl"),
		ConditionExpression: aws.String("attribute_not_exists(attempts) OR attempts < :max"),
		ExpressionAttributeNames: map[string]string{
			"#ttl": "ttl",
		},
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":zero": &types.AttributeValueMemberN{Value: "0"},
			":one":  &types.AttributeValueMemberN{Value: "1"},
			":max":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", maxAttempts)},
			":now":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", now.Unix())},
			":ttl":  &types.AttributeValueMemberN{Value: fmt.Sprintf("%d", ttl)},
		},
		ReturnValues: types.ReturnValueAllNew,
	})
	if err != nil {
		var condErr *types.ConditionalCheckFailedException
		if errors.As(err, &condErr) {
			return nil, ErrRateLimitCapReached
		}
		return nil, fmt.Errorf("failed to increment failed attempts: %w", err)
	}

	var entry model.RateLimitEntry
	if err := attributevalue.UnmarshalMap(result.Attributes, &entry); err != nil {
		return nil, fmt.Errorf("failed to unmarshal rate limit entry: %w", err)
	}
	return &entry, nil
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

// =====================================================================
// WebAuthn operations
// =====================================================================
//
// All WebAuthn methods use only Get/Put/Delete/Query — no new SDK
// operation class is introduced (the IAM policy already grants these for
// the existing session/rate-limit/month paths).

// PutWebAuthnChallenge stores the in-flight ceremony session under
// PK=SK="WACHAL#<challengeID>" with a DynamoDB TTL ttlSeconds out. The
// short TTL self-cleans abandoned ceremonies and bounds the replay window.
func (r *Repository) PutWebAuthnChallenge(ctx context.Context, challengeID, sessionData string, ttlSeconds int) error {
	now := time.Now()
	pk := WebAuthnChallengePrefix + challengeID
	entry := model.WebAuthnChallenge{
		PK:          pk,
		SK:          pk,
		SessionData: sessionData,
		CreatedAt:   now.Unix(),
		TTL:         now.Add(time.Duration(ttlSeconds) * time.Second).Unix(),
	}
	item, err := attributevalue.MarshalMap(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal webauthn challenge: %w", err)
	}
	_, err = r.client.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(r.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("failed to save webauthn challenge: %w", err)
	}
	return nil
}

// GetWebAuthnChallenge fetches a stored ceremony session by ID. Returns
// nil (no error) when the row is absent or has passed its TTL (DynamoDB's
// TTL sweep is lazy, so the explicit expiry check mirrors GetSession).
func (r *Repository) GetWebAuthnChallenge(ctx context.Context, challengeID string) (*model.WebAuthnChallenge, error) {
	pk := WebAuthnChallengePrefix + challengeID
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get webauthn challenge: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}
	var entry model.WebAuthnChallenge
	if err := attributevalue.UnmarshalMap(result.Item, &entry); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webauthn challenge: %w", err)
	}
	if entry.TTL < time.Now().Unix() {
		return nil, nil
	}
	return &entry, nil
}

// DeleteWebAuthnChallenge removes a ceremony session, enforcing single-use.
func (r *Repository) DeleteWebAuthnChallenge(ctx context.Context, challengeID string) error {
	pk := WebAuthnChallengePrefix + challengeID
	_, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to delete webauthn challenge: %w", err)
	}
	return nil
}

// webAuthnCredentialListItem builds the WACREDLIST mirror copy of a
// credential: same attributes as the canonical row but keyed
// PK="WACREDLIST", SK="<credID-b64url>" so login can enumerate every
// credential with a single sorted Query.
func webAuthnCredentialListItem(cred *model.WebAuthnCredential) (map[string]types.AttributeValue, error) {
	copy := *cred
	copy.PK = PKWebAuthnCredentialList
	copy.SK = cred.CredentialID
	item, err := attributevalue.MarshalMap(&copy)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal webauthn credential list item: %w", err)
	}
	return item, nil
}

// PutWebAuthnCredential writes the canonical WACRED#<id> row and the
// WACREDLIST mirror in a single transaction so the enumeration index never
// drifts from the source of truth (mirrors SaveMonthSummary's dual-write).
func (r *Repository) PutWebAuthnCredential(ctx context.Context, cred *model.WebAuthnCredential) error {
	pk := WebAuthnCredentialPrefix + cred.CredentialID
	cred.PK = pk
	cred.SK = pk
	if cred.CreatedAt == 0 {
		cred.CreatedAt = time.Now().Unix()
	}
	item, err := attributevalue.MarshalMap(cred)
	if err != nil {
		return fmt.Errorf("failed to marshal webauthn credential: %w", err)
	}
	listItem, err := webAuthnCredentialListItem(cred)
	if err != nil {
		return err
	}
	_, err = r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{TableName: aws.String(r.tableName), Item: item}},
			{Put: &types.Put{TableName: aws.String(r.tableName), Item: listItem}},
		},
	})
	if err != nil {
		return fmt.Errorf("failed to save webauthn credential: %w", err)
	}
	return nil
}

// GetWebAuthnCredential fetches a single credential by its base64url ID.
// Returns nil (no error) when absent.
func (r *Repository) GetWebAuthnCredential(ctx context.Context, credentialID string) (*model.WebAuthnCredential, error) {
	pk := WebAuthnCredentialPrefix + credentialID
	result, err := r.client.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(r.tableName),
		Key: map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: pk},
			"SK": &types.AttributeValueMemberS{Value: pk},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to get webauthn credential: %w", err)
	}
	if result.Item == nil {
		return nil, nil
	}
	var cred model.WebAuthnCredential
	if err := attributevalue.UnmarshalMap(result.Item, &cred); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webauthn credential: %w", err)
	}
	return &cred, nil
}

// ListWebAuthnCredentials enumerates every stored credential via a single
// Query over the WACREDLIST partition — no full-table Scan.
func (r *Repository) ListWebAuthnCredentials(ctx context.Context) ([]model.WebAuthnCredential, error) {
	result, err := r.client.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(r.tableName),
		KeyConditionExpression: aws.String("PK = :pk"),
		ExpressionAttributeValues: map[string]types.AttributeValue{
			":pk": &types.AttributeValueMemberS{Value: PKWebAuthnCredentialList},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to list webauthn credentials: %w", err)
	}
	var creds []model.WebAuthnCredential
	if err := attributevalue.UnmarshalListOfMaps(result.Items, &creds); err != nil {
		return nil, fmt.Errorf("failed to unmarshal webauthn credentials: %w", err)
	}
	return creds, nil
}

// DeleteAllWebAuthnCredentials removes every stored credential: the
// WACREDLIST mirrors enumerate the set, then each canonical row and its
// mirror are deleted. Uses only Query + DeleteItem (no BatchWriteItem) so
// no new IAM action is required; the credential count per single-user
// instance is tiny (one or two), so per-item deletes are fine.
func (r *Repository) DeleteAllWebAuthnCredentials(ctx context.Context) error {
	creds, err := r.ListWebAuthnCredentials(ctx)
	if err != nil {
		return err
	}
	for _, cred := range creds {
		pk := WebAuthnCredentialPrefix + cred.CredentialID
		if _, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(r.tableName),
			Key: map[string]types.AttributeValue{
				"PK": &types.AttributeValueMemberS{Value: pk},
				"SK": &types.AttributeValueMemberS{Value: pk},
			},
		}); err != nil {
			return fmt.Errorf("failed to delete webauthn credential: %w", err)
		}
		if _, err := r.client.DeleteItem(ctx, &dynamodb.DeleteItemInput{
			TableName: aws.String(r.tableName),
			Key: map[string]types.AttributeValue{
				"PK": &types.AttributeValueMemberS{Value: PKWebAuthnCredentialList},
				"SK": &types.AttributeValueMemberS{Value: cred.CredentialID},
			},
		}); err != nil {
			return fmt.Errorf("failed to delete webauthn credential mirror: %w", err)
		}
	}
	return nil
}

// =====================================================================
// Atomic (TransactWriteItems) operations
// =====================================================================
//
// Each multi-row ledger mutation now executes inside a single DynamoDB
// transaction so that a Lambda timeout, throttle, or retry mid-flight
// can no longer leave the ledger in a state where the expense row
// exists but the balance is unchanged (or vice versa).
//
// Conditional checks on the month-summary update double as concurrency
// guards:
//   • `ending_balance >= :delta` enforces non-overspending when the
//     instance forbids it. A parallel AddExpense that drops the balance
//     below the requested amount will fail its transaction rather than
//     succeed and leave the ledger negative.
//   • `amount = :oldAmount` on the expense's update or delete catches a
//     concurrent edit landing between the service's read and the
//     transact — surfaces as ErrExpenseStateMismatch.
//
// TransactWriteItems uses 2x WCU vs separate writes. At this app's
// traffic (a family of four) the cost difference is rounding error.

// txCanceledReasons unwraps the first ConditionalCheckFailed reason from
// a TransactionCanceledException. Returns the zero index and false if
// not a transaction cancellation.
func txConditionFailedIndex(err error) (int, bool) {
	var canceled *types.TransactionCanceledException
	if !errors.As(err, &canceled) {
		return 0, false
	}
	for i, reason := range canceled.CancellationReasons {
		if reason.Code != nil && *reason.Code == "ConditionalCheckFailed" {
			return i, true
		}
	}
	return 0, false
}

// AtomicAddExpense puts the expense row and updates the month summary +
// global balance in a single transaction. If checkBalance is true, the
// month summary update is conditioned on ending_balance >= amount; on
// failure, returns ErrInsufficientBalance.
func (r *Repository) AtomicAddExpense(ctx context.Context, month string, expense *model.Expense, checkBalance bool) error {
	expense.PK = MonthPrefix + month
	expenseItem, err := attributevalue.MarshalMap(expense)
	if err != nil {
		return fmt.Errorf("failed to marshal expense: %w", err)
	}
	pkMonth := MonthPrefix + month
	nowStr := time.Now().Format(time.RFC3339)
	amountStr := fmt.Sprintf("%.2f", expense.Amount)
	negAmountStr := fmt.Sprintf("%.2f", -expense.Amount)

	monthCondition := "attribute_exists(PK)"
	if checkBalance {
		monthCondition = "attribute_exists(PK) AND ending_balance >= :amount"
	}

	summaryExpr := "SET total_expenses = total_expenses + :amount, ending_balance = ending_balance - :amount, updated_at = :now"
	summaryValues := map[string]types.AttributeValue{
		":amount": &types.AttributeValueMemberN{Value: amountStr},
		":now":    &types.AttributeValueMemberS{Value: nowStr},
	}
	listValues := map[string]types.AttributeValue{
		":amount": &types.AttributeValueMemberN{Value: amountStr},
		":now":    &types.AttributeValueMemberS{Value: nowStr},
	}

	_, err = r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{
				TableName: aws.String(r.tableName),
				Item:      expenseItem,
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: pkMonth},
					"SK": &types.AttributeValueMemberS{Value: SKSummary},
				},
				UpdateExpression:          aws.String(summaryExpr),
				ConditionExpression:       aws.String(monthCondition),
				ExpressionAttributeValues: summaryValues,
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKBalance},
					"SK": &types.AttributeValueMemberS{Value: SKBalance},
				},
				UpdateExpression: aws.String("SET total_balance = if_not_exists(total_balance, :zero) + :delta, updated_at = :now"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":delta": &types.AttributeValueMemberN{Value: negAmountStr},
					":zero":  &types.AttributeValueMemberN{Value: "0"},
					":now":   &types.AttributeValueMemberS{Value: nowStr},
				},
			}},
			r.monthListUpdate(month, summaryExpr, listValues),
		},
	})
	if err != nil {
		if idx, ok := txConditionFailedIndex(err); ok && idx == 1 {
			// Index 1 is the month-summary update — overspend or summary missing.
			return ErrInsufficientBalance
		}
		return fmt.Errorf("failed to add expense atomically: %w", err)
	}
	return nil
}

// AtomicUpdateExpense updates the expense's amount/description and adjusts
// the month summary + global balance by the supplied delta in a single
// transaction. The expense update is conditioned on `amount = :oldAmount`
// to detect concurrent edits → ErrExpenseStateMismatch on mismatch.
// If amountDelta > 0 and checkBalance is true, the month summary update
// is also conditioned on ending_balance >= delta → ErrInsufficientBalance.
func (r *Repository) AtomicUpdateExpense(ctx context.Context, month string, expenseID string, oldAmount, newAmount float64, newDescription string, checkBalance bool) error {
	pkMonth := MonthPrefix + month
	nowStr := time.Now().Format(time.RFC3339)
	// Format :oldAmount as the shortest round-trip of the value actually
	// read from DynamoDB, NOT "%.2f". Legacy rows written before
	// cent-rounding can hold e.g. 12.349999; "%.2f" would render "12.35",
	// the amount = :oldAmount condition would never match, and that
	// expense could never be edited or deleted (perpetual mismatch).
	oldAmountStr := strconv.FormatFloat(oldAmount, 'f', -1, 64)
	newAmountStr := fmt.Sprintf("%.2f", newAmount)
	delta := newAmount - oldAmount
	deltaStr := fmt.Sprintf("%.2f", delta)
	negDeltaStr := fmt.Sprintf("%.2f", -delta)

	monthCondition := "attribute_exists(PK)"
	if checkBalance && delta > 0 {
		monthCondition = "attribute_exists(PK) AND ending_balance >= :delta"
	}

	summaryExpr := "SET total_expenses = total_expenses + :delta, ending_balance = ending_balance - :delta, updated_at = :now"
	summaryValues := map[string]types.AttributeValue{
		":delta": &types.AttributeValueMemberN{Value: deltaStr},
		":now":   &types.AttributeValueMemberS{Value: nowStr},
	}
	listValues := map[string]types.AttributeValue{
		":delta": &types.AttributeValueMemberN{Value: deltaStr},
		":now":   &types.AttributeValueMemberS{Value: nowStr},
	}

	_, err := r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: pkMonth},
					"SK": &types.AttributeValueMemberS{Value: expenseID},
				},
				UpdateExpression:    aws.String("SET amount = :newAmount, description = :desc"),
				ConditionExpression: aws.String("attribute_exists(PK) AND begins_with(SK, :expensePrefix) AND amount = :oldAmount"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":newAmount":     &types.AttributeValueMemberN{Value: newAmountStr},
					":oldAmount":     &types.AttributeValueMemberN{Value: oldAmountStr},
					":desc":          &types.AttributeValueMemberS{Value: newDescription},
					":expensePrefix": &types.AttributeValueMemberS{Value: ExpensePrefix},
				},
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: pkMonth},
					"SK": &types.AttributeValueMemberS{Value: SKSummary},
				},
				UpdateExpression:          aws.String(summaryExpr),
				ConditionExpression:       aws.String(monthCondition),
				ExpressionAttributeValues: summaryValues,
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKBalance},
					"SK": &types.AttributeValueMemberS{Value: SKBalance},
				},
				UpdateExpression: aws.String("SET total_balance = if_not_exists(total_balance, :zero) + :balanceDelta, updated_at = :now"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":balanceDelta": &types.AttributeValueMemberN{Value: negDeltaStr},
					":zero":         &types.AttributeValueMemberN{Value: "0"},
					":now":          &types.AttributeValueMemberS{Value: nowStr},
				},
			}},
			r.monthListUpdate(month, summaryExpr, listValues),
		},
	})
	if err != nil {
		if idx, ok := txConditionFailedIndex(err); ok {
			switch idx {
			case 0:
				return ErrExpenseStateMismatch
			case 1:
				return ErrInsufficientBalance
			}
		}
		return fmt.Errorf("failed to update expense atomically: %w", err)
	}
	return nil
}

// AtomicDeleteExpense deletes the expense row and refunds the month
// summary + global balance in a single transaction. The delete is
// conditioned on `amount = :oldAmount` so a concurrent edit between
// the service's read and the transact surfaces as ErrExpenseStateMismatch.
func (r *Repository) AtomicDeleteExpense(ctx context.Context, month string, expenseID string, oldAmount float64) error {
	pkMonth := MonthPrefix + month
	nowStr := time.Now().Format(time.RFC3339)
	// Shortest round-trip of the value actually read — see AtomicUpdateExpense
	// for why "%.2f" would orphan legacy unrounded amounts (B7).
	oldAmountStr := strconv.FormatFloat(oldAmount, 'f', -1, 64)
	negAmountStr := strconv.FormatFloat(-oldAmount, 'f', -1, 64)

	summaryExpr := "SET total_expenses = total_expenses - :amount, ending_balance = ending_balance + :amount, updated_at = :now"
	summaryValues := map[string]types.AttributeValue{
		":amount": &types.AttributeValueMemberN{Value: oldAmountStr},
		":now":    &types.AttributeValueMemberS{Value: nowStr},
	}
	listValues := map[string]types.AttributeValue{
		":amount": &types.AttributeValueMemberN{Value: oldAmountStr},
		":now":    &types.AttributeValueMemberS{Value: nowStr},
	}

	_, err := r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Delete: &types.Delete{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: pkMonth},
					"SK": &types.AttributeValueMemberS{Value: expenseID},
				},
				ConditionExpression: aws.String("attribute_exists(PK) AND begins_with(SK, :expensePrefix) AND amount = :oldAmount"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":expensePrefix": &types.AttributeValueMemberS{Value: ExpensePrefix},
					":oldAmount":     &types.AttributeValueMemberN{Value: oldAmountStr},
				},
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: pkMonth},
					"SK": &types.AttributeValueMemberS{Value: SKSummary},
				},
				UpdateExpression:          aws.String(summaryExpr),
				ConditionExpression:       aws.String("attribute_exists(PK)"),
				ExpressionAttributeValues: summaryValues,
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKBalance},
					"SK": &types.AttributeValueMemberS{Value: SKBalance},
				},
				// Refund: subtract a negative = add the amount.
				UpdateExpression: aws.String("SET total_balance = if_not_exists(total_balance, :zero) - :neg, updated_at = :now"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":neg":  &types.AttributeValueMemberN{Value: negAmountStr},
					":zero": &types.AttributeValueMemberN{Value: "0"},
					":now":  &types.AttributeValueMemberS{Value: nowStr},
				},
			}},
			r.monthListUpdate(month, summaryExpr, listValues),
		},
	})
	if err != nil {
		if _, ok := txConditionFailedIndex(err); ok {
			return ErrExpenseStateMismatch
		}
		return fmt.Errorf("failed to delete expense atomically: %w", err)
	}
	return nil
}

// AtomicCreateMonth puts a new month summary and credits the global
// balance by the allowance amount in a single transaction. The put is
// conditioned on `attribute_not_exists(PK)` so concurrent creates can't
// both succeed → ErrMonthAlreadyExists on the loser.
func (r *Repository) AtomicCreateMonth(ctx context.Context, summary *model.MonthSummary, allowance float64) error {
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
	nowStr := time.Now().Format(time.RFC3339)
	allowanceStr := fmt.Sprintf("%.2f", allowance)

	listPut, err := r.monthListPut(summary)
	if err != nil {
		return err
	}

	_, err = r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{
				TableName:           aws.String(r.tableName),
				Item:                item,
				ConditionExpression: aws.String("attribute_not_exists(PK)"),
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKBalance},
					"SK": &types.AttributeValueMemberS{Value: SKBalance},
				},
				UpdateExpression: aws.String("SET total_balance = if_not_exists(total_balance, :zero) + :delta, updated_at = :now"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":delta": &types.AttributeValueMemberN{Value: allowanceStr},
					":zero":  &types.AttributeValueMemberN{Value: "0"},
					":now":   &types.AttributeValueMemberS{Value: nowStr},
				},
			}},
			listPut,
		},
	})
	if err != nil {
		if idx, ok := txConditionFailedIndex(err); ok && idx == 0 {
			return ErrMonthAlreadyExists
		}
		return fmt.Errorf("failed to create month atomically: %w", err)
	}
	return nil
}

// AtomicAddFunds credits the month summary and the global balance by the
// same amount in a single transaction. The month summary update is
// conditioned on attribute_exists(PK) — returns a wrapped error if the
// month doesn't exist (caller maps to ErrMonthNotFound via lookup).
func (r *Repository) AtomicAddFunds(ctx context.Context, month string, amount float64) error {
	pkMonth := MonthPrefix + month
	nowStr := time.Now().Format(time.RFC3339)
	amountStr := fmt.Sprintf("%.2f", amount)

	summaryExpr := "SET allowance_added = allowance_added + :amount, ending_balance = ending_balance + :amount, updated_at = :now"
	summaryValues := map[string]types.AttributeValue{
		":amount": &types.AttributeValueMemberN{Value: amountStr},
		":now":    &types.AttributeValueMemberS{Value: nowStr},
	}
	listValues := map[string]types.AttributeValue{
		":amount": &types.AttributeValueMemberN{Value: amountStr},
		":now":    &types.AttributeValueMemberS{Value: nowStr},
	}

	_, err := r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: pkMonth},
					"SK": &types.AttributeValueMemberS{Value: SKSummary},
				},
				UpdateExpression:          aws.String(summaryExpr),
				ConditionExpression:       aws.String("attribute_exists(PK)"),
				ExpressionAttributeValues: summaryValues,
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKBalance},
					"SK": &types.AttributeValueMemberS{Value: SKBalance},
				},
				UpdateExpression: aws.String("SET total_balance = if_not_exists(total_balance, :zero) + :delta, updated_at = :now"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":delta": &types.AttributeValueMemberN{Value: amountStr},
					":zero":  &types.AttributeValueMemberN{Value: "0"},
					":now":   &types.AttributeValueMemberS{Value: nowStr},
				},
			}},
			r.monthListUpdate(month, summaryExpr, listValues),
		},
	})
	if err != nil {
		if _, ok := txConditionFailedIndex(err); ok {
			// Month summary doesn't exist (or some other conditional). The
			// service layer typically pre-checks existence; wrapping as a
			// state mismatch is safe.
			return ErrExpenseStateMismatch
		}
		return fmt.Errorf("failed to add funds atomically: %w", err)
	}
	return nil
}

// maxTransactItems is DynamoDB's hard cap of 100 items per
// TransactWriteItems call. PropagateLaterMonthDeltas chunks against it.
const maxTransactItems = 100

// PropagateLaterMonthDeltas shifts starting_balance and ending_balance by
// the same delta on every month in `months`, applying a conditional DELTA
// update (SET ... = ... + :d with attribute_exists(PK)) to BOTH the
// canonical MONTH#<m>/SUMMARY row and its MONTHLIST mirror. All updates are
// batched into a single TransactWriteItems so propagation is all-or-nothing
// and the deltas compose with concurrent writes to those months instead of
// clobbering them (the previous unconditioned full-object Put discarded any
// concurrent mutation that landed between the service's read and its write).
//
// Each month contributes two items (canonical + mirror); to stay within the
// 100-item transaction cap the work is chunked so each chunk holds at most
// 50 months. The caller is responsible for ensuring each month's mirror row
// already exists (via EnsureMonthListMirror) — these are conditional delta
// updates, not upserts, so a missing mirror would cancel the transaction.
//
// Residual gap: this runs in a SEPARATE transaction from the originating
// mutation (DynamoDB's 100-item limit makes a single mega-transaction
// infeasible as the month count grows). If the process crashes after the
// mutation commits but before (or between chunks of) this call, later
// months' carried balances are left stale. The mutation itself is never
// lost. Because the updates are now composable deltas (not snapshots),
// re-running propagation would re-apply — so callers must not retry this
// blindly; recovery is a one-shot recompute, out of scope here.
func (r *Repository) PropagateLaterMonthDeltas(ctx context.Context, months []string, delta float64) error {
	if len(months) == 0 || delta == 0 {
		return nil
	}
	nowStr := time.Now().Format(time.RFC3339)
	deltaStr := strconv.FormatFloat(delta, 'f', -1, 64)
	// if_not_exists guards: very old rows (pre-carry-over app versions) may
	// lack starting_balance/ending_balance, and DynamoDB rejects arithmetic
	// on a missing attribute, which would cancel the whole transaction.
	expr := aws.String("SET starting_balance = if_not_exists(starting_balance, :zero) + :d, ending_balance = if_not_exists(ending_balance, :zero) + :d, updated_at = :now")

	// Two transact items per month → chunk so 2*chunk <= maxTransactItems.
	const monthsPerChunk = maxTransactItems / 2
	for start := 0; start < len(months); start += monthsPerChunk {
		end := start + monthsPerChunk
		if end > len(months) {
			end = len(months)
		}
		items := make([]types.TransactWriteItem, 0, (end-start)*2)
		for _, m := range months[start:end] {
			values := map[string]types.AttributeValue{
				":d":    &types.AttributeValueMemberN{Value: deltaStr},
				":zero": &types.AttributeValueMemberN{Value: "0"},
				":now":  &types.AttributeValueMemberS{Value: nowStr},
			}
			items = append(items, types.TransactWriteItem{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: MonthPrefix + m},
					"SK": &types.AttributeValueMemberS{Value: SKSummary},
				},
				UpdateExpression:          expr,
				ConditionExpression:       aws.String("attribute_exists(PK)"),
				ExpressionAttributeValues: values,
			}})
			items = append(items, types.TransactWriteItem{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKMonthList},
					"SK": &types.AttributeValueMemberS{Value: m},
				},
				UpdateExpression:          expr,
				ConditionExpression:       aws.String("attribute_exists(PK)"),
				ExpressionAttributeValues: values,
			}})
		}
		_, err := r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
			TransactItems: items,
		})
		if err != nil {
			return fmt.Errorf("failed to propagate later-month deltas: %w", err)
		}
	}
	return nil
}

// CreateMonthSummaryIfAbsent puts a fresh month summary (canonical row +
// MONTHLIST copy) only if the canonical row does not already exist. On a
// concurrent create the loser gets ErrMonthAlreadyExists and the service
// re-reads the winner. This replaces ensureMonthExists's old
// Get-then-unconditional-Put, which could clobber a month another request
// created in the gap and permanently desync month vs balance (B2). No
// global balance credit happens here — an auto-created month carries $0
// allowance.
func (r *Repository) CreateMonthSummaryIfAbsent(ctx context.Context, summary *model.MonthSummary) error {
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
	listItem, err := monthListItem(summary)
	if err != nil {
		return err
	}

	_, err = r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Put: &types.Put{
				TableName:           aws.String(r.tableName),
				Item:                item,
				ConditionExpression: aws.String("attribute_not_exists(PK)"),
			}},
			{Put: &types.Put{TableName: aws.String(r.tableName), Item: listItem}},
		},
	})
	if err != nil {
		if idx, ok := txConditionFailedIndex(err); ok && idx == 0 {
			return ErrMonthAlreadyExists
		}
		return fmt.Errorf("failed to create month summary: %w", err)
	}
	return nil
}

// AtomicDeleteMonth removes a month: it deletes the canonical summary row
// and its MONTHLIST copy and debits the global balance by allowanceAdded,
// all in one transaction. The summary delete is conditioned on
// total_expenses = :zero (and attribute_exists) so a month that still has
// expenses cannot be deleted — the caller maps that to a 409. allowanceAdded
// is formatted as the shortest round-trip of the value read from the summary.
func (r *Repository) AtomicDeleteMonth(ctx context.Context, month string, allowanceAdded float64) error {
	pkMonth := MonthPrefix + month
	nowStr := time.Now().Format(time.RFC3339)
	allowanceStr := strconv.FormatFloat(allowanceAdded, 'f', -1, 64)

	_, err := r.client.TransactWriteItems(ctx, &dynamodb.TransactWriteItemsInput{
		TransactItems: []types.TransactWriteItem{
			{Delete: &types.Delete{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: pkMonth},
					"SK": &types.AttributeValueMemberS{Value: SKSummary},
				},
				ConditionExpression: aws.String("attribute_exists(PK) AND total_expenses = :zero"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":zero": &types.AttributeValueMemberN{Value: "0"},
				},
			}},
			{Delete: &types.Delete{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKMonthList},
					"SK": &types.AttributeValueMemberS{Value: month},
				},
			}},
			{Update: &types.Update{
				TableName: aws.String(r.tableName),
				Key: map[string]types.AttributeValue{
					"PK": &types.AttributeValueMemberS{Value: PKBalance},
					"SK": &types.AttributeValueMemberS{Value: SKBalance},
				},
				UpdateExpression: aws.String("SET total_balance = if_not_exists(total_balance, :zero) - :allowance, updated_at = :now"),
				ExpressionAttributeValues: map[string]types.AttributeValue{
					":allowance": &types.AttributeValueMemberN{Value: allowanceStr},
					":zero":      &types.AttributeValueMemberN{Value: "0"},
					":now":       &types.AttributeValueMemberS{Value: nowStr},
				},
			}},
		},
	})
	if err != nil {
		if idx, ok := txConditionFailedIndex(err); ok && idx == 0 {
			// Summary delete condition failed: month missing or still has
			// expenses. Caller distinguishes via a pre-read.
			return ErrMonthHasExpenses
		}
		return fmt.Errorf("failed to delete month atomically: %w", err)
	}
	return nil
}
