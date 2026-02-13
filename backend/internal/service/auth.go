package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
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

	// Rate limiting
	maxAttempts     = 5
	lockoutAttempts = 10
	lockoutMinutes  = 30
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
	repo *repository.Repository
}

func NewAuthService(repo *repository.Repository) *AuthService {
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

// SetupPIN sets up the initial PIN
func (s *AuthService) SetupPIN(ctx context.Context, pin string) error {
	// Validate PIN format
	if err := validatePIN(pin); err != nil {
		return err
	}

	// Check if already set up
	config, err := s.repo.GetConfig(ctx)
	if err != nil {
		return err
	}
	if config != nil && config.PinHash != "" {
		return ErrPINAlreadySet
	}

	// Hash the PIN
	hash, err := hashPIN(pin)
	if err != nil {
		return fmt.Errorf("failed to hash PIN: %w", err)
	}

	// Save config
	newConfig := &model.Config{
		PinHash:   hash,
		CreatedAt: time.Now(),
	}
	return s.repo.SaveConfig(ctx, newConfig)
}

// VerifyPIN verifies the PIN and returns a session token
func (s *AuthService) VerifyPIN(ctx context.Context, pin string) (*model.VerifyPinResponse, error) {
	// Check rate limiting
	rateLimit, err := s.repo.GetRateLimitEntry(ctx)
	if err != nil {
		return nil, err
	}

	if rateLimit != nil {
		// Check if locked out
		if rateLimit.LockedAt > 0 && rateLimit.LockedAt > time.Now().Unix() {
			return &model.VerifyPinResponse{
				Success:     false,
				Error:       "Account locked. Please try again later.",
				LockedUntil: rateLimit.LockedAt,
			}, nil
		}

		// Check if at max attempts
		if rateLimit.Attempts >= maxAttempts {
			remaining := maxAttempts - rateLimit.Attempts
			if remaining < 0 {
				remaining = 0
			}
			// If at lockout threshold, set lockout
			if rateLimit.Attempts >= lockoutAttempts {
				if err := s.repo.SetLockout(ctx, lockoutMinutes); err != nil {
					return nil, err
				}
				return &model.VerifyPinResponse{
					Success:     false,
					Error:       "Too many failed attempts. Account locked.",
					LockedUntil: time.Now().Add(lockoutMinutes * time.Minute).Unix(),
				}, nil
			}
		}
	}

	// Get config
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

	// Verify PIN
	match, err := verifyPIN(pin, config.PinHash)
	if err != nil {
		return nil, err
	}

	if !match {
		// Increment failed attempts
		entry, err := s.repo.IncrementFailedAttempts(ctx)
		if err != nil {
			return nil, err
		}

		remaining := maxAttempts - entry.Attempts
		if remaining < 0 {
			remaining = 0
		}

		// Check if should lock
		if entry.Attempts >= lockoutAttempts {
			if err := s.repo.SetLockout(ctx, lockoutMinutes); err != nil {
				return nil, err
			}
			return &model.VerifyPinResponse{
				Success:     false,
				Error:       "Too many failed attempts. Account locked.",
				LockedUntil: time.Now().Add(lockoutMinutes * time.Minute).Unix(),
			}, nil
		}

		return &model.VerifyPinResponse{
			Success:           false,
			Error:             "Invalid PIN",
			AttemptsRemaining: remaining,
		}, nil
	}

	// Clear rate limit on success
	if err := s.repo.ClearRateLimit(ctx); err != nil {
		// Non-fatal, continue
	}

	// Create session
	token := uuid.New().String()
	if err := s.repo.CreateSession(ctx, token, sessionTTLHours); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return &model.VerifyPinResponse{
		Success: true,
		Token:   token,
	}, nil
}

// ChangePIN changes the PIN after verifying the current one
func (s *AuthService) ChangePIN(ctx context.Context, currentPIN, newPIN string) error {
	// Validate new PIN format
	if err := validatePIN(newPIN); err != nil {
		return err
	}

	// Verify current PIN
	response, err := s.VerifyPIN(ctx, currentPIN)
	if err != nil {
		return err
	}
	if !response.Success {
		return ErrInvalidPIN
	}

	// Hash new PIN
	hash, err := hashPIN(newPIN)
	if err != nil {
		return fmt.Errorf("failed to hash PIN: %w", err)
	}

	// Update config
	config, err := s.repo.GetConfig(ctx)
	if err != nil {
		return err
	}
	config.PinHash = hash
	return s.repo.SaveConfig(ctx, config)
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

	// Encode as $argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)

	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		argonMemory, argonTime, argonThreads, b64Salt, b64Hash), nil
}

func verifyPIN(pin, encodedHash string) (bool, error) {
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
