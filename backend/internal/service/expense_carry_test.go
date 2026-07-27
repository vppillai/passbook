package service

import (
	"context"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// =====================================================================
// Hot-path cost: expense mutations must not Scan the table every time.
//
// propagateToLaterMonths only has work to do when a PAST month was
// mutated, but it discovered the later months with ListAllMonthsLegacy —
// a full-table Scan — BEFORE learning there were none. Since carry-over
// defaults on and an expense delta is never zero, every single add/edit/
// delete Scanned the whole table, and DynamoDB bills a Scan for every
// item it reads. Cost grew with every expense ever written.
//
// The MONTHLIST index answers "which months come after this one?" with a
// sorted Query, but it cannot simply be trusted: a table written before
// the index existed has an empty (or, once a mutation back-fills a single
// month via EnsureMonthListMirror, a PARTIAL) partition, and reading a
// partial index would silently miss later months and leave their carried
// balances wrong forever.
//
// So the index is made authoritative first: one lazy migration per
// process (the same scan-and-backfill ListMonths already performs), then
// every later discovery is a Query. The invariant these tests pin is
// "at most one Scan per service instance, not one per write".
// =====================================================================

func TestExpenseMutation_DoesNotScanTablePerWrite(t *testing.T) {
	ctx := context.Background()

	seed := func(t *testing.T) (*ExpenseService, *testutil.FakeRepo) {
		t.Helper()
		svc, repo := newExpenseService(t, true, true, 100)
		testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
		testutil.SeedMonth(repo, "2026-02", 100, 100, 0, 200)
		testutil.SeedMonth(repo, "2026-03", 200, 100, 0, 300)
		repo.Balance = &model.Balance{TotalBalance: 300}
		return svc, repo
	}

	t.Run("repeated AddExpense scans at most once", func(t *testing.T) {
		svc, repo := seed(t)
		for i := 0; i < 5; i++ {
			if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
				Amount: 5, Description: "book", Month: "2026-03",
			}); err != nil {
				t.Fatalf("AddExpense #%d: %v", i, err)
			}
		}
		if repo.LegacyScans > 1 {
			t.Errorf("full-table Scans = %d after 5 adds, want <= 1 — the "+
				"Scan must be a one-time migration, not per-write", repo.LegacyScans)
		}
	})

	t.Run("mixed mutations scan at most once", func(t *testing.T) {
		svc, repo := seed(t)
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey("2026-03", id)] = &model.Expense{SK: id, Amount: 25}
		repo.Months["2026-03"].TotalExpenses = 25
		repo.Months["2026-03"].EndingBalance = 275

		newAmount := 40.0
		if _, err := svc.UpdateExpense(ctx, "2026-03", id,
			&model.UpdateExpenseRequest{Amount: &newAmount}); err != nil {
			t.Fatalf("UpdateExpense: %v", err)
		}
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
			Amount: 5, Description: "x", Month: "2026-02",
		}); err != nil {
			t.Fatalf("AddExpense: %v", err)
		}
		if err := svc.DeleteExpense(ctx, "2026-03", id); err != nil {
			t.Fatalf("DeleteExpense: %v", err)
		}
		if repo.LegacyScans > 1 {
			t.Errorf("full-table Scans = %d across 3 mutations, want <= 1", repo.LegacyScans)
		}
	})

	// The past-month case still has real work to do; this pins that the
	// short-circuit did not break it (the propagation must still happen).
	t.Run("past month still propagates", func(t *testing.T) {
		svc, repo := seed(t)
		_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
			Amount: 30, Description: "past", Month: "2026-01",
		})
		if err != nil {
			t.Fatalf("AddExpense: %v", err)
		}
		if got := repo.Months["2026-02"].StartingBalance; got != 70 {
			t.Errorf("Feb starting = %v, want 70 (carry shifted by -30)", got)
		}
		if got := repo.Months["2026-03"].EndingBalance; got != 270 {
			t.Errorf("Mar ending = %v, want 270 (carry shifted by -30)", got)
		}
	})

	// A table written before the MONTHLIST scheme has an empty mirror
	// partition. "No later months" must NOT be inferred from that emptiness
	// — propagation must still land.
	//
	// The SECOND mutation is the sharp edge: by then AddExpense's
	// EnsureMonthListMirror has back-filled the mutated month, so a naive
	// "is this the newest month in MONTHLIST?" check sees {2026-01}, decides
	// January is the latest month, and skips propagation — silently leaving
	// February's carried balance wrong. Both mutations must propagate.
	t.Run("legacy table without mirrors still propagates", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		testutil.SeedLegacyMonth(repo, "2026-01", 0, 100, 0, 100)
		testutil.SeedLegacyMonth(repo, "2026-02", 100, 100, 0, 200)
		repo.Balance = &model.Balance{TotalBalance: 200}

		for i, want := range []float64{70, 40} {
			if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
				Amount: 30, Description: "past", Month: "2026-01",
			}); err != nil {
				t.Fatalf("AddExpense #%d on legacy table: %v", i, err)
			}
			if got := repo.Months["2026-02"].StartingBalance; got != want {
				t.Fatalf("after mutation #%d: Feb starting = %v, want %v "+
					"(legacy carry propagation lost)", i, got, want)
			}
			if got := repo.MonthList["2026-02"].StartingBalance; got != want {
				t.Fatalf("after mutation #%d: Feb mirror starting = %v, want %v",
					i, got, want)
			}
		}
	})
}

// TestPropagation_IgnoresOrphanMonthListMirror pins a hazard created by
// sourcing later months from the MONTHLIST index instead of the canonical
// rows: a mirror row whose MONTH#<m>/SUMMARY row is gone.
//
// Reading canonical rows made such an orphan inert. Reading the index puts
// it into the propagation set, where EnsureMonthListMirror no-ops (the
// mirror is present, so there is nothing to back-fill) and
// PropagateLaterMonthDeltas' attribute_exists(PK) condition on the CANONICAL
// leg then cancels the whole TransactWriteItems — taking every legitimate
// later month down with it, after the originating mutation has already
// committed. The user sees a 500 on an expense that was in fact saved, and
// the carry chain is left half-updated.
//
// Orphans are producible: scripts/add-data.sh's rmmonth deletes the
// canonical row and the mirror in separate calls, so an interruption
// between them leaves one behind, and DeleteMonth cannot clear it (it
// pre-reads the canonical summary and returns ErrMonthNotFound first).
func TestPropagation_IgnoresOrphanMonthListMirror(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 100, 100, 0, 200)
	repo.Balance = &model.Balance{TotalBalance: 200}

	// A mirror with no canonical row behind it.
	repo.MonthList["2026-03"] = &model.MonthSummary{
		Month: "2026-03", StartingBalance: 200, EndingBalance: 300,
	}

	if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount: 30, Description: "past", Month: "2026-01",
	}); err != nil {
		t.Fatalf("AddExpense failed because of an orphan mirror: %v", err)
	}

	// The real later month must still have been shifted.
	if got := repo.Months["2026-02"].StartingBalance; got != 70 {
		t.Errorf("Feb starting = %v, want 70 (propagation must survive the orphan)", got)
	}
	if got := repo.Months["2026-02"].EndingBalance; got != 170 {
		t.Errorf("Feb ending = %v, want 170", got)
	}
	assertLedgerConsistent(t, repo, "2026-01", "2026-02")
}

// =====================================================================
// Carry chain on MONTH-level mutations.
//
// propagateToLaterMonths is wired into every EXPENSE mutation, but the
// three month-level operations that also move money — AddFunds,
// CreateMonth, DeleteMonth — skipped it. Applied to anything other than
// the newest month, each one shifted that month's ending balance and the
// global BALANCE while leaving every later month's carried balance
// untouched, so the two drifted apart permanently and every later write
// compounded the gap.
//
// The invariant each test asserts is the one that actually matters to a
// user: with carry-over on, the global BALANCE equals the newest month's
// ending balance.
// =====================================================================

// assertLedgerConsistent checks the carry chain end to end: every month's
// starting balance equals the previous month's ending balance, each ending
// balance follows from its own inputs, and the global BALANCE matches the
// newest month's ending balance. months must be in ascending order.
func assertLedgerConsistent(t *testing.T, repo *testutil.FakeRepo, months ...string) {
	t.Helper()
	var prevEnding float64
	for i, m := range months {
		s := repo.Months[m]
		if s == nil {
			t.Fatalf("month %s missing", m)
		}
		if i > 0 && s.StartingBalance != prevEnding {
			t.Errorf("%s starting = %v, want %v (previous month's ending)",
				m, s.StartingBalance, prevEnding)
		}
		if want := s.StartingBalance + s.AllowanceAdded - s.TotalExpenses; s.EndingBalance != want {
			t.Errorf("%s ending = %v, want %v (start + allowance - expenses)",
				m, s.EndingBalance, want)
		}
		if mirror := repo.MonthList[m]; mirror != nil {
			if mirror.StartingBalance != s.StartingBalance || mirror.EndingBalance != s.EndingBalance {
				t.Errorf("%s mirror (%v/%v) drifted from canonical (%v/%v)",
					m, mirror.StartingBalance, mirror.EndingBalance,
					s.StartingBalance, s.EndingBalance)
			}
		}
		prevEnding = s.EndingBalance
	}
	if repo.Balance.TotalBalance != prevEnding {
		t.Errorf("global BALANCE = %v, want %v (newest month's ending balance)",
			repo.Balance.TotalBalance, prevEnding)
	}
}

func TestAddFunds_PropagatesCarryToLaterMonths(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 100, 100, 0, 200)
	testutil.SeedMonth(repo, "2026-03", 200, 100, 0, 300)
	repo.Balance = &model.Balance{TotalBalance: 300}

	// Top up a PAST month: January's ending rises by 50, so February and
	// March must each carry 50 more.
	if _, err := svc.AddFunds(ctx, "2026-01", 50); err != nil {
		t.Fatalf("AddFunds: %v", err)
	}

	if got := repo.Months["2026-01"].EndingBalance; got != 150 {
		t.Errorf("Jan ending = %v, want 150", got)
	}
	if got := repo.Months["2026-02"].StartingBalance; got != 150 {
		t.Errorf("Feb starting = %v, want 150 (carry shifted by +50)", got)
	}
	if got := repo.Months["2026-03"].EndingBalance; got != 350 {
		t.Errorf("Mar ending = %v, want 350 (carry shifted by +50)", got)
	}
	assertLedgerConsistent(t, repo, "2026-01", "2026-02", "2026-03")
}

func TestCreateMonth_PropagatesCarryToLaterMonths(t *testing.T) {
	ctx := context.Background()

	t.Run("back-filling a skipped month re-links the chain", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		// January and March exist; February was skipped, so March carried
		// straight from January.
		testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
		testutil.SeedMonth(repo, "2026-03", 100, 100, 0, 200)
		repo.Balance = &model.Balance{TotalBalance: 200}

		if _, err := svc.CreateMonth(ctx, "2026-02"); err != nil {
			t.Fatalf("CreateMonth: %v", err)
		}

		// February carries from January and adds its own allowance, so March
		// must now start from February's ending, not January's.
		if got := repo.Months["2026-02"].EndingBalance; got != 200 {
			t.Errorf("Feb ending = %v, want 200", got)
		}
		if got := repo.Months["2026-03"].StartingBalance; got != 200 {
			t.Errorf("Mar starting = %v, want 200 (should carry from Feb, not Jan)", got)
		}
		assertLedgerConsistent(t, repo, "2026-01", "2026-02", "2026-03")
	})

	t.Run("activating an auto-created zero-allowance month", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 100)
		testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
		// February was auto-created by an expense filed into it, so it carries
		// a $0 allowance. CreateMonth activates the real allowance (U1).
		testutil.SeedMonth(repo, "2026-02", 100, 0, 20, 80)
		testutil.SeedMonth(repo, "2026-03", 80, 100, 0, 180)
		repo.Balance = &model.Balance{TotalBalance: 180}

		if _, err := svc.CreateMonth(ctx, "2026-02"); err != nil {
			t.Fatalf("CreateMonth (activation): %v", err)
		}

		if got := repo.Months["2026-02"].AllowanceAdded; got != 100 {
			t.Errorf("Feb allowance = %v, want 100", got)
		}
		if got := repo.Months["2026-03"].StartingBalance; got != 180 {
			t.Errorf("Mar starting = %v, want 180 (carry shifted by +100)", got)
		}
		assertLedgerConsistent(t, repo, "2026-01", "2026-02", "2026-03")
	})
}

func TestDeleteMonth_PropagatesCarryToLaterMonths(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-02", 100, 100, 0, 200)
	testutil.SeedMonth(repo, "2026-03", 200, 100, 0, 300)
	repo.Balance = &model.Balance{TotalBalance: 300}

	// Removing February takes its $100 allowance out of the ledger, so March
	// must fall back to carrying from January.
	if err := svc.DeleteMonth(ctx, "2026-02"); err != nil {
		t.Fatalf("DeleteMonth: %v", err)
	}

	if repo.Months["2026-02"] != nil {
		t.Fatal("Feb still present after delete")
	}
	if got := repo.Months["2026-03"].StartingBalance; got != 100 {
		t.Errorf("Mar starting = %v, want 100 (should carry from Jan now)", got)
	}
	if got := repo.Months["2026-03"].EndingBalance; got != 200 {
		t.Errorf("Mar ending = %v, want 200", got)
	}
	assertLedgerConsistent(t, repo, "2026-01", "2026-03")
}

// Carry-over off means later months start from zero, so none of the three
// month-level operations may touch them.
func TestMonthMutations_NoPropagationWhenCarryDisabled(t *testing.T) {
	ctx := context.Background()

	newSvc := func(t *testing.T) (*ExpenseService, *testutil.FakeRepo) {
		t.Helper()
		svc, repo := newExpenseService(t, true, false, 100)
		testutil.SeedMonth(repo, "2026-01", 0, 100, 0, 100)
		testutil.SeedMonth(repo, "2026-02", 0, 100, 0, 100)
		repo.Balance = &model.Balance{TotalBalance: 200}
		return svc, repo
	}

	t.Run("AddFunds", func(t *testing.T) {
		svc, repo := newSvc(t)
		if _, err := svc.AddFunds(ctx, "2026-01", 50); err != nil {
			t.Fatalf("AddFunds: %v", err)
		}
		if got := repo.Months["2026-02"].StartingBalance; got != 0 {
			t.Errorf("Feb starting = %v, want 0 (no carry, no propagation)", got)
		}
	})

	t.Run("DeleteMonth", func(t *testing.T) {
		svc, repo := newSvc(t)
		if err := svc.DeleteMonth(ctx, "2026-01"); err != nil {
			t.Fatalf("DeleteMonth: %v", err)
		}
		if got := repo.Months["2026-02"].StartingBalance; got != 0 {
			t.Errorf("Feb starting = %v, want 0 (no carry, no propagation)", got)
		}
	})
}

// TestListMonths_ReturnsTotalExpenses pins that the months list carries the
// per-month spend figure.
//
// The menu renders a relative spend bar per month, scaled by the largest
// total_expenses across the listed months (ui.maxMonthExpenses). MonthListItem
// only ever carried month and monthly_saved, so that scale was always 0 and
// the `maxExpenses > 0` guard meant the bar never rendered — a feature that
// existed in the CSS and the DOM builder but could not appear.
func TestListMonths_ReturnsTotalExpenses(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 100)
	testutil.SeedMonth(repo, "2026-01", 0, 100, 30, 70)
	testutil.SeedMonth(repo, "2026-02", 70, 100, 55.5, 114.5)
	repo.Balance = &model.Balance{TotalBalance: 114.5}

	resp, err := svc.ListMonths(ctx, 50, "")
	if err != nil {
		t.Fatalf("ListMonths: %v", err)
	}
	if len(resp.Months) != 2 {
		t.Fatalf("months = %d, want 2", len(resp.Months))
	}

	got := map[string]float64{}
	for _, m := range resp.Months {
		got[m.Month] = m.TotalExpenses
	}
	if got["2026-01"] != 30 {
		t.Errorf("2026-01 total_expenses = %v, want 30", got["2026-01"])
	}
	if got["2026-02"] != 55.5 {
		t.Errorf("2026-02 total_expenses = %v, want 55.5", got["2026-02"])
	}
}
