package service

import (
	"context"
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
		if err != ErrInsufficientFunds {
			t.Fatalf("expected ErrInsufficientFunds, got %v", err)
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
		if err != ErrInsufficientFunds {
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
