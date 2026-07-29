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
	// Argon2id parameters.
	//
	// These were m=16MiB, t=3 with the comment "fits in 128MB Lambda" — a Lambda
	// that no longer exists; the template deploys 256MB. 16MiB is below current
	// guidance, and a 4-digit PIN is only 10,000 candidates, so the hashing cost
	// is doing much of the work of keeping the PIN secret.
	//
	// The change is memory UP and time DOWN, which is not a trade-off in the
	// wrong direction: total work is m*t, so 64*1 = 64 exceeds the previous
	// 16*3 = 48, while the memory an attacker needs per guess quadruples. Memory
	// is the dimension that matters against GPUs and ASICs, since it caps how
	// many guesses fit on a card; time cost parallelises freely for them.
	// RFC 9106's primary recommendation likewise uses t=1 with high memory.
	//
	// 64MiB is the CEILING here, not a target. It is transient allocation inside
	// a 256MB function that also holds the Go runtime and the AWS SDK, and an
	// OOM on the auth path would be a hard outage — far worse than a somewhat
	// cheaper offline attack on a hash an attacker must first exfiltrate from
	// DynamoDB. Measured rather than assumed: a process that loads the AWS SDK
	// and performs one verify at these parameters peaks at ~140MB RSS, and that
	// figure is from a TEST binary (testing framework plus every test), so the
	// deployed 22MB bootstrap sits comfortably below it. 96MiB and 128MiB were
	// measured too and rejected on that basis.
	//
	// Cost: ~37ms per derivation locally against ~21ms before. At the 256MB
	// Lambda's CPU share that is a few hundred milliseconds — unnoticeable for an
	// unlock, and it is not the primary brute-force control anyway; the per-IP
	// and account-wide attempt caps are.
	//
	// Raising them is safe for existing users because verifyPINHash reads m/t/p
	// from the STORED hash, not from these constants, so an old PIN keeps
	// verifying under its original parameters. VerifyPIN then upgrades it in
	// place on the next successful unlock — see pinHashOutdated.
	argonTime    = 1
	argonMemory  = 64 * 1024 // 64MiB
	argonThreads = 1
	argonKeyLen  = 32
	saltLen      = 16

	// Rate limiting: 5 failed attempts per sliding 15-minute window
	// (the RATELIMIT row's TTL), scoped per source IP. Once the cap is
	// hit, further attempts are refused until the window's TTL expires.
	maxAttempts = 5

	// globalMaxAttempts bounds failed PIN attempts across ALL sources in the
	// same 15-minute window.
	//
	// The per-IP cap exists so one attacker cannot lock the family out, but it
	// is useless against distributed guessing: a 4-digit PIN is 10,000
	// combinations and 5 free guesses per IP means roughly 2,000 addresses
	// exhaust the entire keyspace inside a single window, leaving Argon2's cost
	// as the only obstacle. This bounds total wrong guesses to
	// globalMaxAttempts per window regardless of how many addresses are used.
	//
	// The trade-off is deliberate and unavoidable: to stop a guess being
	// EVALUATED the counter has to be consulted before the hash comparison, so
	// while it is tripped the correct PIN is refused too — an attacker can deny
	// PIN login for up to the window. Two things make that acceptable:
	//   - 50 is far above any believable legitimate use (a real user mistypes
	//     two or three times), so it is only ever reached under attack.
	//   - Biometric unlock is exempt (see WebAuthnService.FinishLogin), because
	//     a WebAuthn credential is not guessable and so contributes nothing to
	//     the risk this cap addresses. An enrolled user keeps a way in.
	globalMaxAttempts = 50

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
	blocked, err := s.pinGuessBlocked(ctx, sourceIP, "verify")
	if err != nil {
		return nil, err
	}
	if blocked != nil {
		return rateLimitedResponse(blocked), nil
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

	// The PIN is correct and in hand, which is the only moment a stronger hash
	// can be derived. Opportunistic: a failure here costs nothing, because the
	// stored hash remains perfectly valid and the next unlock will try again.
	s.upgradePINHash(ctx, pin, config)

	return mintSession(ctx, s.repo, sourceIP)
}

// upgradePINHash re-derives and stores the PIN hash when the stored one was
// written with weaker parameters. Called only after a SUCCESSFUL verify, so it
// never fires on a guess.
//
// Every failure is logged and swallowed. The user got their PIN right; refusing
// the login because a strengthening write failed would turn an improvement into
// an outage, and the old hash is still valid.
func (s *AuthService) upgradePINHash(ctx context.Context, pin string, config *model.Config) {
	if config == nil || !pinHashOutdated(config.PinHash) {
		return
	}
	newHash, err := hashPIN(pin)
	if err != nil {
		log.Printf("warn: could not re-hash PIN for parameter upgrade: %v", err)
		return
	}
	updated := *config
	updated.PinHash = newHash
	if err := s.repo.SaveConfig(ctx, &updated); err != nil {
		log.Printf("warn: could not store upgraded PIN hash: %v", err)
		return
	}
	log.Printf("info: PIN hash upgraded to m=%d,t=%d,p=%d", argonMemory, argonTime, argonThreads)
}

// mintSession is the tail every successful login shares: clear the per-IP
// failure counter and issue a session token.
//
// It exists as one function because the PIN and biometric paths had separate
// copies that disagreed on the important detail. Clearing the counter is
// bookkeeping on a login that has ALREADY succeeded, and the RATELIMIT row's
// 15-minute TTL expires the window on its own, so a transient failure there is
// worth a log and nothing more. VerifyPIN did that; WebAuthnService.FinishLogin
// returned the error, so a blip on a counter write turned a valid biometric
// unlock into a 500 — refusing entry to the user whose authenticator had just
// verified. With one implementation the two cannot drift apart again.
//
// The session write is the opposite case: it IS the login, so a failure there
// must be surfaced rather than reporting success with a token that was never
// stored.
func mintSession(ctx context.Context, repo repository.RepositoryInterface, sourceIP string) (*model.VerifyPinResponse, error) {
	if err := repo.ClearRateLimit(ctx, sourceIP); err != nil {
		log.Printf("warn: ClearRateLimit failed for ip=%s: %v", sourceIP, err)
	}

	token := uuid.New().String()
	if err := repo.CreateSession(ctx, token, sessionTTLHours); err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}

	return &model.VerifyPinResponse{
		Success: true,
		Token:   token,
	}, nil
}

// pinGuessBlocked reports whether a PIN guess may be EVALUATED at all, by
// consulting the per-IP cap and then the account-wide one. It returns the entry
// that tripped (so the caller can derive a wait time) or nil when the guess is
// allowed.
//
// Both checks deliberately precede any hash comparison: a cap that is applied
// afterwards cannot stop a guess from being answered, which is the only thing
// that makes it a brute-force control. It is also why a tripped cap refuses the
// CORRECT PIN too — see globalMaxAttempts for why that trade is acceptable.
//
// Shared by VerifyPIN and ChangePIN. Both evaluate the stored PIN hash against
// caller-supplied input, so both have to be gated identically; a cap on one and
// not the other is not a cap at all, since an attacker simply uses the endpoint
// that does not count. `action` only labels the log line.
func (s *AuthService) pinGuessBlocked(ctx context.Context, sourceIP, action string) (*model.RateLimitEntry, error) {
	perIP, err := s.repo.GetRateLimitEntry(ctx, sourceIP)
	if err != nil {
		return nil, err
	}
	if perIP != nil && perIP.Attempts >= maxAttempts {
		// Cap reached for this 15-minute window. Refuse immediately —
		// without burning Argon2 cycles or sliding the counter. The
		// RATELIMIT row's TTL lifts the block automatically once the
		// window elapses.
		return perIP, nil
	}

	global, err := s.repo.GetRateLimitEntry(ctx, repository.RateLimitScopeGlobal)
	if err != nil {
		return nil, err
	}
	if global != nil && global.Attempts >= globalMaxAttempts {
		log.Printf("warn: global PIN attempt cap reached (%d in window); refusing %s from ip=%s",
			global.Attempts, action, sourceIP)
		return global, nil
	}
	return nil, nil
}

// failedAttempt records a single failed verify and returns the
// not-authorized response. The increment is conditional (attempts < cap):
// if the conditional fails the cap was reached concurrently (B6), and we
// return the rate-limited 429 response derived from the current row.
func (s *AuthService) failedAttempt(ctx context.Context, sourceIP string) (*model.VerifyPinResponse, error) {
	// Bump the account-wide counter as well as the per-IP one. Its conditional
	// increment stops at globalMaxAttempts; hitting that ceiling is not an
	// error here — VerifyPIN's pre-check is what refuses the NEXT attempt — so
	// a cap-reached result is simply ignored and the per-IP accounting below
	// still produces the user-facing response.
	if _, gerr := s.repo.IncrementFailedAttempts(ctx, repository.RateLimitScopeGlobal, globalMaxAttempts); gerr != nil &&
		!errors.Is(gerr, repository.ErrRateLimitCapReached) {
		// A failure to record the global attempt must not hand the caller a
		// free guess, so it is logged rather than returned.
		log.Printf("warn: global rate-limit increment failed: %v", gerr)
	}

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

// ChangePIN rotates the PIN after verifying the current one.
//
// It calls verifyPINHash directly rather than VerifyPIN so that a correct
// current PIN does not also mint a stray session token. It does NOT, however,
// skip rate limiting.
//
// It used to. The reasoning was that counting wrong-current-PIN attempts
// against the login limiter "would lock the account from its own owner" — but
// the consequence was an unbounded PIN-guessing oracle: verifyPINHash ran on
// whatever it was handed and answered "Current PIN is incorrect", with no cap,
// forever. 10,000 combinations for a 4-digit PIN is minutes of scripted work.
// A session token is needed to reach it, which narrows who can, but that is
// precisely the position the revoke-then-update ordering below already assumes
// an attacker can be in — and the everyday version is a household device left
// unlocked. The PIN is the credential that outlives the session, so handing out
// unlimited guesses at it undoes the caps everywhere else.
//
// So a wrong current PIN now draws down the SAME per-IP and account-wide budget
// as a wrong PIN at the lock screen. Sharing the budget is the point: a cap on
// verify alone is not a cap, because an attacker just moves to the endpoint that
// does not count. The original lockout worry is real but small — the window is
// 15 minutes and self-expiring, the owner fumbling their own PIN in settings is
// in exactly the position they would be in fumbling it at the lock screen, and a
// SUCCESSFUL change clears the per-IP counter so a single fumble leaves nothing
// behind. An uncapped oracle is the worse of the two by a wide margin.
//
// Order of operations is deliberately revoke-then-update:
//  1. Revoke every session AND every enrolled biometric credential. If
//     either fails, we abort — the user will see an error and can retry.
//     The PIN is unchanged.
//  2. Update the PIN hash. If this fails, sessions and credentials are
//     already gone and the user has to re-authenticate with the OLD PIN
//     and re-enrol biometrics. That's recoverable.
//
// The OLD ordering (update PIN first, then revoke) silently logged
// session-revoke failures and returned success. A stolen token could
// then survive the PIN rotation while the API reported the change
// completed — a defense-in-depth failure for the only mechanism the
// user has to invalidate compromised sessions.
func (s *AuthService) ChangePIN(ctx context.Context, currentPIN, newPIN, sourceIP string) error {
	// Validated first, so a client-side mistake in the NEW pin costs no guess
	// budget. It also reveals nothing about the current PIN, since the answer
	// does not depend on it.
	if err := validatePIN(newPIN); err != nil {
		return err
	}

	blocked, err := s.pinGuessBlocked(ctx, sourceIP, "change")
	if err != nil {
		return err
	}
	if blocked != nil {
		return ErrRateLimited
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
		// Spend from the shared budget. failedAttempt's response shape is for
		// the lock screen, so only its accounting is wanted here; the caller
		// gets a plain ErrInvalidPIN and the pre-check above refuses the next
		// attempt once the budget is gone.
		if _, ferr := s.failedAttempt(ctx, sourceIP); ferr != nil {
			// Losing the record must not hand out a free guess, so it is logged
			// and the guess still counts as wrong.
			log.Printf("warn: recording failed change-PIN attempt for ip=%s: %v", sourceIP, ferr)
		}
		return ErrInvalidPIN
	}

	// The current PIN was right, so any earlier fumble from this address was a
	// fumble and not an attack. Clearing keeps a mistake in settings from
	// eating into the lock screen's budget, which is what makes sharing the
	// budget cheap enough to be worth it. Same treatment a successful verify
	// gets; a warning is enough on failure, since the window self-expires.
	if err := s.repo.ClearRateLimit(ctx, sourceIP); err != nil {
		log.Printf("warn: ClearRateLimit failed after PIN change for ip=%s: %v", sourceIP, err)
	}

	hash, err := hashPIN(newPIN)
	if err != nil {
		return fmt.Errorf("failed to hash PIN: %w", err)
	}

	// Step 1: revoke every session. Hard failure aborts the change.
	if err := s.repo.DeleteAllSessions(ctx); err != nil {
		return fmt.Errorf("failed to revoke sessions: %w", err)
	}

	// Step 1b: revoke every enrolled biometric credential, for the same
	// reason and with the same hard-failure handling. Biometric unlock is an
	// independent path to a session that never involves the PIN, so an
	// attacker who reached an authenticated session once could enroll their
	// own authenticator and keep minting sessions straight through a PIN
	// rotation. Rotating the PIN has to close every door, not just the one
	// the PIN opens. The user re-enrols from the post-login prompt.
	if err := s.repo.DeleteAllWebAuthnCredentials(ctx); err != nil {
		return fmt.Errorf("failed to revoke biometric credentials: %w", err)
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
// pinHashOutdated reports whether a stored hash was written with weaker
// parameters than the current ones, and so should be re-derived.
//
// It exists because raising the Argon2 constants does nothing for anyone who
// already has a PIN: verifyPINHash reads m/t/p out of the stored hash — which is
// what makes raising them safe at all — so an old hash would go on verifying
// under its old parameters forever. The upgrade has to be driven from the one
// moment the plaintext PIN is available and known correct, which is a successful
// verify.
//
// Conservative on purpose: anything it cannot parse is reported as NOT outdated.
// Rewriting a stored credential on the strength of a hash we could not read
// would be worse than leaving it alone.
func pinHashOutdated(encodedHash string) bool {
	parts := strings.Split(encodedHash, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	var memory, timeCost uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &timeCost, &threads); err != nil {
		return false
	}
	// Compare the work done (m*t) rather than each parameter separately, so a
	// hash written with a different but equivalent-or-stronger mix is left alone.
	// Memory is also required to be at least current, since that is the property
	// being raised and a low-memory/high-time hash is not an acceptable substitute.
	return memory < argonMemory || uint64(memory)*uint64(timeCost) < uint64(argonMemory)*uint64(argonTime)
}

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
