// Package testutil provides the shared in-memory fake of
// repository.RepositoryInterface plus small helpers used across the
// service, handler, and middleware test suites. It is imported only by
// _test.go files and is never linked into the Lambda binary.
package testutil

import (
	"context"
	"errors"
	"math"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
)

// FakeRepo is an in-memory fake of RepositoryInterface. Each test should
// instantiate a fresh one — no shared state. Fields are exported so tests
// can seed and assert on state directly.
//
// The atomic methods (AtomicAddExpense, etc.) compose the simpler
// primitives, modelling the real DDB transaction semantics: condition
// first (returning ErrInsufficientBalance / ErrExpenseStateMismatch on
// failure), then all mutations together.
type FakeRepo struct {
	Config     *model.Config
	Balance    *model.Balance
	Months     map[string]*model.MonthSummary
	Expenses   map[string]*model.Expense
	RateLimits map[string]*model.RateLimitEntry // keyed by sourceIP
	Sessions   map[string]*model.Session
}

func NewFakeRepo() *FakeRepo {
	return &FakeRepo{
		Months:     make(map[string]*model.MonthSummary),
		Expenses:   make(map[string]*model.Expense),
		Sessions:   make(map[string]*model.Session),
		RateLimits: make(map[string]*model.RateLimitEntry),
		Balance:    &model.Balance{TotalBalance: 0},
	}
}

var _ repository.RepositoryInterface = (*FakeRepo)(nil)

// ExpenseKey builds the composite map key used to store expenses by
// (month, SK). Mirrors the PK+SK addressing in DynamoDB.
func ExpenseKey(month, sk string) string { return month + "|" + sk }

// SeedMonth inserts a month summary with the given balances.
func SeedMonth(f *FakeRepo, month string, start, allow, expenses, ending float64) {
	f.Months[month] = &model.MonthSummary{
		Month:           month,
		StartingBalance: start,
		AllowanceAdded:  allow,
		TotalExpenses:   expenses,
		EndingBalance:   ending,
	}
}

// FmtFloat renders a float64 exactly as attributevalue marshals it into
// DynamoDB (shortest round-trip form). Cent-rounding bugs are invisible
// to tolerance-based comparison — dusty and clean values differ by ~1
// ULP — but show up plainly in this string.
func FmtFloat(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// AlmostEqual compares dollar floats with a tolerance; cent values are
// not exactly representable in float64, so direct == on arithmetic
// results is flaky by one ULP.
func AlmostEqual(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// =====================================================================
// Config
// =====================================================================

func (f *FakeRepo) GetConfig(_ context.Context) (*model.Config, error) {
	if f.Config == nil {
		return nil, nil
	}
	c := *f.Config
	return &c, nil
}

func (f *FakeRepo) SaveConfig(_ context.Context, config *model.Config) error {
	c := *config
	f.Config = &c
	return nil
}

func (f *FakeRepo) CreateConfig(_ context.Context, config *model.Config) error {
	if f.Config != nil {
		return repository.ErrConfigAlreadyExists
	}
	c := *config
	f.Config = &c
	return nil
}

// =====================================================================
// Balance
// =====================================================================

func (f *FakeRepo) GetBalance(_ context.Context) (*model.Balance, error) {
	if f.Balance == nil {
		return &model.Balance{TotalBalance: 0}, nil
	}
	b := *f.Balance
	return &b, nil
}

func (f *FakeRepo) UpdateBalance(_ context.Context, delta float64) (*model.Balance, error) {
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += delta
	b := *f.Balance
	return &b, nil
}

// =====================================================================
// Months
// =====================================================================

func (f *FakeRepo) GetMonthSummary(_ context.Context, month string) (*model.MonthSummary, error) {
	s, ok := f.Months[month]
	if !ok {
		return nil, nil
	}
	out := *s
	return &out, nil
}

func (f *FakeRepo) SaveMonthSummary(_ context.Context, summary *model.MonthSummary) error {
	s := *summary
	f.Months[summary.Month] = &s
	return nil
}

func (f *FakeRepo) UpdateMonthExpenses(_ context.Context, month string, expenseDelta float64) error {
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	s.TotalExpenses += expenseDelta
	s.EndingBalance -= expenseDelta
	return nil
}

func (f *FakeRepo) UpdateMonthAllowance(_ context.Context, month string, delta float64) error {
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	s.AllowanceAdded += delta
	s.EndingBalance += delta
	return nil
}

func (f *FakeRepo) ListAllMonths(_ context.Context) ([]model.MonthSummary, error) {
	out := make([]model.MonthSummary, 0, len(f.Months))
	for _, s := range f.Months {
		out = append(out, *s)
	}
	return out, nil
}

// =====================================================================
// Expenses
// =====================================================================

func (f *FakeRepo) AddExpense(_ context.Context, month string, expense *model.Expense) error {
	e := *expense
	e.PK = "MONTH#" + month
	f.Expenses[ExpenseKey(month, expense.SK)] = &e
	return nil
}

func (f *FakeRepo) GetExpense(_ context.Context, month string, expenseID string) (*model.Expense, error) {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	out := *e
	return &out, nil
}

func (f *FakeRepo) GetExpenses(_ context.Context, month string, _ int32, _ map[string]types.AttributeValue) ([]model.Expense, map[string]types.AttributeValue, error) {
	out := []model.Expense{}
	for k, e := range f.Expenses {
		if len(k) > len(month) && k[:len(month)] == month {
			out = append(out, *e)
		}
	}
	return out, nil, nil
}

func (f *FakeRepo) UpdateExpense(_ context.Context, month, expenseID string, amount float64, description string) (*model.Expense, error) {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	old := *e
	e.Amount = amount
	e.Description = description
	return &old, nil
}

func (f *FakeRepo) DeleteExpense(_ context.Context, month, expenseID string) (*model.Expense, error) {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	delete(f.Expenses, ExpenseKey(month, expenseID))
	out := *e
	return &out, nil
}

// =====================================================================
// Atomic operations
// =====================================================================

func (f *FakeRepo) AtomicAddExpense(_ context.Context, month string, expense *model.Expense, checkBalance bool) error {
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	if checkBalance && s.EndingBalance < expense.Amount {
		return repository.ErrInsufficientBalance
	}
	e := *expense
	e.PK = "MONTH#" + month
	f.Expenses[ExpenseKey(month, expense.SK)] = &e
	s.TotalExpenses += expense.Amount
	s.EndingBalance -= expense.Amount
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance -= expense.Amount
	return nil
}

func (f *FakeRepo) AtomicUpdateExpense(_ context.Context, month, expenseID string, oldAmount, newAmount float64, newDescription string, checkBalance bool) error {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	delta := newAmount - oldAmount
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	if checkBalance && delta > 0 && s.EndingBalance < delta {
		return repository.ErrInsufficientBalance
	}
	e.Amount = newAmount
	e.Description = newDescription
	s.TotalExpenses += delta
	s.EndingBalance -= delta
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance -= delta
	return nil
}

func (f *FakeRepo) AtomicDeleteExpense(_ context.Context, month, expenseID string, oldAmount float64) error {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	delete(f.Expenses, ExpenseKey(month, expenseID))
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	s.TotalExpenses -= oldAmount
	s.EndingBalance += oldAmount
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += oldAmount
	return nil
}

func (f *FakeRepo) AtomicCreateMonth(_ context.Context, summary *model.MonthSummary, allowance float64) error {
	if _, exists := f.Months[summary.Month]; exists {
		return repository.ErrMonthAlreadyExists
	}
	s := *summary
	f.Months[summary.Month] = &s
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += allowance
	return nil
}

func (f *FakeRepo) AtomicAddFunds(_ context.Context, month string, amount float64) error {
	s, ok := f.Months[month]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	s.AllowanceAdded += amount
	s.EndingBalance += amount
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += amount
	return nil
}

// =====================================================================
// Sessions
// =====================================================================

func (f *FakeRepo) CreateSession(_ context.Context, token string, _ int) error {
	f.Sessions[token] = &model.Session{Token: token}
	return nil
}

func (f *FakeRepo) GetSession(_ context.Context, token string) (*model.Session, error) {
	s, ok := f.Sessions[token]
	if !ok {
		return nil, nil
	}
	out := *s
	return &out, nil
}

func (f *FakeRepo) DeleteSession(_ context.Context, token string) error {
	delete(f.Sessions, token)
	return nil
}

func (f *FakeRepo) DeleteAllSessions(_ context.Context) error {
	f.Sessions = make(map[string]*model.Session)
	return nil
}

// =====================================================================
// Rate limiting (per-IP)
// =====================================================================

func (f *FakeRepo) GetRateLimitEntry(_ context.Context, sourceIP string) (*model.RateLimitEntry, error) {
	r, ok := f.RateLimits[sourceIP]
	if !ok {
		return nil, nil
	}
	out := *r
	return &out, nil
}

func (f *FakeRepo) IncrementFailedAttempts(_ context.Context, sourceIP string) (*model.RateLimitEntry, error) {
	r, ok := f.RateLimits[sourceIP]
	if !ok {
		r = &model.RateLimitEntry{}
		f.RateLimits[sourceIP] = r
	}
	r.Attempts++
	out := *r
	return &out, nil
}

func (f *FakeRepo) ClearRateLimit(_ context.Context, sourceIP string) error {
	delete(f.RateLimits, sourceIP)
	return nil
}
