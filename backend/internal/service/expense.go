package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
)

var (
	ErrInvalidAmount      = errors.New("amount must be positive")
	ErrDescriptionTooLong = errors.New("description too long (max 100 characters)")
	ErrExpenseNotFound    = errors.New("expense not found")
	ErrInsufficientFunds  = errors.New("insufficient funds")
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

// GetMonthData retrieves month summary and expenses, creating if necessary
func (s *ExpenseService) GetMonthData(ctx context.Context, month string) (*model.MonthDataResponse, error) {
	// Get or create month summary
	summary, err := s.getOrCreateMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	// Get expenses for the month
	expenses, err := s.repo.GetExpenses(ctx, month)
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

	return &model.MonthDataResponse{
		Month:        month,
		Summary:      summary,
		Expenses:     expenseItems,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// getOrCreateMonthSummary gets or creates a month summary with allowance
func (s *ExpenseService) getOrCreateMonthSummary(ctx context.Context, month string) (*model.MonthSummary, error) {
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	if summary != nil {
		return summary, nil
	}

	// Create new month summary
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

	// Create new summary with allowance
	summary = &model.MonthSummary{
		Month:           month,
		StartingBalance: startingBalance,
		AllowanceAdded:  s.monthlyAllowance,
		TotalExpenses:   0,
		EndingBalance:   startingBalance + s.monthlyAllowance,
	}

	if err := s.repo.SaveMonthSummary(ctx, summary); err != nil {
		return nil, err
	}

	// Update total balance with the allowance
	if _, err := s.repo.UpdateBalance(ctx, s.monthlyAllowance); err != nil {
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

	// Ensure month summary exists
	summary, err := s.getOrCreateMonthSummary(ctx, month)
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

// ListMonths returns all months with their ending balances
func (s *ExpenseService) ListMonths(ctx context.Context) (*model.MonthsResponse, error) {
	months, err := s.repo.ListMonths(ctx)
	if err != nil {
		return nil, err
	}

	// Sort by month (descending - most recent first)
	sort.Slice(months, func(i, j int) bool {
		return months[i].Month > months[j].Month
	})

	items := make([]model.MonthListItem, len(months))
	for i, m := range months {
		items[i] = model.MonthListItem{
			Month:         m.Month,
			EndingBalance: m.EndingBalance,
		}
	}

	return &model.MonthsResponse{
		Months: items,
	}, nil
}
