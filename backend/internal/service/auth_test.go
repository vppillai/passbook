package service

import (
	"testing"
)

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
