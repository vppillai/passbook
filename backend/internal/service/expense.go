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
)

type ExpenseService struct {
	repo             *repository.Repository
	monthlyAllowance float64
}

func NewExpenseService(repo *repository.Repository, monthlyAllowance float64) *ExpenseService {
	return &ExpenseService{
		repo:             repo,
		monthlyAllowance: monthlyAllowance,
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
			return nil, fmt.Errorf("invalid cursor: %w", err)
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

// AddExpense adds a new expense
func (s *ExpenseService) AddExpense(ctx context.Context, req *model.AddExpenseRequest) (*model.AddExpenseResponse, error) {
	// Validate
	if req.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if len(req.Description) > 100 {
		return nil, ErrDescriptionTooLong
	}
	if req.Description == "" {
		req.Description = "Expense"
	}

	month := GetCurrentMonth()

	// Ensure month summary exists (created with $0 allowance if new)
	summary, err := s.ensureMonthExists(ctx, month)
	if err != nil {
		return nil, err
	}

	// Check if sufficient funds
	if summary.EndingBalance < req.Amount {
		return nil, ErrInsufficientFunds
	}

	// Create expense
	now := time.Now()
	expense := &model.Expense{
		SK:          fmt.Sprintf("%s%d#%s", repository.ExpensePrefix, now.UnixNano(), uuid.New().String()[:8]),
		Amount:      req.Amount,
		Description: req.Description,
		CreatedAt:   now,
	}

	// Save expense
	if err := s.repo.AddExpense(ctx, month, expense); err != nil {
		return nil, err
	}

	// Update month summary
	if err := s.repo.UpdateMonthExpenses(ctx, month, req.Amount); err != nil {
		return nil, err
	}

	// Update total balance
	balance, err := s.repo.UpdateBalance(ctx, -req.Amount)
	if err != nil {
		return nil, err
	}

	return &model.AddExpenseResponse{
		Success:      true,
		Expense:      expense,
		MonthBalance: summary.EndingBalance - req.Amount,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// UpdateExpense updates an existing expense's amount and/or description.
// It performs the following steps:
//  1. Validates that at least one field is being changed and values are valid.
//  2. Fetches the current expense to compute the amount delta.
//  3. If the amount is increasing, verifies sufficient funds in the month.
//  4. Persists the update in DynamoDB via the repository.
//  5. Adjusts the month summary (total_expenses, ending_balance) and the
//     global balance by the computed delta.
//
// Returns ErrNoChanges if both Amount and Description are nil, ErrExpenseNotFound
// if the expense does not exist, and ErrInsufficientFunds if an amount increase
// would exceed the month's available balance.
func (s *ExpenseService) UpdateExpense(ctx context.Context, month string, expenseID string, req *model.UpdateExpenseRequest) (*model.UpdateExpenseResponse, error) {
	if req.Amount == nil && req.Description == nil {
		return nil, ErrNoChanges
	}

	if req.Amount != nil && *req.Amount <= 0 {
		return nil, ErrInvalidAmount
	}

	if req.Description != nil && len(*req.Description) > 100 {
		return nil, ErrDescriptionTooLong
	}

	// Get current expense to compute delta and fill unchanged fields
	currentExpense, err := s.repo.GetExpense(ctx, month, expenseID)
	if err != nil {
		return nil, err
	}
	if currentExpense == nil {
		return nil, ErrExpenseNotFound
	}

	// Determine new values
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

	// Calculate amount delta (positive = expense increased)
	amountDelta := newAmount - currentExpense.Amount

	// If amount increased, check sufficient funds
	if amountDelta > 0 {
		summary, err := s.repo.GetMonthSummary(ctx, month)
		if err != nil {
			return nil, err
		}
		if summary == nil {
			return nil, ErrMonthNotFound
		}
		if summary.EndingBalance < amountDelta {
			return nil, ErrInsufficientFunds
		}
	}

	// Update expense in DynamoDB
	oldExpense, err := s.repo.UpdateExpense(ctx, month, expenseID, newAmount, newDescription)
	if err != nil {
		return nil, err
	}
	if oldExpense == nil {
		return nil, ErrExpenseNotFound
	}

	// If amount changed, update month summary and total balance
	var totalBalance float64
	if amountDelta != 0 {
		if err := s.repo.UpdateMonthExpenses(ctx, month, amountDelta); err != nil {
			return nil, err
		}
		balance, err := s.repo.UpdateBalance(ctx, -amountDelta)
		if err != nil {
			return nil, err
		}
		totalBalance = balance.TotalBalance
	} else {
		balance, err := s.repo.GetBalance(ctx)
		if err != nil {
			return nil, err
		}
		totalBalance = balance.TotalBalance
	}

	// Get updated month summary for response
	updatedSummary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	return &model.UpdateExpenseResponse{
		Success: true,
		Expense: &model.ExpenseItem{
			ID:          currentExpense.SK,
			Amount:      newAmount,
			Description: newDescription,
			CreatedAt:   currentExpense.CreatedAt,
		},
		MonthBalance: updatedSummary.EndingBalance,
		TotalBalance: totalBalance,
	}, nil
}

// DeleteExpense deletes an expense and refunds the balance
func (s *ExpenseService) DeleteExpense(ctx context.Context, month string, expenseID string) error {
	// Delete and get the old expense
	expense, err := s.repo.DeleteExpense(ctx, month, expenseID)
	if err != nil {
		return err
	}
	if expense == nil {
		return ErrExpenseNotFound
	}

	// Refund: update month summary (subtract from expenses, add to balance)
	if err := s.repo.UpdateMonthExpenses(ctx, month, -expense.Amount); err != nil {
		return err
	}

	// Update total balance
	if _, err := s.repo.UpdateBalance(ctx, expense.Amount); err != nil {
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

	// Apply cursor: skip months until we pass the cursor
	startIdx := 0
	if cursorMonth != "" {
		for i, m := range allMonths {
			if m.Month == cursorMonth {
				startIdx = i + 1
				break
			}
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
		items[i] = model.MonthListItem{
			Month:        m.Month,
			MonthlySaved: m.AllowanceAdded - m.TotalExpenses,
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

// CreateMonth creates a new month with the configured monthly allowance
func (s *ExpenseService) CreateMonth(ctx context.Context, month string) (*model.CreateMonthResponse, error) {
	// Validate month format
	if len(month) != 7 {
		return nil, ErrInvalidMonth
	}
	if _, err := time.Parse("2006-01", month); err != nil {
		return nil, ErrInvalidMonth
	}

	// Check if month already exists
	existing, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return nil, ErrMonthExists
	}

	// Get previous month's ending balance as starting balance
	prevMonth := GetPreviousMonth(month)
	prevSummary, err := s.repo.GetMonthSummary(ctx, prevMonth)
	if err != nil {
		return nil, err
	}

	startingBalance := 0.0
	if prevSummary != nil {
		startingBalance = prevSummary.EndingBalance
	}

	// Create month with configured monthly allowance
	allowance := s.monthlyAllowance
	endingBalance := startingBalance + allowance

	summary := &model.MonthSummary{
		Month:           month,
		StartingBalance: startingBalance,
		AllowanceAdded:  allowance,
		TotalExpenses:   0,
		EndingBalance:   endingBalance,
	}

	if err := s.repo.SaveMonthSummary(ctx, summary); err != nil {
		return nil, err
	}

	// Update total balance (add the allowance)
	balance, err := s.repo.UpdateBalance(ctx, allowance)
	if err != nil {
		return nil, err
	}

	return &model.CreateMonthResponse{
		Success:      true,
		Summary:      summary,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// AddFunds adds funds to an existing month
func (s *ExpenseService) AddFunds(ctx context.Context, month string, amount float64) (*model.AddFundsResponse, error) {
	if amount <= 0 {
		return nil, ErrFundsNotPositive
	}

	// Verify month exists
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		return nil, ErrMonthNotFound
	}

	// Update month: add to allowance_added and ending_balance
	if err := s.repo.UpdateMonthAllowance(ctx, month, amount); err != nil {
		return nil, err
	}

	// Update total balance
	balance, err := s.repo.UpdateBalance(ctx, amount)
	if err != nil {
		return nil, err
	}

	// Re-fetch updated summary for response
	updatedSummary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	return &model.AddFundsResponse{
		Success:      true,
		Summary:      updatedSummary,
		TotalBalance: balance.TotalBalance,
	}, nil
}
