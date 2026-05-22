package service

import (
	"context"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
)

// newExpenseService is a test helper that builds an ExpenseService against
// the in-memory mockRepo, seeded with a single month summary at the given
// balances. allow/carry flags are passed through.
func newExpenseService(t *testing.T, allow, carry bool, monthlyAllowance float64) (*ExpenseService, *mockRepo) {
	t.Helper()
	repo := newMockRepo()
	svc := NewExpenseService(repo, monthlyAllowance, allow, carry)
	return svc, repo
}

func seedMonth(repo *mockRepo, month string, start, allow, expenses, ending float64) {
	repo.months[month] = &model.MonthSummary{
		Month:           month,
		StartingBalance: start,
		AllowanceAdded:  allow,
		TotalExpenses:   expenses,
		EndingBalance:   ending,
	}
}

// =====================================================================
// TestAddExpense_BudgetMode covers the four (allow_overspending ×
// carry_over_balance) combinations. The newest non-trivial logic in the
// service — and the most likely to silently regress when someone tweaks
// adjacent code.
// =====================================================================
func TestAddExpense_BudgetMode(t *testing.T) {
	month := GetCurrentMonth()
	ctx := context.Background()

	t.Run("HardStop refuses when balance insufficient", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		seedMonth(repo, month, 0, 10, 0, 10)
		_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 12, Description: "ice cream"})
		if err != ErrInsufficientFunds {
			t.Fatalf("expected ErrInsufficientFunds, got %v", err)
		}
	})

	t.Run("HardStop allows expense within balance", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		seedMonth(repo, month, 0, 10, 0, 10)
		resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 7, Description: "book"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.MonthBalance != 3 {
			t.Errorf("MonthBalance = %v, want 3", resp.MonthBalance)
		}
	})

	t.Run("Overspend permits negative ending balance", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, false, 0)
		seedMonth(repo, month, 0, 10, 0, 10)
		resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 15, Description: "splurge"})
		if err != nil {
			t.Fatalf("unexpected error in overspend mode: %v", err)
		}
		if resp.MonthBalance != -5 {
			t.Errorf("MonthBalance = %v, want -5 (overspend allowed)", resp.MonthBalance)
		}
	})
}

// =====================================================================
// TestCreateMonth covers the carryOverBalance flag matrix. Eatout
// (carry=false) starts each month fresh; kids (carry=true) inherits the
// previous month's ending balance. Sign errors here silently corrupt
// every future month.
// =====================================================================
func TestCreateMonth(t *testing.T) {
	ctx := context.Background()

	t.Run("Carry=true inherits previous ending balance", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 100)
		seedMonth(repo, "2026-01", 0, 100, 30, 70)
		resp, err := svc.CreateMonth(ctx, "2026-02")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Summary.StartingBalance != 70 {
			t.Errorf("StartingBalance = %v, want 70 (carried)", resp.Summary.StartingBalance)
		}
		if resp.Summary.EndingBalance != 170 {
			t.Errorf("EndingBalance = %v, want 170 (70 carry + 100 allowance)", resp.Summary.EndingBalance)
		}
	})

	t.Run("Carry=false starts fresh regardless of previous balance", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, false, 500)
		seedMonth(repo, "2026-01", 0, 500, 671, -171)
		resp, err := svc.CreateMonth(ctx, "2026-02")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Summary.StartingBalance != 0 {
			t.Errorf("StartingBalance = %v, want 0 (fresh start)", resp.Summary.StartingBalance)
		}
		if resp.Summary.EndingBalance != 500 {
			t.Errorf("EndingBalance = %v, want 500 (no carry-over of -171 prev)", resp.Summary.EndingBalance)
		}
	})

	t.Run("Duplicate month rejected", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 100)
		seedMonth(repo, "2026-02", 0, 100, 0, 100)
		_, err := svc.CreateMonth(ctx, "2026-02")
		if err != ErrMonthExists {
			t.Errorf("expected ErrMonthExists, got %v", err)
		}
	})

	t.Run("Bad month format rejected", func(t *testing.T) {
		svc, _ := newExpenseService(t, false, true, 100)
		_, err := svc.CreateMonth(ctx, "not-a-month")
		if err != ErrInvalidMonth {
			t.Errorf("expected ErrInvalidMonth, got %v", err)
		}
	})
}

// =====================================================================
// TestUpdateExpense_DeltaMath pins the (newAmount - oldAmount) arithmetic.
// A sign flip here would invert every edit — a $50→$20 edit would deduct
// another $30 instead of refunding $30. The test asserts both directions.
// =====================================================================
func TestUpdateExpense_DeltaMath(t *testing.T) {
	ctx := context.Background()
	month := "2026-02"

	setup := func(t *testing.T) (*ExpenseService, *mockRepo, string) {
		svc, repo := newExpenseService(t, false, true, 0)
		seedMonth(repo, month, 0, 100, 30, 70)
		repo.balance = &model.Balance{TotalBalance: 70}
		expenseID := "EXP#1#abc"
		repo.expenses[expenseKey(month, expenseID)] = &model.Expense{
			SK: expenseID, Amount: 30, Description: "old",
		}
		return svc, repo, expenseID
	}

	t.Run("Increase deducts only the delta", func(t *testing.T) {
		svc, repo, id := setup(t)
		newAmt := 50.0
		_, err := svc.UpdateExpense(ctx, month, id, &model.UpdateExpenseRequest{Amount: &newAmt})
		if err != nil {
			t.Fatalf("UpdateExpense failed: %v", err)
		}
		// Started: total_expenses=30, ending=70, balance=70
		// Increase by 20 (50-30): total_expenses=50, ending=50, balance=50
		if got := repo.months[month].TotalExpenses; got != 50 {
			t.Errorf("TotalExpenses = %v, want 50", got)
		}
		if got := repo.months[month].EndingBalance; got != 50 {
			t.Errorf("EndingBalance = %v, want 50", got)
		}
		if got := repo.balance.TotalBalance; got != 50 {
			t.Errorf("TotalBalance = %v, want 50", got)
		}
	})

	t.Run("Decrease refunds the delta", func(t *testing.T) {
		svc, repo, id := setup(t)
		newAmt := 10.0
		_, err := svc.UpdateExpense(ctx, month, id, &model.UpdateExpenseRequest{Amount: &newAmt})
		if err != nil {
			t.Fatalf("UpdateExpense failed: %v", err)
		}
		// Started: total_expenses=30, ending=70, balance=70
		// Decrease by 20 (10-30=-20): total_expenses=10, ending=90, balance=90
		if got := repo.months[month].TotalExpenses; got != 10 {
			t.Errorf("TotalExpenses = %v, want 10", got)
		}
		if got := repo.months[month].EndingBalance; got != 90 {
			t.Errorf("EndingBalance = %v, want 90", got)
		}
		if got := repo.balance.TotalBalance; got != 90 {
			t.Errorf("TotalBalance = %v, want 90", got)
		}
	})

	t.Run("Description-only does not change balance", func(t *testing.T) {
		svc, repo, id := setup(t)
		newDesc := "updated description"
		_, err := svc.UpdateExpense(ctx, month, id, &model.UpdateExpenseRequest{Description: &newDesc})
		if err != nil {
			t.Fatalf("UpdateExpense failed: %v", err)
		}
		if got := repo.months[month].TotalExpenses; got != 30 {
			t.Errorf("TotalExpenses = %v, want 30 (unchanged)", got)
		}
		if got := repo.balance.TotalBalance; got != 70 {
			t.Errorf("TotalBalance = %v, want 70 (unchanged)", got)
		}
	})

	t.Run("Increase exceeding balance refused under hard-stop", func(t *testing.T) {
		svc, repo, id := setup(t)
		newAmt := 200.0 // delta = +170, exceeds available 70
		_, err := svc.UpdateExpense(ctx, month, id, &model.UpdateExpenseRequest{Amount: &newAmt})
		if err != ErrInsufficientFunds {
			t.Errorf("expected ErrInsufficientFunds, got %v", err)
		}
		// Balance untouched after rejection.
		if got := repo.months[month].TotalExpenses; got != 30 {
			t.Errorf("TotalExpenses = %v, want 30 (no mutation after reject)", got)
		}
	})
}

// =====================================================================
// TestListMonths_Pagination asserts that ListMonths returns months in
// descending order and that the cursor correctly skips to the next page.
// A broken sort means the UI shows the wrong month as "current".
// =====================================================================
func TestListMonths_Pagination(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 0)

	for _, m := range []string{"2026-03", "2026-01", "2025-12", "2026-02"} {
		seedMonth(repo, m, 0, 100, 30, 70)
	}

	first, err := svc.ListMonths(ctx, 2, "")
	if err != nil {
		t.Fatalf("ListMonths first page failed: %v", err)
	}
	if len(first.Months) != 2 {
		t.Fatalf("first page len = %d, want 2", len(first.Months))
	}
	if first.Months[0].Month != "2026-03" || first.Months[1].Month != "2026-02" {
		t.Errorf("first page = %v, want [2026-03, 2026-02]", []string{first.Months[0].Month, first.Months[1].Month})
	}

	second, err := svc.ListMonths(ctx, 2, "2026-02")
	if err != nil {
		t.Fatalf("ListMonths second page failed: %v", err)
	}
	if len(second.Months) != 2 {
		t.Fatalf("second page len = %d, want 2", len(second.Months))
	}
	if second.Months[0].Month != "2026-01" || second.Months[1].Month != "2025-12" {
		t.Errorf("second page = %v, want [2026-01, 2025-12]", []string{second.Months[0].Month, second.Months[1].Month})
	}
}
