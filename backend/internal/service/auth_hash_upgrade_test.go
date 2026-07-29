package service

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"golang.org/x/crypto/argon2"
)

// The Argon2 parameters were sized for a Lambda that no longer exists: the
// constant carried the comment "16MB (fits in 128MB Lambda)" while the template
// deploys 256MB. 16MiB is below current guidance, and a 4-digit PIN is only
// 10,000 candidates, so hashing cost is doing much of the work.
//
// Raising them is only safe because verifyPINHash reads m/t/p out of the STORED
// hash rather than from the constants, so existing PINs keep verifying with
// their original parameters. That leaves the upgrade problem: without a rehash
// an existing PIN would never actually gain the stronger parameters, since
// nothing re-derives it. So a successful verify against an outdated hash
// re-hashes and stores it — the standard transparent upgrade.

// legacyHash builds a PIN hash with the OLD parameters (m=16MiB, t=3, p=1),
// exactly as the previous code would have written it.
func legacyHash(t *testing.T, pin string) string {
	t.Helper()
	salt := []byte("0123456789abcdef")
	const (
		oldMem     = 16 * 1024
		oldTime    = 3
		oldThreads = 1
	)
	key := argon2.IDKey([]byte(pin), salt, oldTime, oldMem, oldThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=19$m=%d,t=%d,p=%d$%s$%s",
		oldMem, oldTime, oldThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key))
}

func TestHashPIN_UsesTheCurrentParameters(t *testing.T) {
	h, err := hashPIN("1234")
	if err != nil {
		t.Fatalf("hashPIN: %v", err)
	}
	want := fmt.Sprintf("m=%d,t=%d,p=%d", argonMemory, argonTime, argonThreads)
	if !strings.Contains(h, want) {
		t.Errorf("hash %q does not encode the current parameters (%s)", h, want)
	}
}

// The parameters must be strong enough to be worth the change at all, and must
// fit the Lambda they run in. 64MiB of transient allocation inside a 256MB
// function leaves room for the Go runtime and the AWS SDK; 96MiB or more does
// not, and an OOM on the auth path is a hard outage.
func TestArgonParameters_AreStrongAndFitTheLambda(t *testing.T) {
	const mib = 1024
	if argonMemory < 46*mib {
		t.Errorf("argonMemory = %d KiB, want at least 46 MiB (46080 KiB)", argonMemory)
	}
	if argonMemory > 64*mib {
		t.Errorf("argonMemory = %d KiB, more than 64 MiB — too close to the 256MB "+
			"Lambda's budget once the Go runtime and AWS SDK are resident", argonMemory)
	}
	// Total work is m*t; it must not have gone DOWN while memory went up.
	const oldWork = 16 * mib * 3
	if got := int(argonMemory) * int(argonTime); got < oldWork {
		t.Errorf("total work m*t = %d, less than the previous %d — memory was raised "+
			"by trading away more time than it gained", got, oldWork)
	}
}

// A PIN hashed under the old parameters must still verify. Anything else locks
// every existing user out on deploy.
func TestVerifyPINHash_AcceptsALegacyHash(t *testing.T) {
	stored := legacyHash(t, "1234")
	ok, err := verifyPINHash("1234", stored)
	if err != nil {
		t.Fatalf("verifyPINHash: %v", err)
	}
	if !ok {
		t.Fatal("a PIN hashed with the previous parameters no longer verifies")
	}
	wrong, err := verifyPINHash("9999", stored)
	if err != nil {
		t.Fatalf("verifyPINHash: %v", err)
	}
	if wrong {
		t.Error("the wrong PIN verified against a legacy hash")
	}
}

func TestPinHashOutdated(t *testing.T) {
	if !pinHashOutdated(legacyHash(t, "1234")) {
		t.Error("a legacy hash is not being reported as outdated, so it would never upgrade")
	}
	current, err := hashPIN("1234")
	if err != nil {
		t.Fatalf("hashPIN: %v", err)
	}
	if pinHashOutdated(current) {
		t.Error("a freshly written hash is reported as outdated, which would rewrite " +
			"the config on every single login")
	}
	// Unparseable input must not be treated as upgradeable — rewriting on the
	// strength of a hash we could not read would be worse than leaving it.
	if pinHashOutdated("not-a-hash") {
		t.Error("an unparseable hash was reported as outdated")
	}
}

// The upgrade itself: unlocking with a legacy hash succeeds and quietly stores a
// stronger one.
func TestVerifyPIN_UpgradesALegacyHashOnSuccess(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	repo.Config = &model.Config{PinHash: legacyHash(t, "1234")}

	resp, err := svc.VerifyPIN(ctx, "1234", "192.168.1.5")
	if err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	if !resp.Success || resp.Token == "" {
		t.Fatalf("resp = %+v, want a successful login", resp)
	}

	want := fmt.Sprintf("m=%d,t=%d,p=%d", argonMemory, argonTime, argonThreads)
	if !strings.Contains(repo.Config.PinHash, want) {
		t.Errorf("stored hash still carries the old parameters: %q", repo.Config.PinHash)
	}
	// And the upgraded hash must still verify the same PIN.
	if ok, verr := verifyPINHash("1234", repo.Config.PinHash); verr != nil || !ok {
		t.Errorf("the upgraded hash does not verify the PIN (ok=%v err=%v)", ok, verr)
	}
}

func TestVerifyPIN_DoesNotRewriteAnAlreadyCurrentHash(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	seedPIN(t, repo, "1234")
	repo.SaveConfigCalls = 0

	if _, err := svc.VerifyPIN(ctx, "1234", "192.168.1.5"); err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	if repo.SaveConfigCalls != 0 {
		t.Errorf("SaveConfig called %d times on an ordinary login; the upgrade must "+
			"fire once, not on every unlock", repo.SaveConfigCalls)
	}
}

// A wrong PIN must not trigger an upgrade — there is nothing to upgrade to, and
// writing on a failed attempt would hand an attacker a way to cause writes.
func TestVerifyPIN_DoesNotUpgradeOnAFailedAttempt(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	legacy := legacyHash(t, "1234")
	repo.Config = &model.Config{PinHash: legacy}
	repo.SaveConfigCalls = 0

	if _, err := svc.VerifyPIN(ctx, "9999", "192.168.1.5"); err != nil {
		t.Fatalf("VerifyPIN: %v", err)
	}
	if repo.SaveConfigCalls != 0 {
		t.Errorf("SaveConfig called %d times after a WRONG PIN", repo.SaveConfigCalls)
	}
	if repo.Config.PinHash != legacy {
		t.Error("the stored hash changed after a failed attempt")
	}
}

// The upgrade is opportunistic. If it cannot be stored, the user is still logged
// in — they got the PIN right, and the old hash remains perfectly valid.
func TestVerifyPIN_SucceedsWhenTheUpgradeCannotBeStored(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	repo.Config = &model.Config{PinHash: legacyHash(t, "1234")}
	repo.SaveConfigErr = errors.New("transient DynamoDB failure")

	resp, err := svc.VerifyPIN(ctx, "1234", "192.168.1.5")
	if err != nil {
		t.Fatalf("VerifyPIN failed because the hash upgrade could not be stored: %v", err)
	}
	if !resp.Success || resp.Token == "" {
		t.Errorf("resp = %+v, want a successful login", resp)
	}
}

// ChangePIN writes a fresh hash anyway, so it needs no upgrade path — but it
// must actually use the current parameters.
func TestChangePIN_WritesACurrentHash(t *testing.T) {
	ctx := context.Background()
	svc, repo := newAuthService(t)
	repo.Config = &model.Config{PinHash: legacyHash(t, "1234")}

	if err := svc.ChangePIN(ctx, "1234", "5678", "192.168.1.6"); err != nil {
		t.Fatalf("ChangePIN: %v", err)
	}
	want := fmt.Sprintf("m=%d,t=%d,p=%d", argonMemory, argonTime, argonThreads)
	if !strings.Contains(repo.Config.PinHash, want) {
		t.Errorf("ChangePIN wrote %q, which does not carry the current parameters", repo.Config.PinHash)
	}
}
