package service

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/vppillai/passbook/backend/internal/repository"
)

// /api/auth/change verified the CURRENT PIN with no rate limiting of any kind,
// which made it an unbounded guessing oracle. Every other path to the PIN is
// capped — VerifyPIN checks a per-IP counter and an account-wide one before it
// will even evaluate a hash — but the change endpoint ran verifyPINHash on
// whatever it was handed and answered "Current PIN is incorrect", forever.
//
// A session token is required, which narrows who can reach it but does not make
// it harmless. It is exactly the position ChangePIN's own comment already
// worries about ("an attacker who reached an authenticated session once"), and
// the everyday version is more mundane: a household device left unlocked. 10,000
// combinations against an endpoint with no cap is minutes of scripted work, and
// the PIN is the credential that outlives the session.
//
// A wrong current-PIN is a wrong PIN guess, so it draws down the SAME budget as
// a wrong PIN at the lock screen. Otherwise capping verify accomplishes nothing:
// the attacker just moves to the endpoint that doesn't count.
func TestChangePIN_WrongCurrentPINConsumesTheSameBudgetAsVerify(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	const ip = "203.0.113.5"
	for i := 0; i < maxAttempts; i++ {
		err := svc.ChangePIN(ctx, fmt.Sprintf("99%02d", i), "5678", ip)
		if !errors.Is(err, ErrInvalidPIN) {
			t.Fatalf("guess %d: err = %v, want ErrInvalidPIN", i, err)
		}
	}

	// The per-IP budget is spent. A further guess must be refused outright
	// rather than evaluated.
	err := svc.ChangePIN(ctx, "9999", "5678", ip)
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("guess past the cap: err = %v, want ErrRateLimited — the endpoint "+
			"is still an unbounded oracle", err)
	}

	// And the budget is genuinely shared with the lock screen, not a separate
	// allowance per endpoint.
	resp, verr := svc.VerifyPIN(ctx, "1234", ip)
	if verr != nil {
		t.Fatalf("VerifyPIN: %v", verr)
	}
	if resp.Success {
		t.Error("guesses spent at /auth/change did not count against the lock screen; " +
			"an attacker can alternate endpoints to double their budget")
	}
}

// The refusal has to come BEFORE the hash comparison, or the cap cannot stop a
// guess from being evaluated — the same property VerifyPIN is held to.
func TestChangePIN_RefusesBeforeEvaluatingEvenTheCorrectPIN(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	const ip = "198.51.100.20"
	for i := 0; i < maxAttempts; i++ {
		if err := svc.ChangePIN(ctx, "0000", "5678", ip); !errors.Is(err, ErrInvalidPIN) {
			t.Fatalf("guess %d: err = %v, want ErrInvalidPIN", i, err)
		}
	}

	if err := svc.ChangePIN(ctx, "1234", "5678", ip); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited: the correct PIN was still evaluated "+
			"past the cap, so the cap is applied after the comparison", err)
	}
	// The PIN must not have changed.
	if resp, err := svc.VerifyPIN(ctx, "5678", "10.0.0.99"); err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	} else if resp.Success {
		t.Error("the rate-limited ChangePIN still rotated the PIN")
	}
}

// The account-wide cap applies here too. Without it, /auth/change is a way
// around the very control that bounds distributed guessing.
func TestChangePIN_HonoursTheAccountWideCap(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	seedGlobalAttempts(t, repo, globalMaxAttempts)

	// A clean IP with its full per-IP budget must still be refused.
	if err := svc.ChangePIN(ctx, "9999", "5678", "192.0.2.77"); !errors.Is(err, ErrRateLimited) {
		t.Errorf("err = %v, want ErrRateLimited past the account-wide cap", err)
	}
}

// A wrong current-PIN must also feed the account-wide counter, so guesses made
// here are visible to the control that bounds the whole account.
func TestChangePIN_WrongCurrentPINFeedsTheAccountWideCounter(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	before, err := repo.GetRateLimitEntry(ctx, repository.RateLimitScopeGlobal)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	if before != nil && before.Attempts != 0 {
		t.Fatalf("global counter not clean: %d", before.Attempts)
	}

	if err := svc.ChangePIN(ctx, "9999", "5678", "192.0.2.10"); !errors.Is(err, ErrInvalidPIN) {
		t.Fatalf("err = %v, want ErrInvalidPIN", err)
	}

	after, err := repo.GetRateLimitEntry(ctx, repository.RateLimitScopeGlobal)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	if after == nil || after.Attempts != 1 {
		t.Errorf("global attempts = %v, want 1 — guesses at /auth/change are invisible "+
			"to the account-wide cap", after)
	}
}

// A legitimate change must not be punished: getting it right clears the per-IP
// counter, exactly as a successful verify does, so an earlier fumble does not
// linger and eat into the lock screen's budget.
func TestChangePIN_SuccessClearsThePerIPCounter(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	const ip = "192.168.1.50"
	if err := svc.ChangePIN(ctx, "0000", "5678", ip); !errors.Is(err, ErrInvalidPIN) {
		t.Fatalf("err = %v, want ErrInvalidPIN", err)
	}
	if err := svc.ChangePIN(ctx, "1234", "5678", ip); err != nil {
		t.Fatalf("legitimate change refused: %v", err)
	}

	entry, err := repo.GetRateLimitEntry(ctx, ip)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	if entry != nil && entry.Attempts != 0 {
		t.Errorf("per-IP attempts = %d after a successful change, want cleared", entry.Attempts)
	}
}

// A malformed NEW pin is rejected before the current PIN is looked at, so it
// must not spend guess budget — and, more importantly, it reveals nothing about
// the current PIN either way.
func TestChangePIN_InvalidNewPINDoesNotConsumeBudget(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	const ip = "192.0.2.200"
	if err := svc.ChangePIN(ctx, "1234", "12", ip); !errors.Is(err, ErrPINTooShort) {
		t.Fatalf("err = %v, want ErrPINTooShort", err)
	}
	entry, err := repo.GetRateLimitEntry(ctx, ip)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	if entry != nil && entry.Attempts != 0 {
		t.Errorf("per-IP attempts = %d, want 0: a malformed new PIN is a client "+
			"mistake, not a guess", entry.Attempts)
	}
}
