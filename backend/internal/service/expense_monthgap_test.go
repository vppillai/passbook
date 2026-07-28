package service

import (
	"context"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// Both places that open a month carried from GetPreviousMonth(month) — the
// immediately preceding CALENDAR month. When that month does not exist the
// lookup returns nil and the starting balance silently becomes 0, dropping
// whatever the last real month before the gap was carrying.
//
// A gap is ordinary, not exotic: months are created on demand, so a family that
// does not open the app for a month leaves no row for it. DeleteMonth and
// scripts/add-data.sh's rmmonth also make holes.
//
// The money is not gone — the global BALANCE row still counts it — so the effect
// is to break the ledger invariant `starting_balance[n] == ending_balance[n-1]`
// and leave BALANCE disagreeing with the month chain, which is exactly the drift
// the audit command looks for. It cannot self-heal: nothing recomputes a
// starting balance once it is written.
//
// The right anchor is the most recent month that EXISTS before the target, not
// the one the calendar happens to name.

func TestCreateMonth_CarriesAcrossAGapInTheMonthSequence(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)

	// January saved 250. February was never opened.
	testutil.SeedMonth(repo, "2026-01", 0, 250, 0, 250)
	repo.Balance = &model.Balance{TotalBalance: 250}

	resp, err := svc.CreateMonth(ctx, "2026-03")
	if err != nil {
		t.Fatalf("CreateMonth: %v", err)
	}

	if got := resp.Summary.StartingBalance; got != 250 {
		t.Errorf("starting_balance = %.2f, want 250 — the balance carried by the last "+
			"month before the gap was dropped", got)
	}
	if got := resp.Summary.EndingBalance; got != 350 {
		t.Errorf("ending_balance = %.2f, want 350 (250 carried + 100 allowance)", got)
	}
	// The invariant that matters: the newest month's ending balance is the
	// global balance.
	if resp.TotalBalance != resp.Summary.EndingBalance {
		t.Errorf("global balance %.2f != newest month ending %.2f — the chain and the "+
			"balance row have diverged", resp.TotalBalance, resp.Summary.EndingBalance)
	}
}

// A month opened implicitly by filing an expense into it takes the same path and
// had the same hole.
func TestAddExpense_ImplicitMonthCarriesAcrossAGap(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)

	testutil.SeedMonth(repo, "2026-01", 0, 250, 0, 250)
	repo.Balance = &model.Balance{TotalBalance: 250}

	if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount: 30, Description: "gap expense", Date: "2026-03-10",
	}); err != nil {
		t.Fatalf("AddExpense: %v", err)
	}

	march := repo.Months["2026-03"]
	if march == nil {
		t.Fatal("March was not created")
	}
	if march.StartingBalance != 250 {
		t.Errorf("starting_balance = %.2f, want 250", march.StartingBalance)
	}
	// An implicitly opened month gets no allowance, so 250 - 30.
	if march.EndingBalance != 220 {
		t.Errorf("ending_balance = %.2f, want 220", march.EndingBalance)
	}
}

// A multi-month hole is no different from a one-month one.
func TestCreateMonth_CarriesAcrossAMultiMonthGap(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)

	testutil.SeedMonth(repo, "2025-11", 0, 75, 0, 75)
	repo.Balance = &model.Balance{TotalBalance: 75}

	resp, err := svc.CreateMonth(ctx, "2026-04")
	if err != nil {
		t.Fatalf("CreateMonth: %v", err)
	}
	if got := resp.Summary.StartingBalance; got != 75 {
		t.Errorf("starting_balance = %.2f, want 75 across a four-month hole", got)
	}
}

// The anchor must be the LATEST month before the target, not merely any earlier
// one — otherwise a longer history would carry from the wrong end.
func TestCreateMonth_CarriesFromTheLatestPriorMonthNotTheOldest(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)

	testutil.SeedMonth(repo, "2025-09", 0, 10, 0, 10)
	testutil.SeedMonth(repo, "2025-10", 10, 10, 0, 20)
	testutil.SeedMonth(repo, "2026-01", 20, 10, 0, 30)
	repo.Balance = &model.Balance{TotalBalance: 30}

	resp, err := svc.CreateMonth(ctx, "2026-05")
	if err != nil {
		t.Fatalf("CreateMonth: %v", err)
	}
	if got := resp.Summary.StartingBalance; got != 30 {
		t.Errorf("starting_balance = %.2f, want 30 (2026-01's ending, the latest before "+
			"the target)", got)
	}
}

// No gap: behaviour must be byte-for-byte what it was, since that is the
// overwhelmingly common case.
func TestCreateMonth_ContiguousMonthIsUnaffected(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)

	testutil.SeedMonth(repo, "2026-01", 0, 250, 50, 200)
	repo.Balance = &model.Balance{TotalBalance: 200}

	resp, err := svc.CreateMonth(ctx, "2026-02")
	if err != nil {
		t.Fatalf("CreateMonth: %v", err)
	}
	if got := resp.Summary.StartingBalance; got != 200 {
		t.Errorf("starting_balance = %.2f, want 200", got)
	}
}

// With carry off there is nothing to carry, gap or not.
func TestCreateMonth_GapCarriesNothingWhenCarryIsOff(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, false, 100)

	testutil.SeedMonth(repo, "2026-01", 0, 250, 0, 250)
	repo.Balance = &model.Balance{TotalBalance: 250}

	resp, err := svc.CreateMonth(ctx, "2026-03")
	if err != nil {
		t.Fatalf("CreateMonth: %v", err)
	}
	if got := resp.Summary.StartingBalance; got != 0 {
		t.Errorf("starting_balance = %.2f, want 0 with carry off", got)
	}
}

// The very first month has nothing before it.
func TestCreateMonth_FirstEverMonthStartsAtZero(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	repo.Balance = &model.Balance{TotalBalance: 0}

	resp, err := svc.CreateMonth(ctx, "2026-03")
	if err != nil {
		t.Fatalf("CreateMonth: %v", err)
	}
	if got := resp.Summary.StartingBalance; got != 0 {
		t.Errorf("starting_balance = %.2f, want 0 for the first month", got)
	}
}

// A legacy table has an empty or partial MONTHLIST partition. The prior-month
// lookup must not trust it blindly, or it would miss the real anchor and
// reintroduce the dropped balance on exactly the tables most likely to have
// gaps.
func TestCreateMonth_FindsThePriorMonthOnALegacyTable(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)

	// Canonical row present, no MONTHLIST mirror — a pre-index table.
	testutil.SeedLegacyMonth(repo, "2026-01", 0, 250, 0, 250)
	repo.Balance = &model.Balance{TotalBalance: 250}

	resp, err := svc.CreateMonth(ctx, "2026-03")
	if err != nil {
		t.Fatalf("CreateMonth: %v", err)
	}
	if got := resp.Summary.StartingBalance; got != 250 {
		t.Errorf("starting_balance = %.2f, want 250 — the prior month was invisible "+
			"because the MONTHLIST index had no mirror for it", got)
	}
}
