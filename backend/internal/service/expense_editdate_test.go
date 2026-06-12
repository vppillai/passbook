package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// seedExpense files a single expense into a month via the add path so the
// month summary, mirror, and balance are all consistent, then returns the
// created SK. Uses a past date so the timestamp is the deterministic noon-UTC
// sentinel and the SK ordering is stable across the wall clock.
func seedExpenseOnDate(t *testing.T, svc *ExpenseService, amount float64, desc, date string) string {
	t.Helper()
	resp, err := svc.AddExpense(context.Background(), &model.AddExpenseRequest{
		Amount:      amount,
		Description: desc,
		Date:        date,
	})
	if err != nil {
		t.Fatalf("seed AddExpense(%s): %v", date, err)
	}
	return resp.Expense.SK
}

// pastMonthDay returns a "YYYY-MM" and "YYYY-MM-DD" for the given day-of-month
// in a month `monthsAgo` before now, so tests never trip the future-date guard.
func pastMonthDay(monthsAgo, day int) (string, string) {
	base := time.Now().UTC().AddDate(0, -monthsAgo, 0)
	month := fmt.Sprintf("%04d-%02d", base.Year(), base.Month())
	date := fmt.Sprintf("%04d-%02d-%02d", base.Year(), base.Month(), day)
	return month, date
}

// TestUpdateExpense_SameMonthDateChange pins that re-dating within the same
// month preserves the month summary and global balance (amount unchanged) and
// re-keys the SK to the new day (so the list order reflects the new date).
func TestUpdateExpense_SameMonthDateChange(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	month, day5 := pastMonthDay(3, 5)
	_, day20 := pastMonthDay(3, 20)
	oldSK := seedExpenseOnDate(t, svc, 30, "groceries", day5)

	beforeExp := repo.Months[month].TotalExpenses
	beforeEnd := repo.Months[month].EndingBalance
	beforeBal := repo.Balance.TotalBalance

	resp, err := svc.UpdateExpense(ctx, month, oldSK, &model.UpdateExpenseRequest{Date: day20})
	if err != nil {
		t.Fatalf("same-month date change: %v", err)
	}

	// Summaries + balance unchanged (amount didn't move).
	if !testutil.AlmostEqual(repo.Months[month].TotalExpenses, beforeExp) {
		t.Errorf("total_expenses changed: %v -> %v", beforeExp, repo.Months[month].TotalExpenses)
	}
	if !testutil.AlmostEqual(repo.Months[month].EndingBalance, beforeEnd) {
		t.Errorf("ending_balance changed: %v -> %v", beforeEnd, repo.Months[month].EndingBalance)
	}
	if !testutil.AlmostEqual(repo.Balance.TotalBalance, beforeBal) {
		t.Errorf("total_balance changed: %v -> %v", beforeBal, repo.Balance.TotalBalance)
	}
	// Mirror stays in sync with the canonical summary.
	if !testutil.AlmostEqual(repo.MonthList[month].TotalExpenses, repo.Months[month].TotalExpenses) {
		t.Errorf("mirror total_expenses drifted: %v vs %v", repo.MonthList[month].TotalExpenses, repo.Months[month].TotalExpenses)
	}

	// SK re-keyed to the new (later) day; the old SK is gone, the new one present.
	newSK := resp.Expense.ID
	if newSK == oldSK {
		t.Fatalf("SK not re-keyed on date change: still %q", oldSK)
	}
	if !(oldSK < newSK) {
		t.Errorf("re-dated SK should sort after the earlier-day SK: old %q new %q", oldSK, newSK)
	}
	if _, ok := repo.Expenses[testutil.ExpenseKey(month, oldSK)]; ok {
		t.Error("old SK row still present after re-date")
	}
	if _, ok := repo.Expenses[testutil.ExpenseKey(month, newSK)]; !ok {
		t.Error("new SK row missing after re-date")
	}
	// Response month unchanged (no move) and timestamp is noon UTC of day 20.
	if resp.Expense.Month != month {
		t.Errorf("response month = %q, want %q (no move)", resp.Expense.Month, month)
	}
	wantNano := skNanos(t, newSK)
	if resp.Expense.CreatedAt.UnixNano() != wantNano {
		t.Errorf("CreatedAt nanos %d != SK nanos %d", resp.Expense.CreatedAt.UnixNano(), wantNano)
	}
}

// TestUpdateExpense_SameMonthDatePlusAmount pins that a same-month re-date that
// ALSO changes the amount composes both: the SK re-keys and the summary/balance
// shift by the amount delta in the one transaction.
func TestUpdateExpense_SameMonthDatePlusAmount(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	month, day5 := pastMonthDay(3, 5)
	_, day10 := pastMonthDay(3, 10)
	oldSK := seedExpenseOnDate(t, svc, 30, "groceries", day5)

	beforeBal := repo.Balance.TotalBalance // -30

	newAmt := 50.0
	resp, err := svc.UpdateExpense(ctx, month, oldSK, &model.UpdateExpenseRequest{Date: day10, Amount: &newAmt})
	if err != nil {
		t.Fatalf("same-month date+amount: %v", err)
	}
	if !testutil.AlmostEqual(repo.Months[month].TotalExpenses, 50) {
		t.Errorf("total_expenses = %v, want 50", repo.Months[month].TotalExpenses)
	}
	// Balance dropped by the +20 amount delta.
	if !testutil.AlmostEqual(repo.Balance.TotalBalance, beforeBal-20) {
		t.Errorf("total_balance = %v, want %v", repo.Balance.TotalBalance, beforeBal-20)
	}
	if !testutil.AlmostEqual(resp.Expense.Amount, 50) {
		t.Errorf("response amount = %v, want 50", resp.Expense.Amount)
	}
}

// TestUpdateExpense_CrossMonthMoveEqualAmount pins the core move contract:
// moving an expense to a different month adjusts BOTH months' summaries and
// mirrors and leaves the global balance unchanged for an equal amount.
func TestUpdateExpense_CrossMonthMoveEqualAmount(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	srcMonth, srcDay := pastMonthDay(3, 12)
	dstMonth, dstDay := pastMonthDay(2, 8) // a month closer to now (still past)
	oldSK := seedExpenseOnDate(t, svc, 40, "books", srcDay)

	beforeBal := repo.Balance.TotalBalance // -40

	resp, err := svc.UpdateExpense(ctx, srcMonth, oldSK, &model.UpdateExpenseRequest{Date: dstDay})
	if err != nil {
		t.Fatalf("cross-month move: %v", err)
	}

	// Source refunded to zero spend; destination charged 40.
	if !testutil.AlmostEqual(repo.Months[srcMonth].TotalExpenses, 0) {
		t.Errorf("source total_expenses = %v, want 0", repo.Months[srcMonth].TotalExpenses)
	}
	if !testutil.AlmostEqual(repo.Months[dstMonth].TotalExpenses, 40) {
		t.Errorf("dest total_expenses = %v, want 40", repo.Months[dstMonth].TotalExpenses)
	}
	// Mirrors track their canonical rows.
	if !testutil.AlmostEqual(repo.MonthList[srcMonth].TotalExpenses, 0) {
		t.Errorf("source mirror total_expenses = %v, want 0", repo.MonthList[srcMonth].TotalExpenses)
	}
	if !testutil.AlmostEqual(repo.MonthList[dstMonth].TotalExpenses, 40) {
		t.Errorf("dest mirror total_expenses = %v, want 40", repo.MonthList[dstMonth].TotalExpenses)
	}
	// Global balance unchanged for an equal-amount move.
	if !testutil.AlmostEqual(repo.Balance.TotalBalance, beforeBal) {
		t.Errorf("total_balance = %v, want %v (unchanged)", repo.Balance.TotalBalance, beforeBal)
	}
	// Expense row physically moved partitions.
	if _, ok := repo.Expenses[testutil.ExpenseKey(srcMonth, oldSK)]; ok {
		t.Error("expense still in source month after move")
	}
	if _, ok := repo.Expenses[testutil.ExpenseKey(dstMonth, resp.Expense.ID)]; !ok {
		t.Error("expense missing from destination month after move")
	}
	// Response signals the move via the new month (and possibly new id).
	if resp.Expense.Month != dstMonth {
		t.Errorf("response month = %q, want destination %q", resp.Expense.Month, dstMonth)
	}
}

// TestUpdateExpense_CrossMonthMovePlusAmount pins that a move that also changes
// the amount shifts the global balance by the amount diff (oldAmount-newAmount).
func TestUpdateExpense_CrossMonthMovePlusAmount(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	srcMonth, srcDay := pastMonthDay(3, 12)
	dstMonth, dstDay := pastMonthDay(2, 8)
	oldSK := seedExpenseOnDate(t, svc, 40, "books", srcDay)

	beforeBal := repo.Balance.TotalBalance // -40

	newAmt := 25.0
	_, err := svc.UpdateExpense(ctx, srcMonth, oldSK, &model.UpdateExpenseRequest{Date: dstDay, Amount: &newAmt})
	if err != nil {
		t.Fatalf("cross-month move + amount: %v", err)
	}
	if !testutil.AlmostEqual(repo.Months[srcMonth].TotalExpenses, 0) {
		t.Errorf("source total_expenses = %v, want 0", repo.Months[srcMonth].TotalExpenses)
	}
	if !testutil.AlmostEqual(repo.Months[dstMonth].TotalExpenses, 25) {
		t.Errorf("dest total_expenses = %v, want 25", repo.Months[dstMonth].TotalExpenses)
	}
	// Balance shifts by (oldAmount - newAmount) = (40 - 25) = +15.
	if !testutil.AlmostEqual(repo.Balance.TotalBalance, beforeBal+15) {
		t.Errorf("total_balance = %v, want %v", repo.Balance.TotalBalance, beforeBal+15)
	}
}

// TestUpdateExpense_MoveInsufficientFundsRejected pins that moving an expense
// into a month without enough balance is refused when overspending is
// disallowed, and nothing is mutated.
func TestUpdateExpense_MoveInsufficientFundsRejected(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, false, 0) // overspend disallowed

	srcMonth, srcDay := pastMonthDay(4, 12)
	dstMonth, dstDay := pastMonthDay(3, 8)

	// Source has $100 allowance, one $40 expense → $60 left.
	testutil.SeedMonth(repo, srcMonth, 0, 100, 0, 100)
	repo.Balance.TotalBalance = 100
	oldSK := seedExpenseOnDate(t, svc, 40, "books", srcDay)

	// Destination exists but is broke: $10 allowance, nothing spent.
	testutil.SeedMonth(repo, dstMonth, 0, 10, 0, 10)
	repo.Balance.TotalBalance += 10

	balBefore := repo.Balance.TotalBalance
	srcSpendBefore := repo.Months[srcMonth].TotalExpenses

	_, err := svc.UpdateExpense(ctx, srcMonth, oldSK, &model.UpdateExpenseRequest{Date: dstDay})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("move into broke month = %v, want ErrInsufficientFunds", err)
	}
	// Nothing changed: the expense stayed put, both summaries intact.
	if _, ok := repo.Expenses[testutil.ExpenseKey(srcMonth, oldSK)]; !ok {
		t.Error("expense vanished from source despite rejected move")
	}
	if _, ok := repo.Expenses[testutil.ExpenseKey(dstMonth, oldSK)]; ok {
		t.Error("expense leaked into destination despite rejected move")
	}
	if !testutil.AlmostEqual(repo.Months[srcMonth].TotalExpenses, srcSpendBefore) {
		t.Errorf("source spend mutated on rejected move: %v -> %v", srcSpendBefore, repo.Months[srcMonth].TotalExpenses)
	}
	if !testutil.AlmostEqual(repo.Balance.TotalBalance, balBefore) {
		t.Errorf("balance mutated on rejected move: %v -> %v", balBefore, repo.Balance.TotalBalance)
	}
	// And the InsufficientFundsError names the destination's available balance.
	var insufficient *InsufficientFundsError
	if errors.As(err, &insufficient) && !testutil.AlmostEqual(insufficient.Available, 10) {
		t.Errorf("available = %v, want destination's 10", insufficient.Available)
	}
}

// TestUpdateExpense_FutureDateRejected pins that an edit to a future date is
// refused with ErrFutureDate (handler → 400) and the expense is untouched.
func TestUpdateExpense_FutureDateRejected(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	month, day5 := pastMonthDay(2, 5)
	oldSK := seedExpenseOnDate(t, svc, 12, "snack", day5)

	future := time.Now().UTC().AddDate(0, 0, 3)
	futureStr := fmt.Sprintf("%04d-%02d-%02d", future.Year(), future.Month(), future.Day())

	_, err := svc.UpdateExpense(ctx, month, oldSK, &model.UpdateExpenseRequest{Date: futureStr})
	if !errors.Is(err, ErrFutureDate) {
		t.Fatalf("future edit date = %v, want ErrFutureDate", err)
	}
	// The original SK is intact.
	if _, ok := repo.Expenses[testutil.ExpenseKey(month, oldSK)]; !ok {
		t.Error("expense disturbed by rejected future-date edit")
	}
}

// TestUpdateExpense_InvalidDateRejected pins that a malformed edit date is
// refused with ErrInvalidDate.
func TestUpdateExpense_InvalidDateRejected(t *testing.T) {
	ctx := context.Background()
	svc, _ := newExpenseService(t, true, false, 0)

	month, day5 := pastMonthDay(2, 5)
	oldSK := seedExpenseOnDate(t, svc, 12, "snack", day5)

	for _, bad := range []string{"2026-13-01", "2026-02-30", "03/15/2026", "not-a-date"} {
		_, err := svc.UpdateExpense(ctx, month, oldSK, &model.UpdateExpenseRequest{Date: bad})
		if !errors.Is(err, ErrInvalidDate) {
			t.Errorf("edit date %q = %v, want ErrInvalidDate", bad, err)
		}
	}
}

// TestUpdateExpense_CarryPropagatesBothMonths pins that a cross-month move with
// carry-over enabled ripples through the carry chain for BOTH affected months:
// the source's later months gain back the refunded amount and the destination's
// later months lose the newly-charged amount. With src older than dst, the
// destination's only later month is the latest (none after it), while a month
// strictly after BOTH must net to zero (refund + charge of equal amounts).
func TestUpdateExpense_CarryPropagatesBothMonths(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 0) // overspend on, carry on

	srcMonth, srcDay := pastMonthDay(4, 12)
	dstMonth, _ := pastMonthDay(3, 8)
	_, dstDay := pastMonthDay(3, 8)
	laterMonth, _ := pastMonthDay(2, 1) // strictly after both src and dst

	// Build a carry chain: src (-40 spend) → dst → later. Seed each month and
	// the balance via the service so carry starting balances are coherent.
	testutil.SeedMonth(repo, srcMonth, 0, 200, 0, 200)
	testutil.SeedMonth(repo, dstMonth, 200, 0, 0, 200)
	testutil.SeedMonth(repo, laterMonth, 200, 0, 0, 200)
	repo.Balance.TotalBalance = 200

	oldSK := seedExpenseOnDate(t, svc, 40, "books", srcDay)
	// Seeding the $40 expense in src lowered src ending by 40 and (carry)
	// rippled -40 into every later month. Capture the post-seed starting
	// balances of both later months as the baselines the move shifts.
	laterStartAfterSeed := repo.Months[laterMonth].StartingBalance
	dstStartAfterSeed := repo.Months[dstMonth].StartingBalance

	_, err := svc.UpdateExpense(ctx, srcMonth, oldSK, &model.UpdateExpenseRequest{Date: dstDay})
	if err != nil {
		t.Fatalf("cross-month move with carry: %v", err)
	}

	// laterMonth is strictly after BOTH src and dst, so it receives +40 (from
	// the source-refund propagation, months after src) and -40 (from the
	// destination-charge propagation, months after dst) → net zero relative to
	// the post-seed state. This proves BOTH propagations fired.
	if !testutil.AlmostEqual(repo.Months[laterMonth].StartingBalance, laterStartAfterSeed) {
		t.Errorf("later-month starting_balance = %v, want %v (net-zero across both propagations)",
			repo.Months[laterMonth].StartingBalance, laterStartAfterSeed)
	}
	if !testutil.AlmostEqual(repo.MonthList[laterMonth].StartingBalance, laterStartAfterSeed) {
		t.Errorf("later-month mirror starting_balance = %v, want %v", repo.MonthList[laterMonth].StartingBalance, laterStartAfterSeed)
	}
	// dstMonth is strictly after src (so it gets the +40 source-refund ripple)
	// but is the charge site itself (not strictly after itself), so it does NOT
	// get the destination-charge ripple — net +40 over its post-seed start.
	if !testutil.AlmostEqual(repo.Months[dstMonth].StartingBalance, dstStartAfterSeed+40) {
		t.Errorf("dest starting_balance = %v, want %v (source-refund carry ripple only)",
			repo.Months[dstMonth].StartingBalance, dstStartAfterSeed+40)
	}
}

// TestUpdateExpense_AmountOnlyUnaffected pins that an amount-only edit (no date)
// keeps the existing in-place behavior: same SK, same month in the response.
func TestUpdateExpense_AmountOnlyUnaffected(t *testing.T) {
	ctx := context.Background()
	svc, _ := newExpenseService(t, true, false, 0)

	month, day5 := pastMonthDay(2, 5)
	oldSK := seedExpenseOnDate(t, svc, 12, "snack", day5)

	newAmt := 20.0
	resp, err := svc.UpdateExpense(ctx, month, oldSK, &model.UpdateExpenseRequest{Amount: &newAmt})
	if err != nil {
		t.Fatalf("amount-only edit: %v", err)
	}
	if resp.Expense.ID != oldSK {
		t.Errorf("SK changed on amount-only edit: %q -> %q", oldSK, resp.Expense.ID)
	}
	if resp.Expense.Month != month {
		t.Errorf("response month = %q, want %q", resp.Expense.Month, month)
	}
}
