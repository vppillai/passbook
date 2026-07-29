package service

import (
	"context"
	"errors"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// Clearing the per-IP failure counter is bookkeeping performed AFTER a login has
// already succeeded. VerifyPIN treated it that way — log the failure and carry on
// — but WebAuthnService.FinishLogin returned the error, turning a valid biometric
// unlock into a 500 because a counter write blipped. The counter's own 15-minute
// TTL expires the window regardless, so there is nothing to protect by failing.
//
// The two success tails were otherwise identical (clear the counter, mint a
// token, return the same body), so they are one function now. That is the actual
// fix: with one implementation the two paths cannot disagree about this again.

func TestMintSession_SurvivesAFailureToClearTheRateLimit(t *testing.T) {
	ctx := context.Background()
	repo := testutil.NewFakeRepo()
	repo.ClearRateLimitErr = errors.New("transient DynamoDB failure")

	resp, err := mintSession(ctx, repo, "203.0.113.9")
	if err != nil {
		t.Fatalf("mintSession failed because the counter could not be cleared: %v — the "+
			"login had already succeeded", err)
	}
	if !resp.Success || resp.Token == "" {
		t.Fatalf("resp = %+v, want a successful response carrying a token", resp)
	}
	if len(repo.Sessions) != 1 {
		t.Errorf("sessions = %d, want 1", len(repo.Sessions))
	}
}

// The session itself is not optional: if the token cannot be persisted the caller
// must NOT be told it is logged in.
func TestMintSession_FailsWhenTheSessionCannotBePersisted(t *testing.T) {
	ctx := context.Background()
	repo := testutil.NewFakeRepo()
	repo.CreateSessionErr = errors.New("transient DynamoDB failure")

	if _, err := mintSession(ctx, repo, "203.0.113.9"); err == nil {
		t.Fatal("mintSession succeeded although the session could not be stored")
	}
}

// On a clean run the counter really is cleared, so an earlier fumble does not
// linger.
func TestMintSession_ClearsTheCounterOnSuccess(t *testing.T) {
	ctx := context.Background()
	repo := testutil.NewFakeRepo()
	const ip = "192.168.1.4"
	if _, err := repo.IncrementFailedAttempts(ctx, ip, maxAttempts); err != nil {
		t.Fatalf("seeding: %v", err)
	}

	if _, err := mintSession(ctx, repo, ip); err != nil {
		t.Fatalf("mintSession: %v", err)
	}
	if entry, err := repo.GetRateLimitEntry(ctx, ip); err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	} else if entry != nil && entry.Attempts != 0 {
		t.Errorf("attempts = %d, want cleared", entry.Attempts)
	}
}

// And the same property end-to-end through the PIN path, so the shared helper is
// genuinely the one being used.
func TestVerifyPIN_SucceedsDespiteAFailureToClearTheRateLimit(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")
	repo.ClearRateLimitErr = errors.New("transient DynamoDB failure")

	resp, err := svc.VerifyPIN(ctx, "1234", "192.0.2.44")
	if err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	if !resp.Success || resp.Token == "" {
		t.Errorf("resp = %+v, want success — the correct PIN was refused because a "+
			"counter write failed", resp)
	}
}

// DeleteMonth pre-read the summary and then handed its allowance_added figure to
// the transaction that debits the global balance. The delete was conditioned on
// total_expenses = 0 but NOT on allowance_added, so a concurrent top-up between
// the read and the write left the debit stale: the month row disappeared while
// the balance kept the difference, and nothing recomputes it afterwards.
func TestDeleteMonth_RefusesWhenTheAllowanceChangedUnderIt(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-03", 0, 100, 0, 100)
	repo.Balance = &model.Balance{TotalBalance: 100}

	// Stand in for a top-up that lands between the pre-read and the delete: the
	// stored allowance no longer matches what DeleteMonth is about to debit.
	repo.BeforeDeleteMonth = func() {
		m := repo.Months["2026-03"]
		m.AllowanceAdded = 150
		m.EndingBalance = 150
		repo.Balance.TotalBalance = 150
	}

	err := svc.DeleteMonth(ctx, "2026-03")
	if !errors.Is(err, ErrMonthModified) {
		t.Fatalf("err = %v, want ErrMonthModified", err)
	}
	if repo.Months["2026-03"] == nil {
		t.Error("the month was deleted despite its allowance changing under the delete")
	}
	if got := repo.Balance.TotalBalance; got != 150 {
		t.Errorf("global balance = %.2f, want 150 — a stale allowance was debited", got)
	}
}

// The ordinary delete must be unaffected.
func TestDeleteMonth_StillDeletesAnUnchangedMonth(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-02", 0, 100, 0, 100)
	testutil.SeedMonth(repo, "2026-03", 100, 100, 0, 200)
	repo.Balance = &model.Balance{TotalBalance: 200}

	if err := svc.DeleteMonth(ctx, "2026-02"); err != nil {
		t.Fatalf("DeleteMonth: %v", err)
	}
	if repo.Months["2026-02"] != nil {
		t.Error("month not deleted")
	}
	if got := repo.Balance.TotalBalance; got != 100 {
		t.Errorf("global balance = %.2f, want 100 (200 - the deleted month's 100)", got)
	}
	// March must fall back to carrying nothing, since February is gone.
	if got := repo.Months["2026-03"].StartingBalance; got != 0 {
		t.Errorf("March starting_balance = %.2f, want 0", got)
	}
}

// A month that still has expenses is a different refusal, and must stay one.
func TestDeleteMonth_MonthWithExpensesIsStillRefusedAsSuch(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-03", 0, 100, 25, 75)
	repo.Balance = &model.Balance{TotalBalance: 75}

	if err := svc.DeleteMonth(ctx, "2026-03"); !errors.Is(err, ErrMonthHasExpenses) {
		t.Fatalf("err = %v, want ErrMonthHasExpenses", err)
	}
}

// A month that vanished under the delete is not a modification.
func TestDeleteMonth_VanishedMonthReportsNotFound(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, false, true, 100)
	testutil.SeedMonth(repo, "2026-03", 0, 100, 0, 100)
	repo.Balance = &model.Balance{TotalBalance: 100}

	repo.BeforeDeleteMonth = func() {
		delete(repo.Months, "2026-03")
		delete(repo.MonthList, "2026-03")
	}

	if err := svc.DeleteMonth(ctx, "2026-03"); !errors.Is(err, ErrMonthNotFound) {
		t.Fatalf("err = %v, want ErrMonthNotFound", err)
	}
}
