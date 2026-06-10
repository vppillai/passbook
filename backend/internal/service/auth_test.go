package service

import (
	"context"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// newAuthService builds an AuthService against the shared in-memory
// FakeRepo.
func newAuthService(t *testing.T) (*AuthService, *testutil.FakeRepo) {
	t.Helper()
	repo := testutil.NewFakeRepo()
	return NewAuthService(repo), repo
}

// seedPIN hashes the given PIN (real Argon2 — ~tens of ms) and installs
// it as the stored config. Call once per test function, not per subtest,
// to keep the suite fast.
func seedPIN(t *testing.T, repo *testutil.FakeRepo, pin string) {
	t.Helper()
	hash, err := hashPIN(pin)
	if err != nil {
		t.Fatalf("hashPIN failed: %v", err)
	}
	repo.Config = &model.Config{PinHash: hash}
}

// TestValidatePIN exercises the boundary cases of validatePIN. These are
// pure, deterministic, and the cheapest possible signal that the rule
// "4-6 ASCII digits" hasn't drifted.
func TestValidatePIN(t *testing.T) {
	tests := []struct {
		name    string
		pin     string
		wantErr error
	}{
		{"empty", "", ErrPINTooShort},
		{"three digits", "123", ErrPINTooShort},
		{"four digits ok", "1234", nil},
		{"five digits ok", "12345", nil},
		{"six digits ok", "123456", nil},
		{"seven digits too long", "1234567", ErrPINTooShort},
		{"alpha", "abcd", ErrPINNotNumeric},
		{"mixed alphanum", "12a4", ErrPINNotNumeric},
		{"space inside", "12 4", ErrPINNotNumeric},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePIN(tc.pin)
			if err != tc.wantErr {
				t.Errorf("validatePIN(%q) = %v, want %v", tc.pin, err, tc.wantErr)
			}
		})
	}
}

// TestHashAndVerifyPIN_RoundTrip catches a class of bug that would otherwise
// lock out every user silently: if hashPIN's PHC format string ever drifts
// from what verifyPIN's Sscanf expects, hashes look fine on disk but no
// PIN ever verifies. This test fails immediately on that drift.
func TestHashAndVerifyPIN_RoundTrip(t *testing.T) {
	pin := "246810"
	hash, err := hashPIN(pin)
	if err != nil {
		t.Fatalf("hashPIN failed: %v", err)
	}
	if hash == "" {
		t.Fatal("hashPIN returned empty hash")
	}

	ok, err := verifyPINHash(pin, hash)
	if err != nil {
		t.Fatalf("verifyPINHash(correct pin) failed: %v", err)
	}
	if !ok {
		t.Fatal("verifyPIN returned false for the same PIN that produced the hash — round-trip broken")
	}

	ok, err = verifyPINHash("999999", hash)
	if err != nil {
		t.Fatalf("verifyPINHash(wrong pin) errored: %v", err)
	}
	if ok {
		t.Fatal("verifyPIN returned true for a different PIN — constant-time compare broken")
	}
}

// =====================================================================
// TestSetupPIN covers first-time setup: validation, the happy path, and
// the duplicate-setup race guard (CreateConfig conditional).
// =====================================================================
func TestSetupPIN(t *testing.T) {
	ctx := context.Background()

	t.Run("invalid PINs rejected before hashing", func(t *testing.T) {
		svc, repo := newAuthService(t)
		if err := svc.SetupPIN(ctx, "12"); err != ErrPINTooShort {
			t.Errorf("expected ErrPINTooShort, got %v", err)
		}
		if err := svc.SetupPIN(ctx, "12ab"); err != ErrPINNotNumeric {
			t.Errorf("expected ErrPINNotNumeric, got %v", err)
		}
		if repo.Config != nil {
			t.Error("config written despite invalid PIN")
		}
	})

	t.Run("happy path then duplicate rejected", func(t *testing.T) {
		svc, repo := newAuthService(t)
		if err := svc.SetupPIN(ctx, "1234"); err != nil {
			t.Fatalf("SetupPIN failed: %v", err)
		}
		if repo.Config == nil || repo.Config.PinHash == "" {
			t.Fatal("config/PinHash not written")
		}
		if err := svc.SetupPIN(ctx, "5678"); err != ErrPINAlreadySet {
			t.Errorf("expected ErrPINAlreadySet on second setup, got %v", err)
		}
	})
}

// =====================================================================
// TestVerifyPIN covers the session-minting flow and the per-IP rate
// limiting around it — none of which was previously under test.
// =====================================================================
func TestVerifyPIN(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	t.Run("not set up", func(t *testing.T) {
		emptySvc, _ := newAuthService(t)
		resp, err := emptySvc.VerifyPIN(ctx, "1234", "ip-a")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Success {
			t.Error("Success = true with no PIN configured")
		}
	})

	t.Run("wrong PIN increments per-IP counter", func(t *testing.T) {
		resp, err := svc.VerifyPIN(ctx, "9999", "ip-b")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Success {
			t.Fatal("Success = true for wrong PIN")
		}
		if resp.AttemptsRemaining != maxAttempts-1 {
			t.Errorf("AttemptsRemaining = %d, want %d", resp.AttemptsRemaining, maxAttempts-1)
		}
		if repo.RateLimits["ip-b"] == nil || repo.RateLimits["ip-b"].Attempts != 1 {
			t.Errorf("rate-limit counter = %+v, want Attempts=1", repo.RateLimits["ip-b"])
		}
	})

	t.Run("malformed PIN still burns an attempt", func(t *testing.T) {
		resp, err := svc.VerifyPIN(ctx, "xx", "ip-c")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Success {
			t.Fatal("Success = true for malformed PIN")
		}
		if repo.RateLimits["ip-c"] == nil || repo.RateLimits["ip-c"].Attempts != 1 {
			t.Errorf("rate-limit counter = %+v, want Attempts=1 (format failures must count)", repo.RateLimits["ip-c"])
		}
	})

	t.Run("cap refuses without incrementing", func(t *testing.T) {
		repo.RateLimits["ip-d"] = &model.RateLimitEntry{Attempts: maxAttempts}
		resp, err := svc.VerifyPIN(ctx, "1234", "ip-d") // correct PIN, still refused
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if resp.Success {
			t.Fatal("Success = true past the attempt cap")
		}
		if resp.Token != "" {
			t.Error("token minted past the attempt cap")
		}
		if got := repo.RateLimits["ip-d"].Attempts; got != maxAttempts {
			t.Errorf("Attempts = %d, want %d (cap must not slide the counter)", got, maxAttempts)
		}
	})

	t.Run("cap is per-IP", func(t *testing.T) {
		repo.RateLimits["ip-e"] = &model.RateLimitEntry{Attempts: maxAttempts}
		resp, err := svc.VerifyPIN(ctx, "1234", "ip-f") // different IP
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !resp.Success {
			t.Errorf("Success = false for a clean IP while another IP is capped: %+v", resp)
		}
	})

	t.Run("success mints session and clears rate limit", func(t *testing.T) {
		repo.RateLimits["ip-g"] = &model.RateLimitEntry{Attempts: 2}
		resp, err := svc.VerifyPIN(ctx, "1234", "ip-g")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !resp.Success || resp.Token == "" {
			t.Fatalf("expected success with token, got %+v", resp)
		}
		if repo.Sessions[resp.Token] == nil {
			t.Error("session row not created for minted token")
		}
		if repo.RateLimits["ip-g"] != nil {
			t.Error("rate-limit entry not cleared after successful login")
		}
	})
}

// =====================================================================
// TestChangePIN covers rotation: wrong current PIN must not revoke
// sessions or rotate; success must revoke every session BEFORE the new
// hash is written (revoke-then-update ordering).
// =====================================================================
func TestChangePIN(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")
	oldHash := repo.Config.PinHash

	t.Run("wrong current PIN", func(t *testing.T) {
		repo.Sessions["tok-1"] = &model.Session{Token: "tok-1"}
		err := svc.ChangePIN(ctx, "0000", "5678")
		if err != ErrInvalidPIN {
			t.Fatalf("expected ErrInvalidPIN, got %v", err)
		}
		if repo.Config.PinHash != oldHash {
			t.Error("PIN hash rotated despite wrong current PIN")
		}
		if repo.Sessions["tok-1"] == nil {
			t.Error("sessions revoked despite wrong current PIN")
		}
	})

	t.Run("invalid new PIN", func(t *testing.T) {
		if err := svc.ChangePIN(ctx, "1234", "12"); err != ErrPINTooShort {
			t.Errorf("expected ErrPINTooShort, got %v", err)
		}
	})

	t.Run("success rotates hash and revokes all sessions", func(t *testing.T) {
		repo.Sessions["tok-2"] = &model.Session{Token: "tok-2"}
		if err := svc.ChangePIN(ctx, "1234", "5678"); err != nil {
			t.Fatalf("ChangePIN failed: %v", err)
		}
		if repo.Config.PinHash == oldHash {
			t.Error("PIN hash not rotated")
		}
		if len(repo.Sessions) != 0 {
			t.Errorf("sessions = %d, want 0 (all revoked on rotation)", len(repo.Sessions))
		}
		ok, err := verifyPINHash("5678", repo.Config.PinHash)
		if err != nil || !ok {
			t.Errorf("new PIN does not verify against rotated hash (ok=%v err=%v)", ok, err)
		}
	})
}

// TestSessionLifecycle pins ValidateSession + Logout against the fake.
func TestSessionLifecycle(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)

	if ok, err := svc.ValidateSession(ctx, ""); err != nil || ok {
		t.Errorf("empty token: got (%v, %v), want (false, nil)", ok, err)
	}
	if ok, err := svc.ValidateSession(ctx, "nope"); err != nil || ok {
		t.Errorf("unknown token: got (%v, %v), want (false, nil)", ok, err)
	}

	repo.Sessions["tok"] = &model.Session{Token: "tok"}
	if ok, err := svc.ValidateSession(ctx, "tok"); err != nil || !ok {
		t.Errorf("known token: got (%v, %v), want (true, nil)", ok, err)
	}

	if err := svc.Logout(ctx, "tok"); err != nil {
		t.Fatalf("Logout failed: %v", err)
	}
	if ok, _ := svc.ValidateSession(ctx, "tok"); ok {
		t.Error("session still valid after logout")
	}
}
