package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
	"golang.org/x/crypto/argon2"
)

const (
	// Argon2 parameters - reduced memory for Lambda compatibility
	argonTime    = 3
	argonMemory  = 16 * 1024 // 16MB (fits in 128MB Lambda)
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16

	// Rate limiting: 5 failed attempts per sliding 15-minute window
	// (the RATELIMIT row's TTL), scoped per source IP. Once the cap is
	// hit, further attempts are refused until the window's TTL expires.
	maxAttempts     = 5
	sessionTTLHours = 24
)

var (
	ErrInvalidPIN     = errors.New("invalid PIN")
	ErrPINNotSetup    = errors.New("PIN not set up")
	ErrPINAlreadySet  = errors.New("PIN already set up")
	ErrRateLimited    = errors.New("too many attempts")
	ErrAccountLocked  = errors.New("account locked")
	ErrInvalidSession = errors.New("invalid session")
	ErrPINTooShort    = errors.New("PIN must be 4-6 digits")
	ErrPINNotNumeric  = errors.New("PIN must contain only digits")
)

type AuthService struct {
	repo repository.RepositoryInterface
}

func NewAuthService(repo repository.RepositoryInterface) *AuthService {
	return &AuthService{repo: repo}
}

// IsSetup checks if PIN has been configured
func (s *AuthService) IsSetup(ctx context.Context) (bool, error) {
	config, err := s.repo.GetConfig(ctx)
	if err != nil {
		return false, err
	}
	return config != nil && config.PinHash != "", nil
}

// SetupPIN sets up the initial PIN. Uses CreateConfig (which conditions on
// attribute_not_exists) so two concurrent setup attempts cannot both write —
// the loser gets ErrPINAlreadySet. Closes the first-deploy takeover window
// where an adversary scraping new instance config from GitHub could race the
// owner to claim the PIN slot.
func (s *AuthService) SetupPIN(ctx context.Context, pin string) error {
	if err := validatePIN(pin); err != nil {
		return err
	}

	hash, err := hashPIN(pin)
	if err != nil {
		return fmt.Errorf("failed to hash PIN: %w", err)
	}

	newConfig := &model.Config{
		PinHash:   hash,
		CreatedAt: time.Now(),
	}
	if err := s.repo.CreateConfig(ctx, newConfig); err != nil {
		if errors.Is(err, repository.ErrConfigAlreadyExists) {
			return ErrPINAlreadySet
		}
		return err
	}
	return nil
}

// VerifyPIN verifies the PIN and returns a session token on success.
// sourceIP scopes rate-limiting per requesting client — without it, one
// attacker could lock out the family by flooding /api/auth/verify.
func (s *AuthService) VerifyPIN(ctx context.Context, pin string, sourceIP string) (*model.VerifyPinResponse, error) {
	rateLimit, err := s.repo.GetRateLimitEntry(ctx, sourceIP)
	if err != nil {
		return nil, err
	}

	if rateLimit != nil && rateLimit.Attempts >= maxAttempts {
		// Cap reached for this 15-minute window. Refuse immediately —
		// without burning Argon2 cycles or sliding the counter. The
		// RATELIMIT row's TTL lifts the block automatically once the
		// window elapses.
		return rateLimitedResponse(rateLimit), nil
	}

	// Validate PIN format before incurring Argon2 cost. Still increments
	// the failed-attempt counter so that format-vs-Argon2 timing cannot
	// be used to enumerate valid PIN shapes.
	if err := validatePIN(pin); err != nil {
		return s.failedAttempt(ctx, sourceIP)
	}

	config, err := s.repo.GetConfig(ctx)
	if err != nil {
		return nil, err
	}
	if config == nil || config.PinHash == "" {
		return &model.VerifyPinResponse{
			Success: false,
			Error:   "PIN not set up",
		}, nil
	}

	match, err := verifyPINHash(pin, config.PinHash)
	if err != nil {
		return nil, err
	}

	if !match {
		return s.failedAttempt(ctx, sourceIP)
	}

	if err := s.repo.ClearRateLimit(ctx, sourceIP); err != nil {
		log.Printf("warn: ClearRateLimit failed for ip=%s: %v", sourceIP, err)
	}

	token := uuid.New().String()
	if err := s.repo.CreateSession(ctx, token, sessionTTLHours); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return &model.VerifyPinResponse{
		Success: true,
		Token:   token,
	}, nil
}

// failedAttempt records a single failed verify and returns the
// not-authorized response. The increment is conditional (attempts < cap):
// if the conditional fails the cap was reached concurrently (B6), and we
// return the rate-limited 429 response derived from the current row.
func (s *AuthService) failedAttempt(ctx context.Context, sourceIP string) (*model.VerifyPinResponse, error) {
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
	if remaining < 0 {
		remaining = 0
	}
	// At exactly zero remaining the next attempt is locked out — surface
	// that as a 429 with the wait time so the client stops guessing.
	if remaining == 0 {
		return rateLimitedResponse(entry), nil
	}
	return &model.VerifyPinResponse{
		Success:           false,
		Error:             "Invalid PIN",
		AttemptsRemaining: &remaining,
	}, nil
}

// rateLimitedResponse builds the 429 "too many attempts" body, including
// retry_after_seconds derived from the rate-limit row's TTL (U3). entry may
// be nil (TTL omitted) in the unlikely case the row vanished.
func rateLimitedResponse(entry *model.RateLimitEntry) *model.VerifyPinResponse {
	zero := 0
	resp := &model.VerifyPinResponse{
		Success:           false,
		Error:             "Too many attempts. Please wait.",
		AttemptsRemaining: &zero,
	}
	if entry != nil && entry.TTL > 0 {
		retry := entry.TTL - time.Now().Unix()
		if retry < 0 {
			retry = 0
		}
		resp.RetryAfterSeconds = &retry
	}
	return resp
}

// ChangePIN rotates the PIN after verifying the current one. Calls
// verifyPINHash directly (not VerifyPIN) so wrong-current-PIN attempts do
// NOT increment the login rate-limit counter (which would lock the
// account from its own owner) and do NOT mint stray session tokens.
//
// Order of operations is deliberately revoke-then-update:
//  1. Revoke every session. If this fails, we abort — the user will
//     see an error and can retry. The PIN is unchanged.
//  2. Update the PIN hash. If this fails, sessions are already gone
//     and the user has to re-authenticate with the OLD PIN. That's
//     recoverable.
//
// The OLD ordering (update PIN first, then revoke) silently logged
// session-revoke failures and returned success. A stolen token could
// then survive the PIN rotation while the API reported the change
// completed — a defense-in-depth failure for the only mechanism the
// user has to invalidate compromised sessions.
func (s *AuthService) ChangePIN(ctx context.Context, currentPIN, newPIN string) error {
	if err := validatePIN(newPIN); err != nil {
		return err
	}

	config, err := s.repo.GetConfig(ctx)
	if err != nil {
		return err
	}
	if config == nil || config.PinHash == "" {
		return ErrPINNotSetup
	}

	match, err := verifyPINHash(currentPIN, config.PinHash)
	if err != nil {
		return err
	}
	if !match {
		return ErrInvalidPIN
	}

	hash, err := hashPIN(newPIN)
	if err != nil {
		return fmt.Errorf("failed to hash PIN: %w", err)
	}

	// Step 1: revoke every session. Hard failure aborts the change.
	if err := s.repo.DeleteAllSessions(ctx); err != nil {
		return fmt.Errorf("failed to revoke sessions: %w", err)
	}

	// Step 2: update the PIN hash. If this fails after the revoke,
	// the user has to re-authenticate with the old PIN — annoying but
	// not a security problem.
	config.PinHash = hash
	if err := s.repo.SaveConfig(ctx, config); err != nil {
		return err
	}
	return nil
}

// ValidateSession validates a session token
func (s *AuthService) ValidateSession(ctx context.Context, token string) (bool, error) {
	if token == "" {
		return false, nil
	}

	session, err := s.repo.GetSession(ctx, token)
	if err != nil {
		return false, err
	}

	return session != nil, nil
}

// Logout invalidates a session
func (s *AuthService) Logout(ctx context.Context, token string) error {
	return s.repo.DeleteSession(ctx, token)
}

// Helper functions

func validatePIN(pin string) error {
	if len(pin) < 4 || len(pin) > 6 {
		return ErrPINTooShort
	}
	for _, r := range pin {
		if !unicode.IsDigit(r) {
			return ErrPINNotNumeric
		}
	}
	return nil
}

func hashPIN(pin string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}

	hash := argon2.IDKey([]byte(pin), salt, argonTime, argonMemory, argonThreads, argonKeyLen)

	// Encode as PHC string: $argon2id$v=19$m=16384,t=3,p=1$<salt>$<hash>
	// (m/t/p come from the argonMemory/argonTime/argonThreads constants).
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)

	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads, b64Salt, b64Hash), nil
}

// verifyPINHash performs a constant-time hash comparison between the
// supplied PIN and a PHC-formatted Argon2id hash. Pure function — no rate
// limit increment, no session minting, no I/O. Called by both VerifyPIN
// (the public session-minting flow) and ChangePIN.
func verifyPINHash(pin, encodedHash string) (bool, error) {
	// Parse the encoded hash
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 {
		return false, errors.New("invalid hash format")
	}

	if parts[1] != "argon2id" {
		return false, errors.New("unsupported algorithm")
	}

	var memory, time uint32
	var threads uint8
	_, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &time, &threads)
	if err != nil {
		return false, fmt.Errorf("failed to parse parameters: %w", err)
	}

	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, fmt.Errorf("failed to decode salt: %w", err)
	}

	expectedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, fmt.Errorf("failed to decode hash: %w", err)
	}

	// Compute hash with same parameters
	computedHash := argon2.IDKey([]byte(pin), salt, time, memory, threads, uint32(len(expectedHash)))

	// Constant-time comparison
	return subtle.ConstantTimeCompare(computedHash, expectedHash) == 1, nil
}
