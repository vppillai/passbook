package service

import (
	"context"
	"errors"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
)

// mockRepo is an in-memory fake of RepositoryInterface used by service-
// layer unit tests. Each test instantiates a fresh one — no shared state.
//
// The fake implements the atomic methods (AtomicAddExpense, etc.) by
// composing the simpler primitives below; this keeps individual test
// state predictable without re-implementing the DDB transaction model.
type mockRepo struct {
	config     *model.Config
	balance    *model.Balance
	months     map[string]*model.MonthSummary
	expenses   map[string]*model.Expense
	rateLimits map[string]*model.RateLimitEntry // keyed by sourceIP
	sessions   map[string]*model.Session
}

func newMockRepo() *mockRepo {
	return &mockRepo{
		months:     make(map[string]*model.MonthSummary),
		expenses:   make(map[string]*model.Expense),
		sessions:   make(map[string]*model.Session),
		rateLimits: make(map[string]*model.RateLimitEntry),
		balance:    &model.Balance{TotalBalance: 0},
	}
}

var _ repository.RepositoryInterface = (*mockRepo)(nil)

// expenseKey builds the composite map key used to store expenses by
// (month, SK). Mirrors the PK+SK addressing in DynamoDB.
func expenseKey(month, sk string) string { return month + "|" + sk }

// =====================================================================
// Config
// =====================================================================

func (m *mockRepo) GetConfig(_ context.Context) (*model.Config, error) {
	if m.config == nil {
		return nil, nil
	}
	c := *m.config
	return &c, nil
}

func (m *mockRepo) SaveConfig(_ context.Context, config *model.Config) error {
	c := *config
	m.config = &c
	return nil
}

func (m *mockRepo) CreateConfig(_ context.Context, config *model.Config) error {
	if m.config != nil {
		return repository.ErrConfigAlreadyExists
	}
	c := *config
	m.config = &c
	return nil
}

// =====================================================================
// Balance
// =====================================================================

func (m *mockRepo) GetBalance(_ context.Context) (*model.Balance, error) {
	if m.balance == nil {
		return &model.Balance{TotalBalance: 0}, nil
	}
	b := *m.balance
	return &b, nil
}

func (m *mockRepo) UpdateBalance(_ context.Context, delta float64) (*model.Balance, error) {
	if m.balance == nil {
		m.balance = &model.Balance{}
	}
	m.balance.TotalBalance += delta
	b := *m.balance
	return &b, nil
}

// =====================================================================
// Months
// =====================================================================

func (m *mockRepo) GetMonthSummary(_ context.Context, month string) (*model.MonthSummary, error) {
	s, ok := m.months[month]
	if !ok {
		return nil, nil
	}
	out := *s
	return &out, nil
}

func (m *mockRepo) SaveMonthSummary(_ context.Context, summary *model.MonthSummary) error {
	s := *summary
	m.months[summary.Month] = &s
	return nil
}

func (m *mockRepo) UpdateMonthExpenses(_ context.Context, month string, expenseDelta float64) error {
	s, ok := m.months[month]
	if !ok {
		return errors.New("month not found")
	}
	s.TotalExpenses += expenseDelta
	s.EndingBalance -= expenseDelta
	return nil
}

func (m *mockRepo) UpdateMonthAllowance(_ context.Context, month string, delta float64) error {
	s, ok := m.months[month]
	if !ok {
		return errors.New("month not found")
	}
	s.AllowanceAdded += delta
	s.EndingBalance += delta
	return nil
}

func (m *mockRepo) ListAllMonths(_ context.Context) ([]model.MonthSummary, error) {
	out := make([]model.MonthSummary, 0, len(m.months))
	for _, s := range m.months {
		out = append(out, *s)
	}
	return out, nil
}

// =====================================================================
// Expenses
// =====================================================================

func (m *mockRepo) AddExpense(_ context.Context, month string, expense *model.Expense) error {
	e := *expense
	e.PK = "MONTH#" + month
	m.expenses[expenseKey(month, expense.SK)] = &e
	return nil
}

func (m *mockRepo) GetExpense(_ context.Context, month string, expenseID string) (*model.Expense, error) {
	e, ok := m.expenses[expenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	out := *e
	return &out, nil
}

func (m *mockRepo) GetExpenses(_ context.Context, month string, _ int32, _ map[string]types.AttributeValue) ([]model.Expense, map[string]types.AttributeValue, error) {
	out := []model.Expense{}
	for k, e := range m.expenses {
		if len(k) > len(month) && k[:len(month)] == month {
			out = append(out, *e)
		}
	}
	return out, nil, nil
}

func (m *mockRepo) UpdateExpense(_ context.Context, month, expenseID string, amount float64, description string) (*model.Expense, error) {
	e, ok := m.expenses[expenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	old := *e
	e.Amount = amount
	e.Description = description
	return &old, nil
}

func (m *mockRepo) DeleteExpense(_ context.Context, month, expenseID string) (*model.Expense, error) {
	e, ok := m.expenses[expenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	delete(m.expenses, expenseKey(month, expenseID))
	out := *e
	return &out, nil
}

// =====================================================================
// Atomic operations
//
// These compose the primitives above to model the real DDB transaction
// semantics: condition first (with ErrInsufficientBalance / ErrExpenseStateMismatch
// returned on failure), then apply all mutations together so the test
// can observe the post-state in one place.
// =====================================================================

func (m *mockRepo) AtomicAddExpense(_ context.Context, month string, expense *model.Expense, checkBalance bool) error {
	s, ok := m.months[month]
	if !ok {
		return errors.New("month not found")
	}
	if checkBalance && s.EndingBalance < expense.Amount {
		return repository.ErrInsufficientBalance
	}
	e := *expense
	e.PK = "MONTH#" + month
	m.expenses[expenseKey(month, expense.SK)] = &e
	s.TotalExpenses += expense.Amount
	s.EndingBalance -= expense.Amount
	if m.balance == nil {
		m.balance = &model.Balance{}
	}
	m.balance.TotalBalance -= expense.Amount
	return nil
}

func (m *mockRepo) AtomicUpdateExpense(_ context.Context, month, expenseID string, oldAmount, newAmount float64, newDescription string, checkBalance bool) error {
	e, ok := m.expenses[expenseKey(month, expenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	delta := newAmount - oldAmount
	s, ok := m.months[month]
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
	if m.balance == nil {
		m.balance = &model.Balance{}
	}
	m.balance.TotalBalance -= delta
	return nil
}

func (m *mockRepo) AtomicDeleteExpense(_ context.Context, month, expenseID string, oldAmount float64) error {
	e, ok := m.expenses[expenseKey(month, expenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	delete(m.expenses, expenseKey(month, expenseID))
	s, ok := m.months[month]
	if !ok {
		return errors.New("month not found")
	}
	s.TotalExpenses -= oldAmount
	s.EndingBalance += oldAmount
	if m.balance == nil {
		m.balance = &model.Balance{}
	}
	m.balance.TotalBalance += oldAmount
	return nil
}

func (m *mockRepo) AtomicCreateMonth(_ context.Context, summary *model.MonthSummary, allowance float64) error {
	if _, exists := m.months[summary.Month]; exists {
		return repository.ErrMonthAlreadyExists
	}
	s := *summary
	m.months[summary.Month] = &s
	if m.balance == nil {
		m.balance = &model.Balance{}
	}
	m.balance.TotalBalance += allowance
	return nil
}

func (m *mockRepo) AtomicAddFunds(_ context.Context, month string, amount float64) error {
	s, ok := m.months[month]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	s.AllowanceAdded += amount
	s.EndingBalance += amount
	if m.balance == nil {
		m.balance = &model.Balance{}
	}
	m.balance.TotalBalance += amount
	return nil
}

// =====================================================================
// Sessions
// =====================================================================

func (m *mockRepo) CreateSession(_ context.Context, token string, _ int) error {
	m.sessions[token] = &model.Session{Token: token}
	return nil
}

func (m *mockRepo) GetSession(_ context.Context, token string) (*model.Session, error) {
	s, ok := m.sessions[token]
	if !ok {
		return nil, nil
	}
	out := *s
	return &out, nil
}

func (m *mockRepo) DeleteSession(_ context.Context, token string) error {
	delete(m.sessions, token)
	return nil
}

func (m *mockRepo) DeleteAllSessions(_ context.Context) error {
	m.sessions = make(map[string]*model.Session)
	return nil
}

// =====================================================================
// Rate limiting (per-IP)
// =====================================================================

func (m *mockRepo) GetRateLimitEntry(_ context.Context, sourceIP string) (*model.RateLimitEntry, error) {
	r, ok := m.rateLimits[sourceIP]
	if !ok {
		return nil, nil
	}
	out := *r
	return &out, nil
}

func (m *mockRepo) IncrementFailedAttempts(_ context.Context, sourceIP string) (*model.RateLimitEntry, error) {
	r, ok := m.rateLimits[sourceIP]
	if !ok {
		r = &model.RateLimitEntry{}
		m.rateLimits[sourceIP] = r
	}
	r.Attempts++
	out := *r
	return &out, nil
}

func (m *mockRepo) ClearRateLimit(_ context.Context, sourceIP string) error {
	delete(m.rateLimits, sourceIP)
	return nil
}
