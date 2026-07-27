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
