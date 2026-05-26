// Package service implements the core business logic for the Passbook
// application. The expense service manages monthly budgets, expense tracking,
// fund allocation, and balance calculations. It acts as the intermediary
// between HTTP handlers and the DynamoDB repository, enforcing validation
// rules (positive amounts, description length limits, sufficient funds) and
// coordinating multi-step operations such as updating an expense amount while
// adjusting both the month summary and the global balance atomically.
package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
)

var (
	ErrInvalidAmount      = errors.New("amount must be positive")
	ErrDescriptionTooLong = errors.New("description too long (max 100 characters)")
	ErrExpenseNotFound    = errors.New("expense not found")
	ErrInsufficientFunds  = errors.New("insufficient funds")
	ErrNoChanges          = errors.New("no changes provided")
	ErrMonthExists        = errors.New("month already exists")
	ErrMonthNotFound      = errors.New("month not found")
	ErrInvalidMonth       = errors.New("invalid month format")
	ErrFundsNotPositive   = errors.New("funds amount must be positive")
	// ErrInvalidCursor is returned when a paginated endpoint receives an
	// opaque cursor that decodes but doesn't refer to a valid resume
	// point (e.g. cursorMonth not found in the current month list).
	// Handler maps to 400. Replaces the previous strings.Contains check.
	ErrInvalidCursor = errors.New("invalid pagination cursor")
)

type ExpenseService struct {
	repo              repository.RepositoryInterface
	monthlyAllowance  float64
	allowOverspending bool
	carryOverBalance  bool
}

func NewExpenseService(repo repository.RepositoryInterface, monthlyAllowance float64, allowOverspending bool, carryOverBalance bool) *ExpenseService {
	return &ExpenseService{
		repo:              repo,
		monthlyAllowance:  monthlyAllowance,
		allowOverspending: allowOverspending,
		carryOverBalance:  carryOverBalance,
	}
}

// GetCurrentMonth returns the current month key in YYYY-MM format
func GetCurrentMonth() string {
	now := time.Now()
	return fmt.Sprintf("%04d-%02d", now.Year(), now.Month())
}

// GetPreviousMonth returns the previous month key
func GetPreviousMonth(month string) string {
	t, _ := time.Parse("2006-01", month)
	prev := t.AddDate(0, -1, 0)
	return fmt.Sprintf("%04d-%02d", prev.Year(), prev.Month())
}

// Cursor helpers for pagination

// encodeCursor serializes a DynamoDB LastEvaluatedKey into a URL-safe
// base64 string that can be returned to the client as an opaque pagination
// token. Only string-typed attribute values are preserved, which is
// sufficient for the PK/SK key schema used throughout this application.
func encodeCursor(key map[string]types.AttributeValue) (string, error) {
	simple := make(map[string]string)
	for k, v := range key {
		if sv, ok := v.(*types.AttributeValueMemberS); ok {
			simple[k] = sv.Value
		}
	}
	data, err := json.Marshal(simple)
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(data), nil
}

// decodeCursor is the inverse of encodeCursor. It takes a base64-encoded
// cursor string received from the client and reconstructs the DynamoDB
// ExclusiveStartKey map needed to resume a paginated query.
func decodeCursor(cursor string) (map[string]types.AttributeValue, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, err
	}
	var simple map[string]string
	if err := json.Unmarshal(data, &simple); err != nil {
		return nil, err
	}
	key := make(map[string]types.AttributeValue)
	for k, v := range simple {
		key[k] = &types.AttributeValueMemberS{Value: v}
	}
	return key, nil
}

// GetMonthData retrieves the summary and a paginated list of expenses for
// the specified month. The limit parameter controls how many expenses are
// returned per page, and cursorStr is the opaque pagination token from a
// previous response's NextCursor field (pass empty string for the first
// page). If the month does not exist in the database, an empty summary with
// zero balances is returned rather than an error.
func (s *ExpenseService) GetMonthData(ctx context.Context, month string, limit int32, cursorStr string) (*model.MonthDataResponse, error) {
	// Get month summary (don't auto-create)
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	// If month doesn't exist, return empty summary
	if summary == nil {
		summary = &model.MonthSummary{
			Month:           month,
			StartingBalance: 0,
			AllowanceAdded:  0,
			TotalExpenses:   0,
			EndingBalance:   0,
		}
	}

	// Decode cursor if provided
	var cursor map[string]types.AttributeValue
	if cursorStr != "" {
		cursor, err = decodeCursor(cursorStr)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidCursor, err)
		}
	}

	// Get expenses for the month with pagination
	expenses, lastKey, err := s.repo.GetExpenses(ctx, month, limit, cursor)
	if err != nil {
		return nil, err
	}

	// Convert to response format
	expenseItems := make([]model.ExpenseItem, len(expenses))
	for i, exp := range expenses {
		expenseItems[i] = model.ExpenseItem{
			ID:          exp.SK,
			Amount:      exp.Amount,
			Description: exp.Description,
			CreatedAt:   exp.CreatedAt,
		}
	}

	// Get total balance
	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}

	// Encode next cursor
	nextCursor := ""
	if lastKey != nil {
		nextCursor, err = encodeCursor(lastKey)
		if err != nil {
			return nil, err
		}
	}

	return &model.MonthDataResponse{
		Month:        month,
		Summary:      summary,
		Expenses:     expenseItems,
		TotalBalance: balance.TotalBalance,
		NextCursor:   nextCursor,
	}, nil
}

// ensureMonthExists gets or creates a month summary WITHOUT adding allowance
// Allowance should be added manually via admin scripts
func (s *ExpenseService) ensureMonthExists(ctx context.Context, month string) (*model.MonthSummary, error) {
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	if summary != nil {
		return summary, nil
	}

	// Create new month summary with $0 allowance
	summary = &model.MonthSummary{
		Month:           month,
		StartingBalance: 0,
		AllowanceAdded:  0,
		TotalExpenses:   0,
		EndingBalance:   0,
	}

	if err := s.repo.SaveMonthSummary(ctx, summary); err != nil {
		return nil, err
	}

	return summary, nil
}

// AddExpense adds a new expense in a single DynamoDB transaction
// (PutExpense + UpdateMonthExpenses + UpdateBalance). Closes the
// non-atomic 3-write window that previously could leave the ledger
// in a corrupt state if the Lambda timed out mid-flight.
//
// When req.Month is set, the expense is filed against that month
// (client knows its local timezone). Empty Month falls back to the
// server's UTC current month.
//
// When the instance forbids overspending, the transaction's condition
// expression atomically checks `ending_balance >= amount`, so two
// concurrent AddExpense calls cannot both succeed at $7 each on a $10
// balance.
func (s *ExpenseService) AddExpense(ctx context.Context, req *model.AddExpenseRequest) (*model.AddExpenseResponse, error) {
	if req.Amount <= 0 || req.Amount > 99999.99 {
		return nil, ErrInvalidAmount
	}
	if len(req.Description) > 100 {
		return nil, ErrDescriptionTooLong
	}
	req.Description = strings.TrimSpace(req.Description)
	if req.Description == "" {
		req.Description = "Expense"
	}

	month, err := resolveMonth(req.Month)
	if err != nil {
		return nil, err
	}

	// Ensure month summary exists. This non-atomic create-if-missing is
	// idempotent and rare (once per month); the atomic transaction below
	// then guarantees correctness of the actual expense write.
	if _, err := s.ensureMonthExists(ctx, month); err != nil {
		return nil, err
	}

	now := time.Now()
	expense := &model.Expense{
		SK:          fmt.Sprintf("%s%d#%s", repository.ExpensePrefix, now.UnixNano(), uuid.New().String()[:8]),
		Amount:      req.Amount,
		Description: req.Description,
		CreatedAt:   now,
	}

	if err := s.repo.AtomicAddExpense(ctx, month, expense, !s.allowOverspending); err != nil {
		if errors.Is(err, repository.ErrInsufficientBalance) {
			return nil, ErrInsufficientFunds
		}
		return nil, err
	}

	// Read back the post-transaction state for an accurate response.
	updatedSummary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}

	monthBalance := 0.0
	if updatedSummary != nil {
		monthBalance = updatedSummary.EndingBalance
	}

	return &model.AddExpenseResponse{
		Success:      true,
		Expense:      expense,
		MonthBalance: monthBalance,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// resolveMonth validates the optional client-supplied month parameter.
// Empty input falls back to the server's UTC current month (legacy
// behavior — preserved for callers that haven't been updated yet).
// Any non-empty value must parse as YYYY-MM; bad formats return
// ErrInvalidMonth so clients can fail loudly.
func resolveMonth(clientMonth string) (string, error) {
	if clientMonth == "" {
		return GetCurrentMonth(), nil
	}
	if _, err := time.Parse("2006-01", clientMonth); err != nil {
		return "", ErrInvalidMonth
	}
	return clientMonth, nil
}

// UpdateExpense updates an existing expense's amount and/or description.
// Validation, read of current state, and the multi-row write
// (expense + month summary + balance) are wrapped in a single DynamoDB
// transaction with conditions to detect concurrent edits (amount
// mismatch) and overspending. Returns ErrExpenseNotFound on concurrent
// edit or stale read (the client should re-fetch and retry).
func (s *ExpenseService) UpdateExpense(ctx context.Context, month string, expenseID string, req *model.UpdateExpenseRequest) (*model.UpdateExpenseResponse, error) {
	if req.Amount == nil && req.Description == nil {
		return nil, ErrNoChanges
	}
	if req.Amount != nil {
		if *req.Amount <= 0 || *req.Amount > 99999.99 {
			return nil, ErrInvalidAmount
		}
	}
	if req.Description != nil {
		trimmed := strings.TrimSpace(*req.Description)
		req.Description = &trimmed
		if len(*req.Description) > 100 {
			return nil, ErrDescriptionTooLong
		}
	}

	currentExpense, err := s.repo.GetExpense(ctx, month, expenseID)
	if err != nil {
		return nil, err
	}
	if currentExpense == nil {
		return nil, ErrExpenseNotFound
	}

	newAmount := currentExpense.Amount
	if req.Amount != nil {
		newAmount = *req.Amount
	}
	newDescription := currentExpense.Description
	if req.Description != nil {
		newDescription = *req.Description
	}
	if newDescription == "" {
		newDescription = "Expense"
	}
	amountDelta := newAmount - currentExpense.Amount

	if amountDelta != 0 {
		// Atomic transaction with optimistic concurrency on amount.
		if err := s.repo.AtomicUpdateExpense(ctx, month, expenseID, currentExpense.Amount, newAmount, newDescription, !s.allowOverspending); err != nil {
			switch {
			case errors.Is(err, repository.ErrInsufficientBalance):
				return nil, ErrInsufficientFunds
			case errors.Is(err, repository.ErrExpenseStateMismatch):
				return nil, ErrExpenseNotFound
			default:
				return nil, err
			}
		}
	} else {
		// Description-only update doesn't touch summary/balance — single write is fine.
		oldExpense, err := s.repo.UpdateExpense(ctx, month, expenseID, newAmount, newDescription)
		if err != nil {
			return nil, err
		}
		if oldExpense == nil {
			return nil, ErrExpenseNotFound
		}
	}

	updatedSummary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}
	monthBalance := 0.0
	if updatedSummary != nil {
		monthBalance = updatedSummary.EndingBalance
	}

	return &model.UpdateExpenseResponse{
		Success: true,
		Expense: &model.ExpenseItem{
			ID:          currentExpense.SK,
			Amount:      newAmount,
			Description: newDescription,
			CreatedAt:   currentExpense.CreatedAt,
		},
		MonthBalance: monthBalance,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// DeleteExpense deletes an expense and refunds the balance in a single
// transaction. The expense's amount is read first so the refund delta is
// known; the transaction conditions the delete on that amount to catch
// any concurrent edit that landed in between.
func (s *ExpenseService) DeleteExpense(ctx context.Context, month string, expenseID string) error {
	currentExpense, err := s.repo.GetExpense(ctx, month, expenseID)
	if err != nil {
		return err
	}
	if currentExpense == nil {
		return ErrExpenseNotFound
	}

	if err := s.repo.AtomicDeleteExpense(ctx, month, expenseID, currentExpense.Amount); err != nil {
		if errors.Is(err, repository.ErrExpenseStateMismatch) {
			return ErrExpenseNotFound
		}
		return err
	}
	return nil
}

// GetBalance returns the total balance
func (s *ExpenseService) GetBalance(ctx context.Context) (*model.BalanceResponse, error) {
	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}
	return &model.BalanceResponse{
		TotalBalance: balance.TotalBalance,
	}, nil
}

// ListMonths returns a paginated list of months sorted in descending order
// (most recent first). Because DynamoDB scan results are unordered, this
// method fetches all month summaries via ListAllMonths, sorts them in memory,
// and then applies cursor-based pagination. The cursorMonth parameter is the
// decoded month value (e.g. "2026-01") from a previous response's NextCursor;
// pass an empty string for the first page. The limit controls how many months
// are returned per page.
func (s *ExpenseService) ListMonths(ctx context.Context, limit int, cursorMonth string) (*model.MonthsResponse, error) {
	allMonths, err := s.repo.ListAllMonths(ctx)
	if err != nil {
		return nil, err
	}

	// Sort by month (descending - most recent first)
	sort.Slice(allMonths, func(i, j int) bool {
		return allMonths[i].Month > allMonths[j].Month
	})

	// Apply cursor: skip months until we pass the cursor.
	// If the cursorMonth doesn't appear in the list (deleted month,
	// fabricated cursor, stale copy from a long-ago response), return
	// ErrInvalidCursor instead of silently returning page 1 — that
	// behavior caused infinite-loop pagination bugs in the past.
	startIdx := 0
	if cursorMonth != "" {
		found := false
		for i, m := range allMonths {
			if m.Month == cursorMonth {
				startIdx = i + 1
				found = true
				break
			}
		}
		if !found {
			return nil, ErrInvalidCursor
		}
	}

	// Apply limit
	endIdx := len(allMonths)
	if limit > 0 && startIdx+limit < endIdx {
		endIdx = startIdx + limit
	}

	slice := allMonths[startIdx:endIdx]

	items := make([]model.MonthListItem, len(slice))
	for i, m := range slice {
		// MonthlySaved is the user-visible "delta this month" — i.e. what
		// the month contributed above (or below) its starting balance.
		// Previously this was `AllowanceAdded - TotalExpenses`, which
		// ignored StartingBalance entirely; with carry-over enabled the
		// reported number understated savings, and with overspending
		// enabled it could show "−$50 saved" for a month that ended in
		// the black thanks to the carried-over balance. Using
		// `EndingBalance - StartingBalance` is the consistent answer.
		items[i] = model.MonthListItem{
			Month:        m.Month,
			MonthlySaved: m.EndingBalance - m.StartingBalance,
		}
	}

	// Determine next cursor
	nextCursor := ""
	if endIdx < len(allMonths) && len(slice) > 0 {
		lastMonth := slice[len(slice)-1].Month
		nextCursor = base64.URLEncoding.EncodeToString([]byte(lastMonth))
	}

	return &model.MonthsResponse{
		Months:     items,
		NextCursor: nextCursor,
	}, nil
}

// CreateMonth creates a new month with the configured monthly allowance.
// The month summary write and the balance credit are wrapped in a single
// DynamoDB transaction; an attribute_not_exists condition on the put
// prevents two concurrent creates from both succeeding.
func (s *ExpenseService) CreateMonth(ctx context.Context, month string) (*model.CreateMonthResponse, error) {
	if len(month) != 7 {
		return nil, ErrInvalidMonth
	}
	if _, err := time.Parse("2006-01", month); err != nil {
		return nil, ErrInvalidMonth
	}

	prevMonth := GetPreviousMonth(month)
	prevSummary, err := s.repo.GetMonthSummary(ctx, prevMonth)
	if err != nil {
		return nil, err
	}

	startingBalance := 0.0
	if s.carryOverBalance && prevSummary != nil {
		startingBalance = prevSummary.EndingBalance
	}
	allowance := s.monthlyAllowance
	summary := &model.MonthSummary{
		Month:           month,
		StartingBalance: startingBalance,
		AllowanceAdded:  allowance,
		TotalExpenses:   0,
		EndingBalance:   startingBalance + allowance,
	}

	if err := s.repo.AtomicCreateMonth(ctx, summary, allowance); err != nil {
		if errors.Is(err, repository.ErrMonthAlreadyExists) {
			return nil, ErrMonthExists
		}
		return nil, err
	}

	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}
	return &model.CreateMonthResponse{
		Success:      true,
		Summary:      summary,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// AddFunds tops up an existing month's allowance and credits the global
// balance by the same amount in a single transaction.
func (s *ExpenseService) AddFunds(ctx context.Context, month string, amount float64) (*model.AddFundsResponse, error) {
	if amount <= 0 {
		return nil, ErrFundsNotPositive
	}

	// Pre-check existence so the user gets a precise ErrMonthNotFound
	// instead of a generic state-mismatch from the transaction.
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		return nil, ErrMonthNotFound
	}

	if err := s.repo.AtomicAddFunds(ctx, month, amount); err != nil {
		if errors.Is(err, repository.ErrExpenseStateMismatch) {
			// Month vanished between our pre-check and the transaction.
			return nil, ErrMonthNotFound
		}
		return nil, err
	}

	updatedSummary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}
	return &model.AddFundsResponse{
		Success:      true,
		Summary:      updatedSummary,
		TotalBalance: balance.TotalBalance,
	}, nil
}
