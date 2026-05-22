package repository

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
)

// RepositoryInterface is the contract the service layer depends on. The
// concrete *Repository struct implements every method here; tests can
// swap in an in-memory fake to exercise service logic without DynamoDB.
//
// This indirection is the single 30-minute refactor the test-engineer
// review identified as the prerequisite for unit-testing the service
// layer at all (the constructors previously took *Repository directly,
// so a test had no way to inject a fake).
type RepositoryInterface interface {
	// Config
	GetConfig(ctx context.Context) (*model.Config, error)
	SaveConfig(ctx context.Context, config *model.Config) error
	CreateConfig(ctx context.Context, config *model.Config) error

	// Balance
	GetBalance(ctx context.Context) (*model.Balance, error)
	UpdateBalance(ctx context.Context, delta float64) (*model.Balance, error)

	// Months
	GetMonthSummary(ctx context.Context, month string) (*model.MonthSummary, error)
	SaveMonthSummary(ctx context.Context, summary *model.MonthSummary) error
	UpdateMonthExpenses(ctx context.Context, month string, expenseDelta float64) error
	UpdateMonthAllowance(ctx context.Context, month string, fundsDelta float64) error
	ListAllMonths(ctx context.Context) ([]model.MonthSummary, error)

	// Expenses (non-atomic — used by atomic helpers + a few simple paths)
	AddExpense(ctx context.Context, month string, expense *model.Expense) error
	GetExpense(ctx context.Context, month string, expenseID string) (*model.Expense, error)
	GetExpenses(ctx context.Context, month string, limit int32, cursor map[string]types.AttributeValue) ([]model.Expense, map[string]types.AttributeValue, error)
	UpdateExpense(ctx context.Context, month string, expenseID string, amount float64, description string) (*model.Expense, error)
	DeleteExpense(ctx context.Context, month string, expenseID string) (*model.Expense, error)

	// Atomic (TransactWriteItems) operations — service's preferred path
	// for any multi-row mutation. See dynamodb.go for rationale.
	AtomicAddExpense(ctx context.Context, month string, expense *model.Expense, checkBalance bool) error
	AtomicUpdateExpense(ctx context.Context, month string, expenseID string, oldAmount, newAmount float64, newDescription string, checkBalance bool) error
	AtomicDeleteExpense(ctx context.Context, month string, expenseID string, oldAmount float64) error
	AtomicCreateMonth(ctx context.Context, summary *model.MonthSummary, allowance float64) error
	AtomicAddFunds(ctx context.Context, month string, amount float64) error

	// Sessions
	CreateSession(ctx context.Context, token string, ttlHours int) error
	GetSession(ctx context.Context, token string) (*model.Session, error)
	DeleteSession(ctx context.Context, token string) error
	DeleteAllSessions(ctx context.Context) error

	// Rate limiting — per-IP scoping (PK = "RATELIMIT#<ip>").
	GetRateLimitEntry(ctx context.Context, sourceIP string) (*model.RateLimitEntry, error)
	IncrementFailedAttempts(ctx context.Context, sourceIP string) (*model.RateLimitEntry, error)
	SetLockout(ctx context.Context, sourceIP string, lockoutMinutes int) error
	ClearRateLimit(ctx context.Context, sourceIP string) error
}

// Compile-time assertion that the concrete Repository implements the interface.
var _ RepositoryInterface = (*Repository)(nil)
