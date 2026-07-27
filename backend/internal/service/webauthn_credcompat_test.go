package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
)

// legacyCredentialJSON is a credential exactly as go-webauthn v0.13.4
// serialized it — the shape sitting in every production table that enrolled
// a biometric before the v0.17.4 upgrade.
//
// Two things changed in v0.17.x that this blob exercises:
//
//   - `attestationFormat` did not exist; the format string ("packed") was
//     stored in `attestationType`. v0.17.x split them and ships a custom
//     Credential.UnmarshalJSON that migrates the old records on read.
//   - `transport` / `attestationType` gained `omitempty`, which affects
//     writes only — decoding is unaffected.
//
// The fields this app actually depends on (id, publicKey, flags,
// authenticator.signCount) kept their JSON names.
const legacyCredentialJSON = `{
  "id": "AQIDBA==",
  "publicKey": "BQYHCA==",
  "attestationType": "packed",
  "transport": ["internal", "hybrid"],
  "flags": {
    "userPresent": true,
    "userVerified": true,
    "backupEligible": false,
    "backupState": false
  },
  "authenticator": {
    "AAGUID": "CQoLDA==",
    "signCount": 42,
    "cloneWarning": false,
    "attachment": "platform"
  },
  "attestation": {
    "clientDataJSON": null,
    "clientDataHash": null,
    "authenticatorData": null,
    "publicKeyAlgorithm": 0,
    "object": null
  }
}`

// TestWebAuthnCredential_LegacyJSONRoundTrip pins backward compatibility of
// the persisted credential format across the go-webauthn v0.13.4 → v0.17.4
// upgrade.
//
// service.storeCredential persists json.Marshal(*webauthn.Credential) into
// DynamoDB and WebAuthnService.user() decodes it on every login. That makes
// the library's struct part of this app's ON-DISK format: a decode
// regression would not fail the build, it would silently drop every
// already-enrolled authenticator and lock users out of biometric unlock
// (user() skips rows that fail to unmarshal). This test is the guard.
func TestWebAuthnCredential_LegacyJSONRoundTrip(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)

	// A credential stored by the OLD library version.
	repo.WACredentials["AQIDBA"] = &model.WebAuthnCredential{
		CredentialID: "AQIDBA",
		Credential:   legacyCredentialJSON,
		SignCount:    42,
	}

	user, err := svc.user(ctx)
	if err != nil {
		t.Fatalf("user(): %v", err)
	}

	// user() silently skips credentials that fail to unmarshal, so an empty
	// list IS the lockout bug this test exists to catch.
	if len(user.credentials) != 1 {
		t.Fatalf("credentials = %d, want 1 — a legacy credential failed to decode, "+
			"which would lock out every already-enrolled authenticator", len(user.credentials))
	}

	cred := user.credentials[0]
	if got, want := string(cred.ID), "\x01\x02\x03\x04"; got != want {
		t.Errorf("ID = %q, want %q", got, want)
	}
	if got, want := string(cred.PublicKey), "\x05\x06\x07\x08"; got != want {
		t.Errorf("PublicKey = %q, want %q", got, want)
	}
	// The sign count drives cloned-authenticator detection; losing it would
	// silently disable that protection.
	if cred.Authenticator.SignCount != 42 {
		t.Errorf("SignCount = %d, want 42", cred.Authenticator.SignCount)
	}
	if !cred.Flags.UserVerified {
		t.Error("Flags.UserVerified = false, want true")
	}
	if len(cred.Transport) != 2 {
		t.Errorf("Transport = %v, want 2 entries", cred.Transport)
	}

	// The v0.17.x migration: a format string that used to live in
	// attestationType must move to attestationFormat on decode. If a future
	// bump drops that shim this assertion fails loudly instead of quietly
	// mis-attributing every legacy credential.
	if cred.AttestationFormat != "packed" {
		t.Errorf("AttestationFormat = %q, want %q (legacy attestationType "+
			"migration missing)", cred.AttestationFormat, "packed")
	}
	if cred.AttestationType != "" {
		t.Errorf("AttestationType = %q, want empty after migration", cred.AttestationType)
	}
}

// TestWebAuthnCredential_ReserializeKeepsIdentity pins that a legacy
// credential which round-trips through the CURRENT library (as happens on
// every login, where FinishLogin re-persists the advanced sign count via
// storeCredential) still decodes to the same identity afterwards. This is
// the actual production sequence: legacy blob → decode → re-encode → decode.
func TestWebAuthnCredential_ReserializeKeepsIdentity(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)

	repo.WACredentials["AQIDBA"] = &model.WebAuthnCredential{
		CredentialID: "AQIDBA",
		Credential:   legacyCredentialJSON,
		SignCount:    42,
	}

	user, err := svc.user(ctx)
	if err != nil {
		t.Fatalf("user(): %v", err)
	}
	if len(user.credentials) != 1 {
		t.Fatalf("credentials = %d, want 1", len(user.credentials))
	}

	// Re-persist exactly the way FinishLogin does after a successful assertion.
	cred := user.credentials[0]
	cred.Authenticator.SignCount = 43
	if err := svc.storeCredential(ctx, &cred); err != nil {
		t.Fatalf("storeCredential: %v", err)
	}

	// Decode what we just wrote.
	stored := repo.WACredentials["AQIDBA"]
	if stored == nil {
		t.Fatal("credential missing after re-persist")
	}
	var reloaded struct {
		ID                []byte `json:"id"`
		PublicKey         []byte `json:"publicKey"`
		AttestationFormat string `json:"attestationFormat"`
		Authenticator     struct {
			SignCount uint32 `json:"signCount"`
		} `json:"authenticator"`
	}
	if err := json.Unmarshal([]byte(stored.Credential), &reloaded); err != nil {
		t.Fatalf("re-serialized credential does not decode: %v", err)
	}
	if string(reloaded.ID) != "\x01\x02\x03\x04" {
		t.Errorf("ID = %q, want %q", reloaded.ID, "\x01\x02\x03\x04")
	}
	if reloaded.Authenticator.SignCount != 43 {
		t.Errorf("SignCount = %d, want 43 (advanced count not persisted)",
			reloaded.Authenticator.SignCount)
	}
	// The migrated format must be written back in the NEW field, so the
	// record stops needing the compat shim on subsequent reads.
	if reloaded.AttestationFormat != "packed" {
		t.Errorf("AttestationFormat = %q, want %q", reloaded.AttestationFormat, "packed")
	}
	// The stored mirror's SignCount column must track too.
	if stored.SignCount != 43 {
		t.Errorf("row SignCount = %d, want 43", stored.SignCount)
	}
}
