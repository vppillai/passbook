package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
)

const (
	// webAuthnChallengeTTLSeconds bounds how long an in-flight ceremony
	// (the persisted SessionData) stays valid — 5 minutes, long enough for
	// a Face ID / fingerprint prompt, short enough to limit replay.
	webAuthnChallengeTTLSeconds = 5 * 60

	// webAuthnUserDisplayName is shown by the platform authenticator UI for
	// the single-user-per-instance account.
	webAuthnUserDisplayName = "Passbook"
)

var (
	// ErrWebAuthnChallengeNotFound is returned when a verify call references
	// a challenge_id that has expired or never existed (handler → 400).
	ErrWebAuthnChallengeNotFound = errors.New("webauthn challenge not found or expired")
	// ErrWebAuthnVerification is returned when the authenticator response
	// fails cryptographic verification (handler → 401 for login, 400 for
	// register).
	ErrWebAuthnVerification = errors.New("webauthn verification failed")
	// ErrWebAuthnNotEnrolled is returned by login/options when no credential
	// has been registered yet (handler → 400).
	ErrWebAuthnNotEnrolled = errors.New("no webauthn credentials enrolled")
)

// webAuthnUser is the single-user-per-instance account. WebAuthn requires a
// stable user handle; this app has no usernames, so the handle is a fixed
// constant derived from the RP ID (kept identical across deploys of the
// same instance so re-registration replaces rather than orphans creds).
// WebAuthnCredentials is populated per-ceremony from the stored credentials.
type webAuthnUser struct {
	id          []byte
	credentials []webauthn.Credential
}

func (u *webAuthnUser) WebAuthnID() []byte                         { return u.id }
func (u *webAuthnUser) WebAuthnName() string                       { return "passbook-user" }
func (u *webAuthnUser) WebAuthnDisplayName() string                { return webAuthnUserDisplayName }
func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }

// WebAuthnService implements the biometric-unlock ceremonies on top of the
// go-webauthn library, persisting challenges and credentials via the
// repository and minting a session (identical to PIN verify) on a
// successful login.
type WebAuthnService struct {
	repo   repository.RepositoryInterface
	wa     *webauthn.WebAuthn
	userID []byte
}

// NewWebAuthnService builds the service. allowedOrigin is the ALLOWED_ORIGIN
// env value (e.g. "https://vppillai.github.io"); the RP ID is its host and
// RPOrigins is the origin itself. displayName falls back to "Passbook".
// Returns an error only if the go-webauthn config is invalid.
func NewWebAuthnService(repo repository.RepositoryInterface, allowedOrigin, displayName string) (*WebAuthnService, error) {
	if displayName == "" {
		displayName = webAuthnUserDisplayName
	}
	rpID, err := rpIDFromOrigin(allowedOrigin)
	if err != nil {
		return nil, err
	}
	wa, err := webauthn.New(&webauthn.Config{
		RPID:          rpID,
		RPDisplayName: displayName,
		RPOrigins:     []string{allowedOrigin},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to init webauthn: %w", err)
	}
	return &WebAuthnService{
		repo:   repo,
		wa:     wa,
		userID: deriveUserID(rpID),
	}, nil
}

// rpIDFromOrigin extracts the host (no scheme, no port) from the allowed
// origin to use as the WebAuthn Relying Party ID.
func rpIDFromOrigin(allowedOrigin string) (string, error) {
	u, err := url.Parse(allowedOrigin)
	if err != nil || u.Hostname() == "" {
		return "", fmt.Errorf("invalid ALLOWED_ORIGIN %q for webauthn RPID", allowedOrigin)
	}
	return u.Hostname(), nil
}

// deriveUserID produces a stable 32-byte user handle for the single-user
// account by hashing a fixed label with the RP ID, so the handle is
// deterministic per instance (re-registration targets the same user) yet
// opaque and non-guessable.
func deriveUserID(rpID string) []byte {
	sum := sha256.Sum256([]byte("passbook-user|" + rpID))
	return sum[:]
}

// user builds the webauthn.User for a ceremony, loading every stored
// credential so login can match against them and register can exclude them.
func (s *WebAuthnService) user(ctx context.Context) (*webAuthnUser, error) {
	stored, err := s.repo.ListWebAuthnCredentials(ctx)
	if err != nil {
		return nil, err
	}
	creds := make([]webauthn.Credential, 0, len(stored))
	for i := range stored {
		var c webauthn.Credential
		if err := json.Unmarshal([]byte(stored[i].Credential), &c); err != nil {
			// Skip a corrupt row rather than failing the whole ceremony.
			continue
		}
		creds = append(creds, c)
	}
	return &webAuthnUser{id: s.userID, credentials: creds}, nil
}

// IsEnrolled reports whether any credential is stored — drives the
// webauthn_enrolled flag in /api/auth/status.
func (s *WebAuthnService) IsEnrolled(ctx context.Context) (bool, error) {
	creds, err := s.repo.ListWebAuthnCredentials(ctx)
	if err != nil {
		return false, err
	}
	return len(creds) > 0, nil
}

// BeginRegistration produces creation options for a new platform-authenticator
// credential, persists the ceremony session under a fresh challenge_id, and
// returns both. Requires a valid session (gated by the handler).
func (s *WebAuthnService) BeginRegistration(ctx context.Context) (*model.WebAuthnOptionsResponse, error) {
	user, err := s.user(ctx)
	if err != nil {
		return nil, err
	}

	// Platform authenticator (Face ID / Touch ID / Windows Hello),
	// discoverable (resident) credential so login can be userless, with
	// user verification required (the biometric itself).
	rrk := protocol.ResidentKeyRequirementRequired
	sel := protocol.AuthenticatorSelection{
		AuthenticatorAttachment: protocol.Platform,
		ResidentKey:             rrk,
		RequireResidentKey:      protocol.ResidentKeyRequired(),
		UserVerification:        protocol.VerificationRequired,
	}

	// Exclude already-registered credentials so the same authenticator
	// isn't enrolled twice.
	exclusions := make([]protocol.CredentialDescriptor, 0, len(user.credentials))
	for _, c := range user.credentials {
		exclusions = append(exclusions, c.Descriptor())
	}

	creation, session, err := s.wa.BeginRegistration(
		user,
		webauthn.WithAuthenticatorSelection(sel),
		webauthn.WithExclusions(exclusions),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to begin webauthn registration: %w", err)
	}

	return s.persistAndRespond(ctx, session, creation)
}

// FinishRegistration verifies the authenticator's attestation response
// against the persisted ceremony session and stores the new credential.
// Requires a valid session (gated by the handler).
func (s *WebAuthnService) FinishRegistration(ctx context.Context, req *model.WebAuthnVerifyRequest) error {
	session, err := s.loadChallenge(ctx, req.ChallengeID)
	if err != nil {
		return err
	}
	// Single-use: drop the challenge regardless of the verify outcome.
	defer func() { _ = s.repo.DeleteWebAuthnChallenge(ctx, req.ChallengeID) }()

	user, err := s.user(ctx)
	if err != nil {
		return err
	}

	parsed, err := protocol.ParseCredentialCreationResponseBytes(req.Credential)
	if err != nil {
		return ErrWebAuthnVerification
	}

	credential, err := s.wa.CreateCredential(user, *session, parsed)
	if err != nil {
		return ErrWebAuthnVerification
	}

	return s.storeCredential(ctx, credential)
}

// BeginLogin produces request options for a userless (discoverable-credential)
// login, persists the ceremony session, and returns both. No auth required.
// Returns ErrWebAuthnNotEnrolled when no credential exists yet.
func (s *WebAuthnService) BeginLogin(ctx context.Context) (*model.WebAuthnOptionsResponse, error) {
	enrolled, err := s.IsEnrolled(ctx)
	if err != nil {
		return nil, err
	}
	if !enrolled {
		return nil, ErrWebAuthnNotEnrolled
	}

	assertion, session, err := s.wa.BeginDiscoverableLogin(
		webauthn.WithUserVerification(protocol.VerificationRequired),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to begin webauthn login: %w", err)
	}

	return s.persistAndRespond(ctx, session, assertion)
}

// FinishLogin verifies the authenticator's assertion response against the
// persisted ceremony session and, on success, mints a session token exactly
// like a successful PIN verify (same token shape, TTL, response body) so the
// frontend session flow is unchanged. Failures are rate-limited per IP using
// the same limiter as PIN verify. No auth required.
func (s *WebAuthnService) FinishLogin(ctx context.Context, req *model.WebAuthnVerifyRequest, sourceIP string) (*model.VerifyPinResponse, error) {
	// Same per-IP rate limiter as PIN verify: refuse at the cap before
	// burning verification cycles, so an attacker can't bypass the lockout
	// by switching from the PIN to the biometric endpoint.
	rateLimit, err := s.repo.GetRateLimitEntry(ctx, sourceIP)
	if err != nil {
		return nil, err
	}
	if rateLimit != nil && rateLimit.Attempts >= maxAttempts {
		return rateLimitedResponse(rateLimit), nil
	}

	session, err := s.loadChallenge(ctx, req.ChallengeID)
	if err != nil {
		return nil, err
	}
	// Single-use: drop the challenge regardless of the verify outcome.
	defer func() { _ = s.repo.DeleteWebAuthnChallenge(ctx, req.ChallengeID) }()

	parsed, err := protocol.ParseCredentialRequestResponseBytes(req.Credential)
	if err != nil {
		return s.failedLogin(ctx, sourceIP)
	}

	// The discoverable handler resolves the asserting credential to our
	// single user, supplying the stored credentials for signature + sign
	// count verification.
	handler := func(_, _ []byte) (webauthn.User, error) {
		return s.user(ctx)
	}

	credential, err := s.wa.ValidateDiscoverableLogin(handler, *session, parsed)
	if err != nil {
		return s.failedLogin(ctx, sourceIP)
	}

	// Persist the advanced sign count so a replayed/cloned authenticator is
	// detectable on the next login.
	if err := s.storeCredential(ctx, credential); err != nil {
		return nil, err
	}

	// Success: clear the per-IP rate limit and mint a session identical to
	// PIN verify (same token shape, TTL, response body).
	if err := s.repo.ClearRateLimit(ctx, sourceIP); err != nil {
		return nil, err
	}
	token := uuid.New().String()
	if err := s.repo.CreateSession(ctx, token, sessionTTLHours); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}
	return &model.VerifyPinResponse{Success: true, Token: token}, nil
}

// DisableWebAuthn removes every stored credential so the user can turn off
// biometric unlock. Requires a valid session (gated by the handler).
func (s *WebAuthnService) DisableWebAuthn(ctx context.Context) error {
	return s.repo.DeleteAllWebAuthnCredentials(ctx)
}

// failedLogin records a failed biometric login against the per-IP limiter
// (the same one PIN verify uses) and returns the not-authorized response,
// surfacing the 429 lockout once the cap is hit (same shape as PIN verify's
// failedAttempt).
func (s *WebAuthnService) failedLogin(ctx context.Context, sourceIP string) (*model.VerifyPinResponse, error) {
	entry, err := s.repo.IncrementFailedAttempts(ctx, sourceIP, maxAttempts)
	if err != nil {
		if errors.Is(err, repository.ErrRateLimitCapReached) {
			current, gerr := s.repo.GetRateLimitEntry(ctx, sourceIP)
			if gerr != nil {
				return nil, gerr
			}
			return rateLimitedResponse(current), nil
		}
		return nil, err
	}
	remaining := maxAttempts - entry.Attempts
	if remaining <= 0 {
		return rateLimitedResponse(entry), nil
	}
	return &model.VerifyPinResponse{
		Success:           false,
		Error:             "Biometric verification failed",
		AttemptsRemaining: &remaining,
	}, nil
}

// persistAndRespond serializes the ceremony session under a fresh
// challenge_id and returns the raw options JSON for the browser.
func (s *WebAuthnService) persistAndRespond(ctx context.Context, session *webauthn.SessionData, options interface{}) (*model.WebAuthnOptionsResponse, error) {
	sessionJSON, err := json.Marshal(session)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal webauthn session: %w", err)
	}
	challengeID := uuid.New().String()
	if err := s.repo.PutWebAuthnChallenge(ctx, challengeID, string(sessionJSON), webAuthnChallengeTTLSeconds); err != nil {
		return nil, err
	}
	optionsJSON, err := json.Marshal(options)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal webauthn options: %w", err)
	}
	return &model.WebAuthnOptionsResponse{
		ChallengeID: challengeID,
		Options:     optionsJSON,
	}, nil
}

// loadChallenge fetches and decodes the persisted ceremony session for a
// challenge_id, returning ErrWebAuthnChallengeNotFound when it is missing
// or expired.
func (s *WebAuthnService) loadChallenge(ctx context.Context, challengeID string) (*webauthn.SessionData, error) {
	if challengeID == "" {
		return nil, ErrWebAuthnChallengeNotFound
	}
	entry, err := s.repo.GetWebAuthnChallenge(ctx, challengeID)
	if err != nil {
		return nil, err
	}
	if entry == nil {
		return nil, ErrWebAuthnChallengeNotFound
	}
	var session webauthn.SessionData
	if err := json.Unmarshal([]byte(entry.SessionData), &session); err != nil {
		return nil, ErrWebAuthnChallengeNotFound
	}
	return &session, nil
}

// storeCredential serializes a go-webauthn credential and persists it
// (canonical row + WACREDLIST mirror), recording the transports and current
// sign count for later cloned-authenticator detection.
func (s *WebAuthnService) storeCredential(ctx context.Context, credential *webauthn.Credential) error {
	credJSON, err := json.Marshal(credential)
	if err != nil {
		return fmt.Errorf("failed to marshal webauthn credential: %w", err)
	}
	credID := base64.RawURLEncoding.EncodeToString(credential.ID)
	transports := make([]string, 0, len(credential.Transport))
	for _, t := range credential.Transport {
		transports = append(transports, string(t))
	}
	return s.repo.PutWebAuthnCredential(ctx, &model.WebAuthnCredential{
		CredentialID: credID,
		Credential:   string(credJSON),
		SignCount:    credential.Authenticator.SignCount,
		Transports:   strings.Join(transports, ","),
		CreatedAt:    time.Now().Unix(),
	})
}
