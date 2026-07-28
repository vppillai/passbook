package service

import (
	"context"
	"fmt"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// The per-IP limiter (5 per 15 min) exists so one attacker cannot lock the
// family out. It does nothing about DISTRIBUTED guessing: a 4-digit PIN is
// 10,000 combinations, and 5 free guesses per IP means ~2,000 IPs exhausts the
// whole keyspace inside a single window. Argon2's cost is then the only thing
// standing in the way.
//
// A global counter bounds total wrong guesses regardless of source. It is set
// far above any believable legitimate use, because it necessarily trades
// availability for brute-force resistance: while it is tripped, even the
// correct PIN is refused.
func TestVerifyPIN_GlobalCapBoundsDistributedGuessing(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	// One short of the cap, then cross it with a REAL verify from a fresh IP —
	// so the boundary transition itself goes through VerifyPIN.
	seedGlobalAttempts(t, repo, globalMaxAttempts-1)
	crossing, err := svc.VerifyPIN(ctx, "9999", "10.0.0.1")
	if err != nil {
		t.Fatalf("boundary attempt: %v", err)
	}
	if crossing.Success {
		t.Fatal("wrong PIN succeeded")
	}

	// A brand-new IP with a clean per-IP counter must now be refused.
	resp, err := svc.VerifyPIN(ctx, "9999", "203.0.113.7")
	if err != nil {
		t.Fatalf("post-cap attempt: %v", err)
	}
	if resp.Success {
		t.Fatal("attempt past the global cap succeeded")
	}
	if resp.RetryAfterSeconds == nil {
		t.Error("expected a rate-limited response (RetryAfterSeconds set) past the global cap")
	}

	// And the correct PIN from another clean IP is refused too. This is the
	// deliberate cost of the global cap, pinned here so the trade-off cannot
	// be changed by accident: an attacker CAN deny PIN login for the window.
	// Biometric unlock stays available (see the exemption test below), which
	// is what keeps that acceptable.
	correct, err := svc.VerifyPIN(ctx, "1234", "198.51.100.9")
	if err != nil {
		t.Fatalf("correct-PIN attempt: %v", err)
	}
	if correct.Success {
		t.Error("correct PIN succeeded past the global cap — the cap is not being applied " +
			"before verification, so it cannot stop guessing")
	}
}

// Below the global cap, a clean IP is unaffected — the cap must not degrade
// ordinary use.
func TestVerifyPIN_GlobalCapDoesNotAffectNormalUse(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	// A handful of genuine fat-fingers from one household, well under the cap.
	for i := 0; i < 3; i++ {
		if _, err := svc.VerifyPIN(ctx, "9999", "192.168.1.10"); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	resp, err := svc.VerifyPIN(ctx, "1234", "192.168.1.10")
	if err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	if !resp.Success {
		t.Fatalf("correct PIN refused well under the global cap: %+v", resp)
	}
	if resp.Token == "" {
		t.Error("no session token on success")
	}
}

// Biometric login must NOT be subject to the global PIN cap. A WebAuthn
// credential is not guessable, so it contributes nothing to the brute-force
// risk the cap exists for — and exempting it is what stops a distributed
// attacker from locking an enrolled owner out of their own app.
func TestWebAuthnLogin_ExemptFromGlobalPINCap(t *testing.T) {
	ctx := context.Background()
	_, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	seedGlobalAttempts(t, repo, globalMaxAttempts)

	// The global PIN cap is tripped. A biometric ceremony from a clean IP must
	// still be allowed to run — it fails here for lack of a real
	// authenticator, but it must fail on VERIFICATION, not be refused up front
	// as rate-limited.
	waSvc, waRepo := newWebAuthnService(t)
	seedPIN(t, waRepo, "1234")
	seedGlobalAttempts(t, waRepo, globalMaxAttempts)
	seedChallenge(t, waRepo, "chal-1")
	resp, err := waSvc.FinishLogin(ctx, &model.WebAuthnVerifyRequest{
		ChallengeID: "chal-1",
		Credential:  []byte(`{"bogus":true}`),
	}, "198.51.100.42")
	if err != nil {
		t.Fatalf("FinishLogin returned a hard error: %v", err)
	}
	if resp.RetryAfterSeconds != nil {
		t.Error("biometric login was refused as rate-limited by the global PIN cap; " +
			"an enrolled user must keep a way in during a distributed PIN attack")
	}
}

// An attacker must not be able to hold the PIN path shut indefinitely by
// continuing to hammer it. IncrementFailedAttempts is conditional on
// `attempts < :max`, so once the cap is reached the write fails and the row's
// 15-minute TTL stops being refreshed — the window therefore expires 15
// minutes after the attempt that reached the cap, no matter how long the
// attack continues. That is the property bounding the availability cost.
func TestVerifyPIN_GlobalCapWindowIsNotExtendedByFurtherAttempts(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	seedGlobalAttempts(t, repo, globalMaxAttempts)

	entry, err := repo.GetRateLimitEntry(ctx, repository.RateLimitScopeGlobal)
	if err != nil || entry == nil {
		t.Fatalf("global entry missing: %v", err)
	}
	ttlAtCap := entry.TTL
	if entry.Attempts != globalMaxAttempts {
		t.Fatalf("attempts = %d, want %d", entry.Attempts, globalMaxAttempts)
	}

	// Keep hammering from fresh addresses past the cap, through the real path.
	for i := 0; i < 3; i++ {
		if _, err := svc.VerifyPIN(ctx, "9999", fmt.Sprintf("10.4.0.%d", i)); err != nil {
			t.Fatalf("post-cap attempt %d: %v", i, err)
		}
	}

	after, err := repo.GetRateLimitEntry(ctx, repository.RateLimitScopeGlobal)
	if err != nil || after == nil {
		t.Fatalf("global entry missing after hammering: %v", err)
	}
	if after.TTL != ttlAtCap {
		t.Errorf("TTL moved from %d to %d — a sustained attack is extending the "+
			"lockout window, so the outage would never end", ttlAtCap, after.TTL)
	}
	if after.Attempts != globalMaxAttempts {
		t.Errorf("attempts = %d, want it pinned at %d", after.Attempts, globalMaxAttempts)
	}
}

// seedGlobalAttempts drives the account-wide counter to n WITHOUT going through
// VerifyPIN. Each real verify runs a full Argon2 hash (~tens of ms), so looping
// 50 of them per test added a minute to the suite for no extra coverage: the
// counter arithmetic is the repository's, already covered, and what these tests
// care about is the decision VerifyPIN makes at the boundary. The boundary
// crossing itself is still exercised end-to-end below.
func seedGlobalAttempts(t *testing.T, repo *testutil.FakeRepo, n int) {
	t.Helper()
	ctx := context.Background()
	for i := 0; i < n; i++ {
		if _, err := repo.IncrementFailedAttempts(ctx, repository.RateLimitScopeGlobal, globalMaxAttempts); err != nil {
			t.Fatalf("seeding global attempt %d: %v", i, err)
		}
	}
}
