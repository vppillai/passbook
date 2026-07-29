package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// The overspend hard stop is enforced by a DynamoDB ConditionExpression on the
// ONE month being written: `ending_balance >= :amount`. That is sound only if
// months are independent. With carry_over_balance on they are not — a change to
// any month shifts every later month's ending balance by the same delta — so a
// per-month condition is the wrong question in both directions:
//
//   - It lets a back-dated expense drive a LATER month negative. The target
//     month has the headroom, so the condition passes; propagation then pushes
//     the months after it below zero, silently, on an instance that disallows
//     overspending altogether.
//   - It refuses moves that are perfectly affordable. Moving an expense to a
//     later month checks the destination's CURRENT balance, before the source's
//     refund has propagated into it.
//
// Both are the same modelling gap, so they are pinned together.

// seedChainExpense installs one expense row directly, the way the other expense
// tests do, and returns its SK (which doubles as the expense id the service is
// called with).
func seedChainExpense(repo *testutil.FakeRepo, month string, amount float64, desc string, day time.Time) string {
	sk := "EXP#1#chain"
	repo.Expenses[testutil.ExpenseKey(month, sk)] = &model.Expense{
		SK: sk, Amount: amount, Description: desc, CreatedAt: day,
	}
	return sk
}

func day(t *testing.T, date string) time.Time {
	t.Helper()
	d, err := time.Parse("2006-01-02", date)
	if err != nil {
		t.Fatalf("bad test date %q: %v", date, err)
	}
	return d.Add(12 * time.Hour)
}

func amt(v float64) *float64 { return &v }
func desc(v string) *string  { return &v }

// A back-dated expense the earlier month can afford, but which the carry chain
// cannot: the balance has to stay non-negative for EVERY month, not just the one
// receiving the write.
func TestAddExpense_BackDatedExpenseCannotDriveALaterMonthNegative(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100) // no overspending, carry on

	// January is flush; February has already spent nearly everything it carried.
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 100, 100, 190, 10)
	repo.Balance = &model.Balance{TotalBalance: 10}

	// 50 <= January's ending balance of 100, so the per-month condition passes.
	// But only 10 is actually spendable: February would land at -40.
	_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount: 50, Description: "back-dated book", Month: "2026-01", Date: "2026-01-15",
	})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}

	// Nothing may have been written — in particular February must not be
	// negative on an instance that disallows overspending.
	if feb := repo.Months["2026-02"]; feb.EndingBalance < 0 {
		t.Errorf("February ending_balance = %.2f: a back-dated expense drove a later "+
			"month negative despite allow_overspending=false", feb.EndingBalance)
	}
	if jan := repo.Months["2026-01"]; jan.TotalExpenses != 0 {
		t.Errorf("January total_expenses = %.2f, want 0 — the refused expense was "+
			"still written", jan.TotalExpenses)
	}
	if repo.Balance.TotalBalance < 0 {
		t.Errorf("global balance = %.2f, want >= 0", repo.Balance.TotalBalance)
	}
}

// The binding constraint is the tightest month in the chain, so the reported
// "available" figure must be that, not the target month's own balance. Telling
// the user they have 100 available while refusing 50 is worse than refusing.
func TestAddExpense_ReportsTheChainsAvailableBalanceNotTheMonths(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 100, 100, 190, 10)
	repo.Balance = &model.Balance{TotalBalance: 10}

	_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount: 50, Description: "book", Month: "2026-01", Date: "2026-01-15",
	})
	var rich *InsufficientFundsError
	if !errors.As(err, &rich) {
		t.Fatalf("err = %v, want an *InsufficientFundsError carrying the available amount", err)
	}
	if rich.Available != 10 {
		t.Errorf("Available = %.2f, want 10 (February's headroom, the tightest in the "+
			"chain) — reporting January's 100 invites the user to retry an amount that "+
			"cannot work", rich.Available)
	}
}

// Right at the limit it must go through: the guard has to be exact, not a
// conservative fudge that blocks legitimate spending.
func TestAddExpense_BackDatedExpenseAtTheChainLimitIsAllowed(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 100, 100, 190, 10)
	repo.Balance = &model.Balance{TotalBalance: 10}

	if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount: 10, Description: "exactly affordable", Month: "2026-01", Date: "2026-01-15",
	}); err != nil {
		t.Fatalf("an expense exactly equal to the chain headroom was refused: %v", err)
	}
	if got := repo.Months["2026-02"].EndingBalance; got != 0 {
		t.Errorf("February ending_balance = %.2f, want 0", got)
	}
}

// With overspending allowed the chain guard must not apply at all — that
// instance has opted into negative balances (eatout runs this way).
func TestAddExpense_ChainGuardDoesNotApplyWhenOverspendingIsAllowed(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 100, 100, 190, 10)
	repo.Balance = &model.Balance{TotalBalance: 10}

	if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount: 50, Description: "over", Month: "2026-01", Date: "2026-01-15",
	}); err != nil {
		t.Fatalf("AddExpense refused on an overspending-allowed instance: %v", err)
	}
	if got := repo.Months["2026-02"].EndingBalance; got != -40 {
		t.Errorf("February ending_balance = %.2f, want -40 (carry still propagates)", got)
	}
}

// With carry off the months are genuinely independent, so a later month's
// balance is none of this expense's business.
func TestAddExpense_ChainGuardDoesNotApplyWhenCarryIsOff(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, false, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 0, 100, 95, 5)
	repo.Balance = &model.Balance{TotalBalance: 105}

	if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount: 50, Description: "book", Month: "2026-01", Date: "2026-01-15",
	}); err != nil {
		t.Fatalf("AddExpense refused although carry is off and January can afford it: %v", err)
	}
	if got := repo.Months["2026-02"].EndingBalance; got != 5 {
		t.Errorf("February ending_balance = %.2f, want 5 (untouched with carry off)", got)
	}
}

// Raising the amount of an expense in a PAST month has the same reach as
// back-dating a new one.
func TestUpdateExpense_RaisingAPastAmountCannotDriveALaterMonthNegative(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 20, 80)
	testutil.SeedMonth(repo, "2026-02", 80, 100, 175, 5)
	repo.Balance = &model.Balance{TotalBalance: 5}
	sk := seedChainExpense(repo, "2026-01", 20, "book", day(t, "2026-01-10"))

	// 20 -> 60 is a delta of 40. January can absorb it (80 headroom); the chain
	// cannot (5).
	_, err := svc.UpdateExpense(ctx, "2026-01", sk,
		&model.UpdateExpenseRequest{Amount: amt(60), Description: desc("book")})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
	if feb := repo.Months["2026-02"]; feb.EndingBalance < 0 {
		t.Errorf("February ending_balance = %.2f, want >= 0", feb.EndingBalance)
	}
}

// The other direction: a move to a LATER month was refused for insufficient
// funds even when the source's refund pays for it. The destination's condition
// looks at its balance BEFORE the refund propagates in, so a move that nets to
// zero across the chain is rejected.
func TestUpdateExpense_MoveToALaterMonthIsNotRefusedWhenTheRefundCoversIt(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)

	// January spent its whole allowance on the one expense; February carried
	// nothing in and has no allowance of its own yet.
	testutil.SeedMonth(repo, "2026-01", 0, 100, 100, 0)
	testutil.SeedMonth(repo, "2026-02", 0, 0, 0, 0)
	repo.Balance = &model.Balance{TotalBalance: 0}
	sk := seedChainExpense(repo, "2026-01", 100, "school trip", day(t, "2026-01-10"))

	// Moving it to February: February's current ending balance is 0 and the
	// amount is 100, so the per-month condition refuses. But January's refund of
	// 100 propagates into February, which therefore ends at 0 either way.
	if _, err := svc.UpdateExpense(ctx, "2026-01", sk,
		&model.UpdateExpenseRequest{Amount: amt(100), Description: desc("school trip"), Date: "2026-02-05"},
	); err != nil {
		t.Fatalf("move to a later month refused: %v — the source refund pays for it, "+
			"so this is affordable", err)
	}

	if jan := repo.Months["2026-01"]; jan.TotalExpenses != 0 || jan.EndingBalance != 100 {
		t.Errorf("January = expenses %.2f / ending %.2f, want 0 / 100",
			jan.TotalExpenses, jan.EndingBalance)
	}
	if feb := repo.Months["2026-02"]; feb.TotalExpenses != 100 || feb.EndingBalance != 0 {
		t.Errorf("February = expenses %.2f / ending %.2f, want 100 / 0",
			feb.TotalExpenses, feb.EndingBalance)
	}
}

// A move to a later month that genuinely is not affordable must still be
// refused — the relaxation above must not become a hole.
func TestUpdateExpense_MoveToALaterMonthStillRefusedWhenTrulyUnaffordable(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 10, 90)
	testutil.SeedMonth(repo, "2026-02", 90, 0, 0, 90)
	repo.Balance = &model.Balance{TotalBalance: 90}
	sk := seedChainExpense(repo, "2026-01", 10, "snack", day(t, "2026-01-10"))

	// Raising 10 -> 500 while moving to February. The refund is only 10, so the
	// chain cannot cover it.
	_, err := svc.UpdateExpense(ctx, "2026-01", sk,
		&model.UpdateExpenseRequest{Amount: amt(500), Description: desc("snack"), Date: "2026-02-05"})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
	if feb := repo.Months["2026-02"]; feb.EndingBalance < 0 {
		t.Errorf("February ending_balance = %.2f, want >= 0", feb.EndingBalance)
	}
}

// Moving to an EARLIER month does not receive a refund (the refund propagates
// to months after the SOURCE, all of which are after the destination), so the
// destination must still be checked against its own balance.
func TestUpdateExpense_MoveToAnEarlierMonthStillChecksTheDestination(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 20, 15, 5)
	testutil.SeedMonth(repo, "2026-02", 5, 100, 50, 55)
	repo.Balance = &model.Balance{TotalBalance: 55}
	sk := seedChainExpense(repo, "2026-02", 50, "shoes", day(t, "2026-02-10"))

	// January only has 5 of headroom; a 50 expense moved back into it would take
	// it to -45 and February would be unaffected by any refund from later.
	_, err := svc.UpdateExpense(ctx, "2026-02", sk,
		&model.UpdateExpenseRequest{Amount: amt(50), Description: desc("shoes"), Date: "2026-01-20"})
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("err = %v, want ErrInsufficientFunds", err)
	}
	if jan := repo.Months["2026-01"]; jan.EndingBalance < 0 {
		t.Errorf("January ending_balance = %.2f, want >= 0", jan.EndingBalance)
	}
}
