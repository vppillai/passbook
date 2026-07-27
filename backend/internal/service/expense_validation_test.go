package service

import (
	"context"
	"strings"
	"testing"

	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/testutil"
)

// TestAddFunds_RejectsAbsurdAmount pins an upper bound on a top-up.
//
// AddExpense caps at 99999.99 and the frontend's number inputs cap funds at
// the same value, but the service only rejected amount <= 0 — so a request
// that bypasses the form could credit an arbitrary figure straight into the
// month summary and the global balance. There is no undo for that beyond
// hand-editing DynamoDB.
func TestAddFunds_RejectsAbsurdAmount(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, true, 100)
	testutil.SeedMonth(repo, "2026-02", 0, 100, 0, 100)
	repo.Balance = &model.Balance{TotalBalance: 100}

	if _, err := svc.AddFunds(ctx, "2026-02", 1e15); err != ErrInvalidAmount {
		t.Errorf("AddFunds(1e15) = %v, want ErrInvalidAmount", err)
	}
	if _, err := svc.AddFunds(ctx, "2026-02", 100000); err != ErrInvalidAmount {
		t.Errorf("AddFunds(100000) = %v, want ErrInvalidAmount (cap is 99999.99)", err)
	}
	// The boundary itself must still be accepted.
	if _, err := svc.AddFunds(ctx, "2026-02", 99999.99); err != nil {
		t.Errorf("AddFunds(99999.99) = %v, want nil", err)
	}
	// And nothing was credited by the rejected calls.
	if got := repo.Months["2026-02"].AllowanceAdded; got != 100+99999.99 {
		t.Errorf("AllowanceAdded = %v, want %v", got, 100+99999.99)
	}
}

// TestDescriptionLimit_CountsCharactersNotBytes pins that the documented
// "max 100 characters" limit means characters.
//
// The check used len(), which counts BYTES. The HTML input carries
// maxlength="100", which counts UTF-16 code units, so a description the form
// happily accepted — 100 characters of any non-Latin script — was rejected by
// the server with a 400 the user could not act on.
func TestDescriptionLimit_CountsCharactersNotBytes(t *testing.T) {
	ctx := context.Background()
	month := GetCurrentMonth()

	// 100 characters, 3 bytes each in UTF-8: fine by the documented rule,
	// 300 bytes by the old one.
	hundredChars := strings.Repeat("あ", 100)
	if got := len([]rune(hundredChars)); got != 100 {
		t.Fatalf("fixture is %d runes, want 100", got)
	}

	t.Run("add accepts 100 characters", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 0)
		testutil.SeedMonth(repo, month, 0, 1000, 0, 1000)
		repo.Balance = &model.Balance{TotalBalance: 1000}
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
			Amount: 5, Description: hundredChars,
		}); err != nil {
			t.Errorf("AddExpense with 100 multi-byte chars = %v, want nil", err)
		}
	})

	t.Run("add rejects 101 characters", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 0)
		testutil.SeedMonth(repo, month, 0, 1000, 0, 1000)
		repo.Balance = &model.Balance{TotalBalance: 1000}
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
			Amount: 5, Description: strings.Repeat("a", 101),
		}); err != ErrDescriptionTooLong {
			t.Errorf("got %v, want ErrDescriptionTooLong", err)
		}
	})

	// Add checked the length BEFORE trimming while edit checked it AFTER, so
	// a padded string was rejected on one path and accepted on the other.
	t.Run("add trims before measuring, like edit", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 0)
		testutil.SeedMonth(repo, month, 0, 1000, 0, 1000)
		repo.Balance = &model.Balance{TotalBalance: 1000}
		padded := "   " + strings.Repeat("a", 100) + "   "
		if _, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
			Amount: 5, Description: padded,
		}); err != nil {
			t.Errorf("AddExpense with padded 100-char description = %v, want nil "+
				"(edit accepts this, add must too)", err)
		}
	})

	t.Run("edit rejects 101 characters", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 0)
		testutil.SeedMonth(repo, month, 0, 1000, 5, 995)
		repo.Balance = &model.Balance{TotalBalance: 995}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey(month, id)] = &model.Expense{SK: id, Amount: 5}
		desc := strings.Repeat("a", 101)
		if _, err := svc.UpdateExpense(ctx, month, id,
			&model.UpdateExpenseRequest{Description: &desc}); err != ErrDescriptionTooLong {
			t.Errorf("got %v, want ErrDescriptionTooLong", err)
		}
	})

	t.Run("edit accepts 100 characters", func(t *testing.T) {
		svc, repo := newExpenseService(t, true, true, 0)
		testutil.SeedMonth(repo, month, 0, 1000, 5, 995)
		repo.Balance = &model.Balance{TotalBalance: 995}
		id := "EXP#1#abc"
		repo.Expenses[testutil.ExpenseKey(month, id)] = &model.Expense{SK: id, Amount: 5}
		if _, err := svc.UpdateExpense(ctx, month, id,
			&model.UpdateExpenseRequest{Description: &hundredChars}); err != nil {
			t.Errorf("UpdateExpense with 100 multi-byte chars = %v, want nil", err)
		}
	})
}
