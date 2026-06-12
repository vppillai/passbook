package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// newExpenseService builds an ExpenseService against the shared in-memory
// FakeRepo. allow/carry flags are passed through.
func newExpenseService(t *testing.T, allow, carry bool, monthlyAllowance float64) (*ExpenseService, *testutil.FakeRepo) {
	t.Helper()
	repo := testutil.NewFakeRepo()
	svc := NewExpenseService(repo, monthlyAllowance, allow, carry)
	return svc, repo
}

// =====================================================================
// TestAddExpense_BudgetMode covers the (allow_overspending ×
// carry_over_balance) combinations — the most likely logic to silently
// regress when someone tweaks adjacent code.
// =====================================================================
func TestAddExpense_BudgetMode(t *testing.T) {
	month := GetCurrentMonth()
	ctx := context.Background()

	t.Run("HardStop refuses when balance insufficient", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedMonth(repo, month, 0, 10, 0, 10)
		_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 12, Description: "ice cream"})
		if !errors.Is(err, ErrInsufficientFunds) {
			t.Fatalf("expected ErrInsufficientFunds, got %v", err)
		}
		// U4: the rich error must carry the amount that was available.
		var insufficient *InsufficientFundsError
		if !errors.As(err, &insufficient) {
			t.Fatalf("expected *InsufficientFundsError, got %T", err)
		}
		if insufficient.Available != 10 {
			t.Errorf("Available = %v, want 10", insufficient.Available)
		}
	})

	t.Run("HardStop allows expense within balance", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedMonth(repo, month, 0, 10, 0, 10)
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
		testutil.SeedMonth(repo, month, 0, 10, 0, 10)
		resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 15, Description: "splurge"})
		if err != nil {
			t.Fatalf("unexpected error in overspend mode: %v", err)
		}
		if resp.MonthBalance != -5 {
			t.Errorf("MonthBalance = %v, want -5 (overspend allowed)", resp.MonthBalance)
		}
	})
}

// TestAddExpense_Validation pins the input rules: amount bounds,
// description length, default description, and month format.
func TestAddExpense_Validation(t *testing.T) {
	ctx := context.Background()
	month := GetCurrentMonth()

	newSeeded := func(t *testing.T) (*ExpenseService, *testutil.FakeRepo) {
		svc, repo := newExpenseService(t, true, true, 0)
		testutil.SeedMonth(repo, month, 0, 100, 0, 100)
		return svc, repo
	}

	t.Run("zero or negative amount rejected", func(t *testing.T) {
		svc, _ := newSeeded(t)
		for _, amt := range []float64{0, -5, 0.004} { // 0.004 rounds to 0.00
			if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: amt, Description: "x"}); err != ErrInvalidAmount {
				t.Errorf("amount %v: expected ErrInvalidAmount, got %v", amt, err)
			}
		}
	})

	t.Run("amount above cap rejected", func(t *testing.T) {
		svc, _ := newSeeded(t)
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 100000, Description: "x"}); err != ErrInvalidAmount {
			t.Errorf("expected ErrInvalidAmount, got %v", err)
		}
	})

	t.Run("long description rejected", func(t *testing.T) {
		svc, _ := newSeeded(t)
		long := make([]byte, 101)
		for i := range long {
			long[i] = 'a'
		}
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 1, Description: string(long)}); err != ErrDescriptionTooLong {
			t.Errorf("expected ErrDescriptionTooLong, got %v", err)
		}
	})

	t.Run("blank description defaults to Expense", func(t *testing.T) {
		svc, _ := newSeeded(t)
		resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 1, Description: "   "})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Expense.Description != "Expense" {
			t.Errorf("Description = %q, want \"Expense\"", resp.Expense.Description)
		}
	})

	t.Run("bad month format rejected", func(t *testing.T) {
		svc, _ := newSeeded(t)
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 1, Description: "x", Month: "junk"}); err != ErrInvalidMonth {
			t.Errorf("expected ErrInvalidMonth, got %v", err)
		}
	})
}

// =====================================================================
// TestCreateMonth covers the carryOverBalance flag matrix. Sign errors
// here silently corrupt every future month.
// =====================================================================
func TestCreateMonth(t *testing.T) {
	ctx := context.Background()

	t.Run("Carry=true inherits previous ending balance", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 100)
		testutil.SeedMonth(repo, "2026-01", 0, 100, 30, 70)
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
		testutil.SeedMonth(repo, "2026-01", 0, 500, 671, -171)
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
		testutil.SeedMonth(repo, "2026-02", 0, 100, 0, 100)
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

	t.Run("Allowance credits global balance", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 100)
		if _, err := svc.CreateMonth(ctx, "2026-02"); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if repo.Balance.TotalBalance != 100 {
			t.Errorf("TotalBalance = %v, want 100", repo.Balance.TotalBalance)
		}
	})
}

// =====================================================================
// TestCreateMonth_RoundsCarriedBalance replays the prod incident: May
// ended at -522.16; carrying it into June computed -522.16 + 500 in
// float64 and marshaled -22.159999999999968 into the ledger. roundCents
// must keep both the carried start and the computed ending clean.
// =====================================================================
func TestCreateMonth_RoundsCarriedBalance(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 500)
	testutil.SeedMonth(repo, "2026-05", 0, 500, 1022.16, -522.16)

	resp, err := svc.CreateMonth(ctx, "2026-06")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := testutil.FmtFloat(resp.Summary.StartingBalance); got != "-522.16" {
		t.Errorf("StartingBalance marshals as %q, want \"-522.16\"", got)
	}
	if got := testutil.FmtFloat(resp.Summary.EndingBalance); got != "-22.16" {
		t.Errorf("EndingBalance marshals as %q, want \"-22.16\"", got)
	}
}

// =====================================================================
// TestAddExpense_AutoCreatedMonth pins ensureMonthExists's carry
// behavior: an expense filed into a not-yet-created month must not
// break the carry chain when carry-over is enabled, and must still
// start from zero when it is disabled.
// =====================================================================
func TestAddExpense_AutoCreatedMonth(t *testing.T) {
	ctx := context.Background()

	t.Run("carry=true inherits previous ending", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 500)
		testutil.SeedMonth(repo, "2026-05", 0, 500, 1022.16, -522.16)

		_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 10, Description: "tacos", Month: "2026-06"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		s := repo.Months["2026-06"]
		if s == nil {
			t.Fatal("2026-06 was not auto-created")
		}
		if got := testutil.FmtFloat(s.StartingBalance); got != "-522.16" {
			t.Errorf("StartingBalance marshals as %q, want \"-522.16\"", got)
		}
		if !testutil.AlmostEqual(s.EndingBalance, -532.16) {
			t.Errorf("EndingBalance = %v, want -532.16 (carried -522.16 minus 10)", s.EndingBalance)
		}
	})

	t.Run("carry=false starts from zero", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, false, 500)
		testutil.SeedMonth(repo, "2026-05", 0, 500, 1022.16, -522.16)

		_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 10, Description: "tacos", Month: "2026-06"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		s := repo.Months["2026-06"]
		if s == nil {
			t.Fatal("2026-06 was not auto-created")
		}
		if s.StartingBalance != 0 {
			t.Errorf("StartingBalance = %v, want 0 (no carry)", s.StartingBalance)
		}
	})
}

// TestAddExpense_RoundsAmountToCents pins service-boundary rounding —
// a client sending 12.349 must not put a 3-decimal amount in the ledger
// while the summary delta rounds to 12.35 (a 0.001 drift per edit).
func TestAddExpense_RoundsAmountToCents(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 0)
	month := GetCurrentMonth()
	testutil.SeedMonth(repo, month, 0, 500, 0, 500)

	resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 12.349, Description: "x"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := testutil.FmtFloat(resp.Expense.Amount); got != "12.35" {
		t.Errorf("Amount marshals as %q, want \"12.35\"", got)
	}
}

// =====================================================================
// TestUpdateExpense_DeltaMath pins the (newAmount - oldAmount)
// arithmetic. A sign flip here would invert every edit — a $50→$20 edit
// would deduct another $30 instead of refunding $30.
// =====================================================================
func TestUpdateExpense_DeltaMath(t *testing.T) {
	ctx := context.Background()
	month := "2026-02"

	setup := func(t *testing.T) (*ExpenseService, *testutil.FakeRepo, string) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedMonth(repo, month, 0, 100, 30, 70)
		repo.Balance = &model.Balance{TotalBalance: 70}
		expenseID := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey(month, expenseID)] = &model.Expense{
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
		if got := repo.Months[month].TotalExpenses; got != 50 {
			t.Errorf("TotalExpenses = %v, want 50", got)
		}
		if got := repo.Months[month].EndingBalance; got != 50 {
			t.Errorf("EndingBalance = %v, want 50", got)
		}
		if got := repo.Balance.TotalBalance; got != 50 {
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
		if got := repo.Months[month].TotalExpenses; got != 10 {
			t.Errorf("TotalExpenses = %v, want 10", got)
		}
		if got := repo.Months[month].EndingBalance; got != 90 {
			t.Errorf("EndingBalance = %v, want 90", got)
		}
		if got := repo.Balance.TotalBalance; got != 90 {
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
		if got := repo.Months[month].TotalExpenses; got != 30 {
			t.Errorf("TotalExpenses = %v, want 30 (unchanged)", got)
		}
		if got := repo.Balance.TotalBalance; got != 70 {
			t.Errorf("TotalBalance = %v, want 70 (unchanged)", got)
		}
	})

	t.Run("Increase exceeding balance refused under hard-stop", func(t *testing.T) {
		svc, repo, id := setup(t)
		newAmt := 200.0 // delta = +170, exceeds available 70
		_, err := svc.UpdateExpense(ctx, month, id, &model.UpdateExpenseRequest{Amount: &newAmt})
		if !errors.Is(err, ErrInsufficientFunds) {
			t.Errorf("expected ErrInsufficientFunds, got %v", err)
		}
		// Balance untouched after rejection.
		if got := repo.Months[month].TotalExpenses; got != 30 {
			t.Errorf("TotalExpenses = %v, want 30 (no mutation after reject)", got)
		}
	})

	t.Run("No changes rejected", func(t *testing.T) {
		svc, _, id := setup(t)
		_, err := svc.UpdateExpense(ctx, month, id, &model.UpdateExpenseRequest{})
		if err != ErrNoChanges {
			t.Errorf("expected ErrNoChanges, got %v", err)
		}
	})

	t.Run("Unknown expense returns not found", func(t *testing.T) {
		svc, _, _ := setup(t)
		newAmt := 10.0
		_, err := svc.UpdateExpense(ctx, month, "EXP#nope", &model.UpdateExpenseRequest{Amount: &newAmt})
		if err != ErrExpenseNotFound {
			t.Errorf("expected ErrExpenseNotFound, got %v", err)
		}
	})
}

// =====================================================================
// TestDeleteExpense pins the refund path: deleting an expense must
// return its amount to the month and the global balance.
// =====================================================================
func TestDeleteExpense(t *testing.T) {
	ctx := context.Background()
	month := "2026-02"

	t.Run("delete refunds month and total", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedMonth(repo, month, 0, 100, 30, 70)
		repo.Balance = &model.Balance{TotalBalance: 70}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey(month, id)] = &model.Expense{SK: id, Amount: 30}

		if err := svc.DeleteExpense(ctx, month, id); err != nil {
			t.Fatalf("DeleteExpense failed: %v", err)
		}
		if _, exists := repo.Expenses[testutil.ExpenseKey(month, id)]; exists {
			t.Error("expense row still present after delete")
		}
		if got := repo.Months[month].EndingBalance; got != 100 {
			t.Errorf("EndingBalance = %v, want 100 (refunded)", got)
		}
		if got := repo.Balance.TotalBalance; got != 100 {
			t.Errorf("TotalBalance = %v, want 100 (refunded)", got)
		}
	})

	t.Run("unknown expense returns not found", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedMonth(repo, month, 0, 100, 0, 100)
		if err := svc.DeleteExpense(ctx, month, "EXP#nope"); err != ErrExpenseNotFound {
			t.Errorf("expected ErrExpenseNotFound, got %v", err)
		}
	})
}

// =====================================================================
// TestAddFunds pins the top-up path: month allowance, month ending, and
// global balance all rise by the same (cent-rounded) amount.
// =====================================================================
func TestAddFunds(t *testing.T) {
	ctx := context.Background()
	month := "2026-02"

	t.Run("credits month and total", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, false, 500)
		testutil.SeedMonth(repo, month, 0, 500, 100, 400)
		repo.Balance = &model.Balance{TotalBalance: 400}

		resp, err := svc.AddFunds(ctx, month, 50)
		if err != nil {
			t.Fatalf("AddFunds failed: %v", err)
		}
		if resp.Summary.AllowanceAdded != 550 {
			t.Errorf("AllowanceAdded = %v, want 550", resp.Summary.AllowanceAdded)
		}
		if resp.Summary.EndingBalance != 450 {
			t.Errorf("EndingBalance = %v, want 450", resp.Summary.EndingBalance)
		}
		if resp.TotalBalance != 450 {
			t.Errorf("TotalBalance = %v, want 450", resp.TotalBalance)
		}
	})

	t.Run("non-positive amount rejected", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, false, 500)
		testutil.SeedMonth(repo, month, 0, 500, 0, 500)
		for _, amt := range []float64{0, -5, 0.004} {
			if _, err := svc.AddFunds(ctx, month, amt); err != ErrFundsNotPositive {
				t.Errorf("amount %v: expected ErrFundsNotPositive, got %v", amt, err)
			}
		}
	})

	t.Run("missing month rejected", func(t *testing.T) {
		svc, _ := newExpenseService(t, true, false, 500)
		if _, err := svc.AddFunds(ctx, "2026-03", 50); err != ErrMonthNotFound {
			t.Errorf("expected ErrMonthNotFound, got %v", err)
		}
	})
}

// =====================================================================
// TestGetMonthData covers the read path: missing months yield a zero
// summary (not an error), and a malformed cursor maps to
// ErrInvalidCursor for the handler's 400.
// =====================================================================
func TestGetMonthData(t *testing.T) {
	ctx := context.Background()

	t.Run("missing month returns zero summary", func(t *testing.T) {
		svc, _ := newExpenseService(t, false, true, 0)
		resp, err := svc.GetMonthData(ctx, "2026-03", 50, "")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Summary == nil || resp.Summary.EndingBalance != 0 || resp.Summary.Month != "2026-03" {
			t.Errorf("Summary = %+v, want zeroed summary for 2026-03", resp.Summary)
		}
	})

	t.Run("garbage cursor maps to ErrInvalidCursor", func(t *testing.T) {
		svc, _ := newExpenseService(t, false, true, 0)
		_, err := svc.GetMonthData(ctx, "2026-03", 50, "%%%not-base64%%%")
		if !errors.Is(err, ErrInvalidCursor) {
			t.Errorf("expected ErrInvalidCursor, got %v", err)
		}
	})
}

// =====================================================================
// TestListMonths_Pagination asserts descending order and cursor resume.
// A broken sort means the UI shows the wrong month as "current".
// =====================================================================
func TestListMonths_Pagination(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 0)

	for _, m := range []string{"2026-03", "2026-01", "2025-12", "2026-02"} {
		testutil.SeedMonth(repo, m, 0, 100, 30, 70)
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

	t.Run("fabricated cursor month rejected", func(t *testing.T) {
		if _, err := svc.ListMonths(ctx, 2, "2020-01"); err != ErrInvalidCursor {
			t.Errorf("expected ErrInvalidCursor, got %v", err)
		}
	})
}

// =====================================================================
// TestEnsureMonthExists_ConditionalPut pins B2: ensureMonthExists must use
// a conditional create and, on a concurrent create (ErrMonthAlreadyExists),
// re-read and return the winner instead of clobbering it.
// =====================================================================
func TestEnsureMonthExists_ConditionalPut(t *testing.T) {
	ctx := context.Background()

	t.Run("creates month with $0 allowance when absent", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		s, err := svc.ensureMonthExists(ctx, "2026-07")
		if err != nil {
			t.Fatalf("ensureMonthExists failed: %v", err)
		}
		if s.AllowanceAdded != 0 {
			t.Errorf("AllowanceAdded = %v, want 0 (auto-created months get no allowance)", s.AllowanceAdded)
		}
		if repo.Months["2026-07"] == nil {
			t.Error("month not persisted")
		}
		// MONTHLIST mirror must exist too.
		if repo.MonthList["2026-07"] == nil {
			t.Error("MONTHLIST copy not written by conditional create")
		}
	})

	t.Run("loser of a concurrent create returns the winner, not a clobber", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		// Simulate the winner: a month already created with a real
		// allowance and some activity. ensureMonthExists must NOT overwrite
		// it back to a $0 fresh summary.
		testutil.SeedMonth(repo, "2026-07", 0, 100, 40, 60)

		s, err := svc.ensureMonthExists(ctx, "2026-07")
		if err != nil {
			t.Fatalf("ensureMonthExists failed: %v", err)
		}
		if s.AllowanceAdded != 100 || s.TotalExpenses != 40 || s.EndingBalance != 60 {
			t.Errorf("got %+v, want the existing winner (allow=100, exp=40, end=60) — not a clobber", s)
		}
	})
}

// =====================================================================
// TestCreateMonth_IdempotentAllowance pins U1: POST /api/month on a month
// that exists with a $0 allowance (the auto-created shape) must apply the
// allowance idempotently instead of 409. A month with a real allowance is
// still a duplicate.
// =====================================================================
func TestCreateMonth_IdempotentAllowance(t *testing.T) {
	ctx := context.Background()

	t.Run("activates a $0 auto-created month", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		// Auto-create the month via an expense (gives it $0 allowance).
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 10, Description: "x", Month: "2026-08"}); err != nil {
			t.Fatalf("AddExpense failed: %v", err)
		}
		if repo.Months["2026-08"].AllowanceAdded != 0 {
			t.Fatal("precondition: auto-created month should have $0 allowance")
		}
		balanceBefore := repo.Balance.TotalBalance

		resp, err := svc.CreateMonth(ctx, "2026-08")
		if err != nil {
			t.Fatalf("CreateMonth should idempotently activate, got: %v", err)
		}
		if resp.Summary.AllowanceAdded != 100 {
			t.Errorf("AllowanceAdded = %v, want 100 (allowance applied)", resp.Summary.AllowanceAdded)
		}
		if got := repo.Balance.TotalBalance; got != balanceBefore+100 {
			t.Errorf("TotalBalance = %v, want %v (credited by allowance)", got, balanceBefore+100)
		}
	})

	t.Run("month with real allowance is still a duplicate", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		testutil.SeedMonth(repo, "2026-08", 0, 100, 0, 100)
		if _, err := svc.CreateMonth(ctx, "2026-08"); err != ErrMonthExists {
			t.Errorf("expected ErrMonthExists, got %v", err)
		}
	})
}

// =====================================================================
// TestDeleteMonth pins U2: transactional delete debits the allowance and
// is blocked when the month still has expenses.
// =====================================================================
func TestDeleteMonth(t *testing.T) {
	ctx := context.Background()

	t.Run("deletes an empty month and reverses the allowance", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		testutil.SeedMonth(repo, "2026-09", 0, 100, 0, 100)
		repo.Balance = &model.Balance{TotalBalance: 100}

		if err := svc.DeleteMonth(ctx, "2026-09"); err != nil {
			t.Fatalf("DeleteMonth failed: %v", err)
		}
		if repo.Months["2026-09"] != nil {
			t.Error("month summary still present after delete")
		}
		if repo.MonthList["2026-09"] != nil {
			t.Error("MONTHLIST copy still present after delete")
		}
		if repo.Balance.TotalBalance != 0 {
			t.Errorf("TotalBalance = %v, want 0 (allowance reversed)", repo.Balance.TotalBalance)
		}
	})

	t.Run("refuses a month with expenses", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		testutil.SeedMonth(repo, "2026-09", 0, 100, 30, 70)
		if err := svc.DeleteMonth(ctx, "2026-09"); err != ErrMonthHasExpenses {
			t.Errorf("expected ErrMonthHasExpenses, got %v", err)
		}
		if repo.Months["2026-09"] == nil {
			t.Error("month deleted despite having expenses")
		}
	})

	t.Run("missing month returns not found", func(t *testing.T) {
		svc, _ := newExpenseService(t, true, true, 100)
		if err := svc.DeleteMonth(ctx, "2030-01"); err != ErrMonthNotFound {
			t.Errorf("expected ErrMonthNotFound, got %v", err)
		}
	})
}

// =====================================================================
// TestGetMonthData_CursorValidation pins B5: a decoded expense cursor with
// the wrong shape (wrong key count, wrong PK month, non-EXP# SK) maps to
// ErrInvalidCursor (→ 400) rather than reaching DynamoDB.
// =====================================================================
func TestGetMonthData_CursorValidation(t *testing.T) {
	ctx := context.Background()
	svc, _ := newExpenseService(t, false, true, 0)

	// Helper: build a base64 cursor from a key map's simple string form.
	cursor := func(m map[string]string) string {
		data, _ := json.Marshal(m)
		return base64.URLEncoding.EncodeToString(data)
	}

	cases := []struct {
		name string
		key  map[string]string
	}{
		{"extra keys", map[string]string{"PK": "MONTH#2026-02", "SK": "EXP#1", "X": "y"}},
		{"wrong month PK", map[string]string{"PK": "MONTH#2026-03", "SK": "EXP#1"}},
		{"non-EXP SK", map[string]string{"PK": "MONTH#2026-02", "SK": "SUMMARY"}},
		{"missing SK", map[string]string{"PK": "MONTH#2026-02"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.GetMonthData(ctx, "2026-02", 50, cursor(tc.key))
			if !errors.Is(err, ErrInvalidCursor) {
				t.Errorf("expected ErrInvalidCursor, got %v", err)
			}
		})
	}

	t.Run("well-formed cursor is accepted", func(t *testing.T) {
		_, err := svc.GetMonthData(ctx, "2026-02", 50, cursor(map[string]string{"PK": "MONTH#2026-02", "SK": "EXP#123#abc"}))
		if err != nil {
			t.Errorf("well-formed cursor rejected: %v", err)
		}
	})
}

// =====================================================================
// TestListMonths_MigrationFallback pins the C1 lazy-migration path: when
// the MONTHLIST index is empty (old table) but canonical month rows exist,
// ListMonths falls back to the legacy scan, backfills the index, and then
// serves from the index on subsequent calls.
// =====================================================================
func TestListMonths_MigrationFallback(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 0)

	// Seed canonical months, then wipe the MONTHLIST index to simulate a
	// table written before the index existed.
	for _, m := range []string{"2026-01", "2026-02", "2026-03"} {
		testutil.SeedMonth(repo, m, 0, 100, 30, 70)
	}
	repo.MonthList = map[string]*model.MonthSummary{}

	resp, err := svc.ListMonths(ctx, 50, "")
	if err != nil {
		t.Fatalf("ListMonths failed: %v", err)
	}
	if len(resp.Months) != 3 {
		t.Fatalf("got %d months from fallback, want 3", len(resp.Months))
	}
	if resp.Months[0].Month != "2026-03" {
		t.Errorf("first month = %q, want 2026-03 (descending)", resp.Months[0].Month)
	}
	// The index must have been backfilled so the next call hits the Query path.
	if len(repo.MonthList) != 3 {
		t.Errorf("MonthList backfill size = %d, want 3", len(repo.MonthList))
	}

	// Second call serves from the (now populated) index.
	resp2, err := svc.ListMonths(ctx, 50, "")
	if err != nil {
		t.Fatalf("second ListMonths failed: %v", err)
	}
	if len(resp2.Months) != 3 {
		t.Errorf("second call returned %d months, want 3", len(resp2.Months))
	}
}

// =====================================================================
// TestPropagateToLaterMonths pins B3: editing/deleting an expense in a PAST
// month ripples the carried balance forward through all later months when
// carry-over is enabled, and does nothing when it's disabled. The HIGH
// defect fix means propagation now applies a conditional DELTA to BOTH the
// canonical row and its MONTHLIST mirror (not an unconditioned full-object
// Put), so this also asserts the mirror is shifted in lockstep.
// =====================================================================
func TestPropagateToLaterMonths(t *testing.T) {
	ctx := context.Background()

	t.Run("delete in a past month shifts later months' carry (canonical + mirror)", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		// Jan: started 0, +100 allowance, $30 expense → ending 70.
		testutil.SeedMonth(repo, "2026-01", 0, 100, 30, 70)
		// Feb carried 70: +100 allowance, $0 expense → ending 170.
		testutil.SeedMonth(repo, "2026-02", 70, 100, 0, 170)
		// Mar carried 170: +100 allowance → ending 270. Multi-month ripple.
		testutil.SeedMonth(repo, "2026-03", 170, 100, 0, 270)
		repo.Balance = &model.Balance{TotalBalance: 170}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey("2026-01", id)] = &model.Expense{SK: id, Amount: 30}

		if err := svc.DeleteExpense(ctx, "2026-01", id); err != nil {
			t.Fatalf("DeleteExpense failed: %v", err)
		}
		// Jan refunded: ending 100. Feb and Mar must carry the +30 forward.
		if got := repo.Months["2026-01"].EndingBalance; got != 100 {
			t.Errorf("Jan ending = %v, want 100", got)
		}
		if got := repo.Months["2026-02"].StartingBalance; got != 100 {
			t.Errorf("Feb starting = %v, want 100 (carry shifted by +30)", got)
		}
		if got := repo.Months["2026-02"].EndingBalance; got != 200 {
			t.Errorf("Feb ending = %v, want 200 (carry shifted by +30)", got)
		}
		if got := repo.Months["2026-03"].StartingBalance; got != 200 {
			t.Errorf("Mar starting = %v, want 200 (carry shifted by +30)", got)
		}
		if got := repo.Months["2026-03"].EndingBalance; got != 300 {
			t.Errorf("Mar ending = %v, want 300 (carry shifted by +30)", got)
		}
		// The mirror rows must be shifted in lockstep — the delta is applied
		// to MONTHLIST too, not just the canonical row.
		if got := repo.MonthList["2026-02"].StartingBalance; got != 100 {
			t.Errorf("Feb mirror starting = %v, want 100", got)
		}
		if got := repo.MonthList["2026-02"].EndingBalance; got != 200 {
			t.Errorf("Feb mirror ending = %v, want 200", got)
		}
		if got := repo.MonthList["2026-03"].EndingBalance; got != 300 {
			t.Errorf("Mar mirror ending = %v, want 300", got)
		}
	})

	t.Run("carry disabled does not propagate", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, false, 0)
		testutil.SeedMonth(repo, "2026-01", 0, 100, 30, 70)
		testutil.SeedMonth(repo, "2026-02", 0, 100, 0, 100)
		repo.Balance = &model.Balance{TotalBalance: 170}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey("2026-01", id)] = &model.Expense{SK: id, Amount: 30}

		if err := svc.DeleteExpense(ctx, "2026-01", id); err != nil {
			t.Fatalf("DeleteExpense failed: %v", err)
		}
		if got := repo.Months["2026-02"].StartingBalance; got != 0 {
			t.Errorf("Feb starting = %v, want 0 (no carry, no propagation)", got)
		}
	})

	t.Run("delta composes with a concurrent write instead of clobbering it", func(t *testing.T) {
		// The previous SaveMonthSummary path Put a snapshot read BEFORE the
		// mutation, discarding any concurrent change to a later month. The
		// delta path must instead ADD to whatever the row currently holds.
		// Model that by seeding Feb already shifted by an unrelated +25
		// concurrent write, then asserting the +30 delta lands on top.
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedMonth(repo, "2026-01", 0, 100, 30, 70)
		// Feb's "current" state already reflects a concurrent +25 (e.g. an
		// AddFunds that landed between this op's read and write): start 95,
		// ending 195 rather than the 70/170 a stale snapshot would carry.
		testutil.SeedMonth(repo, "2026-02", 95, 100, 0, 195)
		repo.Balance = &model.Balance{TotalBalance: 195}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey("2026-01", id)] = &model.Expense{SK: id, Amount: 30}

		if err := svc.DeleteExpense(ctx, "2026-01", id); err != nil {
			t.Fatalf("DeleteExpense failed: %v", err)
		}
		// +30 delta composes on top of the concurrent 95/195 → 125/225, NOT
		// the 100/200 a clobbering snapshot Put would have written.
		if got := repo.Months["2026-02"].StartingBalance; got != 125 {
			t.Errorf("Feb starting = %v, want 125 (concurrent +25 preserved, delta +30 applied)", got)
		}
		if got := repo.Months["2026-02"].EndingBalance; got != 225 {
			t.Errorf("Feb ending = %v, want 225 (concurrent +25 preserved, delta +30 applied)", got)
		}
	})

	t.Run("legacy table: propagation backfills mirrors and still ripples", func(t *testing.T) {
		// Earlier (buggy) code read later months straight from the MONTHLIST
		// partition; on a legacy table that partition is empty/partial, so
		// propagation silently no-oped and later months' starting balances
		// stayed wrong. The fix reads later months through the backfilling
		// service ListMonths and applies deltas to both rows.
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedLegacyMonth(repo, "2026-01", 0, 100, 30, 70)
		testutil.SeedLegacyMonth(repo, "2026-02", 70, 100, 0, 170)
		repo.Balance = &model.Balance{TotalBalance: 170}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey("2026-01", id)] = &model.Expense{SK: id, Amount: 30}

		if err := svc.DeleteExpense(ctx, "2026-01", id); err != nil {
			t.Fatalf("DeleteExpense on legacy table failed: %v", err)
		}
		if got := repo.Months["2026-02"].StartingBalance; got != 100 {
			t.Errorf("Feb starting = %v, want 100 (propagation must fire on legacy table)", got)
		}
		if got := repo.Months["2026-02"].EndingBalance; got != 200 {
			t.Errorf("Feb ending = %v, want 200 (propagation must fire on legacy table)", got)
		}
		// Both later month's mirror must now exist and match.
		if repo.MonthList["2026-02"] == nil {
			t.Fatal("Feb mirror was not backfilled during propagation")
		}
		if got := repo.MonthList["2026-02"].EndingBalance; got != 200 {
			t.Errorf("Feb mirror ending = %v, want 200", got)
		}
	})
}

// =====================================================================
// TestLegacyMonthMirrorBackfill pins the CRITICAL defect: on a live table
// written before the MONTHLIST scheme (canonical summary present, NO mirror
// row), the first mutation's monthListUpdate condition (attribute_exists)
// would cancel the entire transaction → 500. The service must back-fill the
// mirror (EnsureMonthListMirror) before each atomic path so the mutation
// succeeds and the mirror is created and stays consistent with the canonical
// row.
//
// SeedLegacyMonth seeds the canonical row only; FakeRepo's atomic methods
// now model DynamoDB by FAILING (errMonthListMirrorMissing) when a monthList
// delta hits a missing mirror — so without the fix these would error.
// =====================================================================
func TestLegacyMonthMirrorBackfill(t *testing.T) {
	ctx := context.Background()
	month := "2026-02"

	// assertMirrorConsistent checks the mirror exists and matches the
	// canonical summary's balances field-for-field.
	assertMirrorConsistent := func(t *testing.T, repo *testutil.FakeRepo, m string) {
		t.Helper()
		canon := repo.Months[m]
		mirror := repo.MonthList[m]
		if canon == nil {
			t.Fatalf("canonical summary for %s missing", m)
		}
		if mirror == nil {
			t.Fatalf("MONTHLIST mirror for %s was never created", m)
		}
		if !testutil.AlmostEqual(mirror.TotalExpenses, canon.TotalExpenses) ||
			!testutil.AlmostEqual(mirror.EndingBalance, canon.EndingBalance) ||
			!testutil.AlmostEqual(mirror.AllowanceAdded, canon.AllowanceAdded) ||
			!testutil.AlmostEqual(mirror.StartingBalance, canon.StartingBalance) {
			t.Errorf("mirror %+v diverged from canonical %+v", mirror, canon)
		}
	}

	t.Run("AddExpense on legacy month creates mirror and succeeds", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedLegacyMonth(repo, month, 0, 100, 0, 100)
		repo.Balance = &model.Balance{TotalBalance: 100}

		resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 30, Description: "x", Month: month})
		if err != nil {
			t.Fatalf("AddExpense on legacy month failed (would 500 in prod): %v", err)
		}
		if resp.MonthBalance != 70 {
			t.Errorf("MonthBalance = %v, want 70", resp.MonthBalance)
		}
		assertMirrorConsistent(t, repo, month)
	})

	t.Run("UpdateExpense on legacy month creates mirror and succeeds", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedLegacyMonth(repo, month, 0, 100, 30, 70)
		repo.Balance = &model.Balance{TotalBalance: 70}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey(month, id)] = &model.Expense{SK: id, Amount: 30, Description: "old"}

		newAmt := 50.0
		if _, err := svc.UpdateExpense(ctx, month, id, &model.UpdateExpenseRequest{Amount: &newAmt}); err != nil {
			t.Fatalf("UpdateExpense on legacy month failed (would 500 in prod): %v", err)
		}
		if got := repo.Months[month].EndingBalance; got != 50 {
			t.Errorf("EndingBalance = %v, want 50", got)
		}
		assertMirrorConsistent(t, repo, month)
	})

	t.Run("DeleteExpense on legacy month creates mirror and succeeds", func(t *testing.T) {
		svc, repo := newExpenseService(t, false, true, 0)
		testutil.SeedLegacyMonth(repo, month, 0, 100, 30, 70)
		repo.Balance = &model.Balance{TotalBalance: 70}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey(month, id)] = &model.Expense{SK: id, Amount: 30}

		if err := svc.DeleteExpense(ctx, month, id); err != nil {
			t.Fatalf("DeleteExpense on legacy month failed (would 500 in prod): %v", err)
		}
		if got := repo.Months[month].EndingBalance; got != 100 {
			t.Errorf("EndingBalance = %v, want 100 (refunded)", got)
		}
		assertMirrorConsistent(t, repo, month)
	})

	t.Run("AddFunds on legacy month creates mirror and succeeds", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, false, 500)
		testutil.SeedLegacyMonth(repo, month, 0, 500, 100, 400)
		repo.Balance = &model.Balance{TotalBalance: 400}

		resp, err := svc.AddFunds(ctx, month, 50)
		if err != nil {
			t.Fatalf("AddFunds on legacy month failed (would 500 in prod): %v", err)
		}
		if resp.Summary.AllowanceAdded != 550 || resp.Summary.EndingBalance != 450 {
			t.Errorf("got allowance=%v ending=%v, want 550/450", resp.Summary.AllowanceAdded, resp.Summary.EndingBalance)
		}
		assertMirrorConsistent(t, repo, month)
	})
}

// TestGetBalance pins the trivial read path.
func TestGetBalance(t *testing.T) {
	svc, repo := newExpenseService(t, false, true, 0)
	repo.Balance = &model.Balance{TotalBalance: 123.45}
	resp, err := svc.GetBalance(context.Background())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.TotalBalance != 123.45 {
		t.Errorf("TotalBalance = %v, want 123.45", resp.TotalBalance)
	}
}
