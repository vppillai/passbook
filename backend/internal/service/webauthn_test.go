package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

const testWAOrigin = "https://app.example"

func newWebAuthnService(t *testing.T) (*WebAuthnService, *testutil.FakeRepo) {
	t.Helper()
	repo := testutil.NewFakeRepo()
	svc, err := NewWebAuthnService(repo, testWAOrigin, "Passbook")
	if err != nil {
		t.Fatalf("NewWebAuthnService: %v", err)
	}
	return svc, repo
}

// seedCredential installs a stored credential directly (no ceremony) so the
// enrolled/list/delete paths can be exercised without a real authenticator.
func seedCredential(repo *testutil.FakeRepo, id string) {
	repo.WACredentials[id] = &model.WebAuthnCredential{
		CredentialID: id,
		Credential:   `{}`,
		SignCount:    0,
	}
}

// seedChallenge persists a real (library-marshaled) ceremony session under
// the given challenge_id so loadChallenge can decode it. The contents don't
// need to match a real authenticator — these tests stop at the
// parse/verification boundary.
func seedChallenge(t *testing.T, repo *testutil.FakeRepo, challengeID string) {
	t.Helper()
	sd := webauthn.SessionData{
		Challenge: "dGVzdC1jaGFsbGVuZ2U",
		UserID:    []byte("passbook-user"),
		Expires:   time.Now().Add(time.Minute),
	}
	raw, err := json.Marshal(&sd)
	if err != nil {
		t.Fatalf("marshal session data: %v", err)
	}
	repo.WAChallenges[challengeID] = &model.WebAuthnChallenge{
		SessionData: string(raw),
		TTL:         time.Now().Add(time.Minute).Unix(),
	}
}

// TestNewWebAuthnService_RPID pins that the RP ID is the host of
// ALLOWED_ORIGIN (no scheme/port) and that an unparsable origin errors.
func TestNewWebAuthnService_RPID(t *testing.T) {
	repo := testutil.NewFakeRepo()
	svc, err := NewWebAuthnService(repo, "https://vppillai.github.io", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := svc.wa.Config.RPID; got != "vppillai.github.io" {
		t.Errorf("RPID = %q, want vppillai.github.io", got)
	}
	if got := svc.wa.Config.RPDisplayName; got != "Passbook" {
		t.Errorf("RPDisplayName = %q, want Passbook (empty falls back to constant)", got)
	}
	if len(svc.wa.Config.RPOrigins) != 1 || svc.wa.Config.RPOrigins[0] != "https://vppillai.github.io" {
		t.Errorf("RPOrigins = %v, want [https://vppillai.github.io]", svc.wa.Config.RPOrigins)
	}

	if _, err := NewWebAuthnService(repo, "://bad-origin", ""); err == nil {
		t.Error("expected error for an unparsable ALLOWED_ORIGIN")
	}
}

// TestIsEnrolled covers the webauthn_enrolled flag source.
func TestIsEnrolled(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)

	if enrolled, err := svc.IsEnrolled(ctx); err != nil || enrolled {
		t.Errorf("fresh instance enrolled = (%v, %v), want (false, nil)", enrolled, err)
	}
	seedCredential(repo, "cred-1")
	if enrolled, err := svc.IsEnrolled(ctx); err != nil || !enrolled {
		t.Errorf("with credential enrolled = (%v, %v), want (true, nil)", enrolled, err)
	}
}

// TestBeginRegistration_PersistsChallenge pins that register/options produces
// well-formed creation options (platform authenticator, resident key, UV
// required) and persists the ceremony session under the returned challenge_id.
func TestBeginRegistration_PersistsChallenge(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)

	resp, err := svc.BeginRegistration(ctx)
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	if resp.ChallengeID == "" {
		t.Fatal("empty challenge_id")
	}
	if repo.WAChallenges[resp.ChallengeID] == nil {
		t.Fatal("ceremony session not persisted for challenge_id")
	}
	// TTL must be in the future and bounded by the 5-minute window.
	stored := repo.WAChallenges[resp.ChallengeID]
	now := time.Now().Unix()
	if stored.TTL <= now || stored.TTL > now+webAuthnChallengeTTLSeconds+5 {
		t.Errorf("challenge TTL = %d, want within (%d, %d]", stored.TTL, now, now+webAuthnChallengeTTLSeconds+5)
	}

	// The options blob must carry the RP and the right authenticator policy.
	var creation protocol.CredentialCreation
	if err := json.Unmarshal(resp.Options, &creation); err != nil {
		t.Fatalf("options not valid CredentialCreation JSON: %v", err)
	}
	if creation.Response.RelyingParty.ID != "app.example" {
		t.Errorf("RP ID = %q, want app.example", creation.Response.RelyingParty.ID)
	}
	if creation.Response.AuthenticatorSelection.AuthenticatorAttachment != protocol.Platform {
		t.Errorf("attachment = %q, want platform", creation.Response.AuthenticatorSelection.AuthenticatorAttachment)
	}
	if creation.Response.AuthenticatorSelection.UserVerification != protocol.VerificationRequired {
		t.Errorf("user verification = %q, want required", creation.Response.AuthenticatorSelection.UserVerification)
	}
	if id, ok := creation.Response.User.ID.(string); !ok || id == "" {
		t.Errorf("user handle = %v, want a non-empty base64url string", creation.Response.User.ID)
	}
}

// TestBeginRegistration_ExcludesExistingCredentials pins that an already-
// registered credential appears in excludeCredentials so the same
// authenticator isn't enrolled twice.
func TestBeginRegistration_ExcludesExistingCredentials(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)

	// Store a real-ish credential (the JSON must round-trip into a
	// webauthn.Credential so its descriptor lands in the exclude list).
	// []byte fields JSON-encode as padded standard base64.
	repo.WACredentials["cred-x"] = &model.WebAuthnCredential{
		CredentialID: "cred-x",
		Credential:   `{"id":"AQIDBA==","publicKey":"AA==","transport":["internal"]}`,
	}

	resp, err := svc.BeginRegistration(ctx)
	if err != nil {
		t.Fatalf("BeginRegistration: %v", err)
	}
	var creation protocol.CredentialCreation
	if err := json.Unmarshal(resp.Options, &creation); err != nil {
		t.Fatalf("unmarshal options: %v", err)
	}
	if len(creation.Response.CredentialExcludeList) != 1 {
		t.Errorf("exclude list = %d entries, want 1", len(creation.Response.CredentialExcludeList))
	}
}

// TestBeginLogin pins userless login: not-enrolled returns ErrWebAuthnNotEnrolled;
// once a credential exists, options + a persisted challenge are returned.
func TestBeginLogin(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)

	if _, err := svc.BeginLogin(ctx); err != ErrWebAuthnNotEnrolled {
		t.Errorf("login/options with no creds = %v, want ErrWebAuthnNotEnrolled", err)
	}

	seedCredential(repo, "cred-1")
	resp, err := svc.BeginLogin(ctx)
	if err != nil {
		t.Fatalf("BeginLogin: %v", err)
	}
	if resp.ChallengeID == "" || repo.WAChallenges[resp.ChallengeID] == nil {
		t.Fatal("login ceremony challenge not persisted")
	}
	var assertion protocol.CredentialAssertion
	if err := json.Unmarshal(resp.Options, &assertion); err != nil {
		t.Fatalf("options not valid CredentialAssertion JSON: %v", err)
	}
	if assertion.Response.RelyingPartyID != "app.example" {
		t.Errorf("RP ID = %q, want app.example", assertion.Response.RelyingPartyID)
	}
	if assertion.Response.UserVerification != protocol.VerificationRequired {
		t.Errorf("user verification = %q, want required", assertion.Response.UserVerification)
	}
}

// TestFinishRegistration_ChallengeNotFound pins that a missing/expired
// challenge is rejected before any verification is attempted.
func TestFinishRegistration_ChallengeNotFound(t *testing.T) {
	ctx := context.Background()
	svc, _ := newWebAuthnService(t)

	err := svc.FinishRegistration(ctx, &model.WebAuthnVerifyRequest{
		ChallengeID: "nope",
		Credential:  json.RawMessage(`{}`),
	})
	if err != ErrWebAuthnChallengeNotFound {
		t.Errorf("FinishRegistration(missing challenge) = %v, want ErrWebAuthnChallengeNotFound", err)
	}
}

// TestFinishRegistration_BadCredentialConsumesChallenge pins that a present
// challenge with an unparsable credential fails verification AND that the
// single-use challenge is consumed regardless of outcome.
func TestFinishRegistration_BadCredentialConsumesChallenge(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)

	seedChallenge(t, repo, "c1")
	err := svc.FinishRegistration(ctx, &model.WebAuthnVerifyRequest{
		ChallengeID: "c1",
		Credential:  json.RawMessage(`not-json`),
	})
	if err != ErrWebAuthnVerification {
		t.Errorf("FinishRegistration(bad credential) = %v, want ErrWebAuthnVerification", err)
	}
	if repo.WAChallenges["c1"] != nil {
		t.Error("single-use challenge not consumed on failed registration")
	}
}

// TestFinishLogin_ChallengeNotFound pins that login with a missing challenge
// is rejected (and is NOT counted as a verification failure).
func TestFinishLogin_ChallengeNotFound(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)
	seedCredential(repo, "cred-1")

	_, err := svc.FinishLogin(ctx, &model.WebAuthnVerifyRequest{
		ChallengeID: "missing",
		Credential:  json.RawMessage(`{}`),
	}, "ip-a")
	if err != ErrWebAuthnChallengeNotFound {
		t.Errorf("FinishLogin(missing challenge) = %v, want ErrWebAuthnChallengeNotFound", err)
	}
	if repo.RateLimits["ip-a"] != nil {
		t.Error("missing challenge must not burn a rate-limit attempt")
	}
}

// TestFinishLogin_FailedVerificationRateLimited pins that a present challenge
// with an unparsable assertion is a verification failure that (a) consumes the
// single-use challenge and (b) increments the per-IP rate limiter, surfacing
// the 429 lockout once the cap is hit (same limiter as PIN verify).
func TestFinishLogin_FailedVerificationRateLimited(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)
	seedCredential(repo, "cred-1")

	seedChallenge(t, repo, "c1")
	resp, err := svc.FinishLogin(ctx, &model.WebAuthnVerifyRequest{
		ChallengeID: "c1",
		Credential:  json.RawMessage(`not-json`),
	}, "ip-b")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Success {
		t.Fatal("Success = true for an unverifiable assertion")
	}
	if repo.WAChallenges["c1"] != nil {
		t.Error("single-use challenge not consumed on failed login")
	}
	if repo.RateLimits["ip-b"] == nil || repo.RateLimits["ip-b"].Attempts != 1 {
		t.Errorf("rate-limit counter = %+v, want Attempts=1", repo.RateLimits["ip-b"])
	}
}

// TestFinishLogin_RateLimitCapRefuses pins that once the per-IP cap is reached,
// login refuses immediately with a rate-limited response (no verification).
func TestFinishLogin_RateLimitCapRefuses(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)
	seedCredential(repo, "cred-1")

	ttl := time.Now().Add(10 * time.Minute).Unix()
	repo.RateLimits["ip-cap"] = &model.RateLimitEntry{Attempts: maxAttempts, TTL: ttl}

	resp, err := svc.FinishLogin(ctx, &model.WebAuthnVerifyRequest{
		ChallengeID: "anything",
		Credential:  json.RawMessage(`{}`),
	}, "ip-cap")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.Success {
		t.Fatal("Success = true past the attempt cap")
	}
	if resp.RetryAfterSeconds == nil || *resp.RetryAfterSeconds <= 0 {
		t.Errorf("RetryAfterSeconds = %v, want positive (429 lockout)", resp.RetryAfterSeconds)
	}
}

// TestDisableWebAuthn pins that disabling removes every stored credential
// (and therefore flips enrolled back to false).
func TestDisableWebAuthn(t *testing.T) {
	ctx := context.Background()
	svc, repo := newWebAuthnService(t)
	seedCredential(repo, "cred-1")
	seedCredential(repo, "cred-2")

	if err := svc.DisableWebAuthn(ctx); err != nil {
		t.Fatalf("DisableWebAuthn: %v", err)
	}
	if len(repo.WACredentials) != 0 {
		t.Errorf("credentials = %d after disable, want 0", len(repo.WACredentials))
	}
	if enrolled, _ := svc.IsEnrolled(ctx); enrolled {
		t.Error("still enrolled after disable")
	}
}
