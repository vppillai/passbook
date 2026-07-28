package service

import (
	"context"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
)

// TestChangePIN_RevokesWebAuthnCredentials pins that rotating the PIN also
// removes every enrolled biometric credential.
//
// ChangePIN is the only lever the user has when they believe access has been
// compromised, and it already revokes every session for exactly that reason.
// Biometric unlock is an independent path to a session that does not involve
// the PIN at all: an attacker who reached an authenticated session once could
// enroll their own device, and before this change a PIN rotation left that
// enrollment working. Rotating the PIN has to close every door, not just the
// one the PIN opens.
func TestChangePIN_RevokesWebAuthnCredentials(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	repo.Sessions["tok-1"] = &model.Session{Token: "tok-1"}
	repo.WACredentials["cred-a"] = &model.WebAuthnCredential{
		CredentialID: "cred-a", Credential: `{}`,
	}
	repo.WACredentials["cred-b"] = &model.WebAuthnCredential{
		CredentialID: "cred-b", Credential: `{}`,
	}

	if err := svc.ChangePIN(ctx, "1234", "5678", "192.0.2.1"); err != nil {
		t.Fatalf("ChangePIN: %v", err)
	}

	if len(repo.Sessions) != 0 {
		t.Errorf("sessions = %d, want 0", len(repo.Sessions))
	}
	if len(repo.WACredentials) != 0 {
		t.Errorf("webauthn credentials = %d, want 0 — a PIN rotation must not "+
			"leave an enrolled authenticator able to mint new sessions",
			len(repo.WACredentials))
	}
}

// A failed ChangePIN must not revoke anything. The wrong-current-PIN path is
// reachable by anyone holding a stolen session, so letting it drop the real
// owner's biometric enrollment would hand an attacker a denial-of-service.
func TestChangePIN_WrongCurrentPINRevokesNothing(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")

	repo.Sessions["tok-1"] = &model.Session{Token: "tok-1"}
	repo.WACredentials["cred-a"] = &model.WebAuthnCredential{
		CredentialID: "cred-a", Credential: `{}`,
	}

	if err := svc.ChangePIN(ctx, "9999", "5678", "192.0.2.2"); err != ErrInvalidPIN {
		t.Fatalf("expected ErrInvalidPIN, got %v", err)
	}

	if len(repo.Sessions) != 1 {
		t.Errorf("sessions = %d, want 1 (a failed change must revoke nothing)", len(repo.Sessions))
	}
	if len(repo.WACredentials) != 1 {
		t.Errorf("webauthn credentials = %d, want 1 (a failed change must revoke nothing)",
			len(repo.WACredentials))
	}
}
