package repository

import (
	"errors"
	"fmt"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// The repository's DynamoDB calls are exercised against the real service;
// these tests cover the pure helpers — especially txConditionFailedIndex,
// whose index mapping decides whether a failed transaction surfaces as
// "insufficient funds" vs "state mismatch" to the user.

func TestTxConditionFailedIndex(t *testing.T) {
	t.Run("finds the first ConditionalCheckFailed reason", func(t *testing.T) {
		err := &types.TransactionCanceledException{
			CancellationReasons: []types.CancellationReason{
				{Code: aws.String("None")},
				{Code: aws.String("ConditionalCheckFailed")},
				{Code: aws.String("None")},
			},
		}
		idx, ok := txConditionFailedIndex(err)
		if !ok || idx != 1 {
			t.Errorf("got (%d, %v), want (1, true)", idx, ok)
		}
	})

	t.Run("sees through error wrapping", func(t *testing.T) {
		inner := &types.TransactionCanceledException{
			CancellationReasons: []types.CancellationReason{
				{Code: aws.String("ConditionalCheckFailed")},
			},
		}
		wrapped := fmt.Errorf("transact failed: %w", inner)
		idx, ok := txConditionFailedIndex(wrapped)
		if !ok || idx != 0 {
			t.Errorf("got (%d, %v), want (0, true)", idx, ok)
		}
	})

	t.Run("non-transaction error", func(t *testing.T) {
		if _, ok := txConditionFailedIndex(errors.New("boom")); ok {
			t.Error("ok = true for a plain error, want false")
		}
	})

	t.Run("cancellation without condition failures", func(t *testing.T) {
		err := &types.TransactionCanceledException{
			CancellationReasons: []types.CancellationReason{
				{Code: aws.String("TransactionConflict")},
			},
		}
		if _, ok := txConditionFailedIndex(err); ok {
			t.Error("ok = true with no ConditionalCheckFailed reason, want false")
		}
	})
}

func TestExtractExpenseID(t *testing.T) {
	if got := ExtractExpenseID("EXP#123#abc"); got != "123#abc" {
		t.Errorf("ExtractExpenseID = %q, want \"123#abc\"", got)
	}
	if got := ExtractExpenseID("no-prefix"); got != "no-prefix" {
		t.Errorf("ExtractExpenseID = %q, want passthrough", got)
	}
}

func TestRateLimitPK(t *testing.T) {
	if got := rateLimitPK("203.0.113.7"); got != "RATELIMIT#203.0.113.7" {
		t.Errorf("rateLimitPK = %q", got)
	}
	// Empty IP must degrade to a shared bucket, never the bare prefix.
	if got := rateLimitPK(""); got != "RATELIMIT#unknown" {
		t.Errorf("rateLimitPK(\"\") = %q, want \"RATELIMIT#unknown\"", got)
	}
}
