package repository

import (
	"context"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
)

// RepositoryInterface is the contract the service layer depends on. The
// concrete *Repository struct implements every method here; tests can
// swap in an in-memory fake to exercise service logic without DynamoDB.
//
// This indirection is the single 30-minute refactor the test-engineer
// review identified as the prerequisite for unit-testing the service
// layer at all (the constructors previously took *Repository directly,
// so a test had no way to inject a fake).
type RepositoryInterface interface {
	// Config
	GetConfig(ctx context.Context) (*model.Config, error)
	SaveConfig(ctx context.Context, config *model.Config) error
	CreateConfig(ctx context.Context, config *model.Config) error

	// Balance
	GetBalance(ctx context.Context) (*model.Balance, error)

	// Months
	GetMonthSummary(ctx context.Context, month string) (*model.MonthSummary, error)
	SaveMonthSummary(ctx context.Context, summary *model.MonthSummary) error
	// CreateMonthSummaryIfAbsent conditionally creates a $0-allowance
	// month (canonical row + MONTHLIST copy); ErrMonthAlreadyExists on
	// a concurrent create.
	CreateMonthSummaryIfAbsent(ctx context.Context, summary *model.MonthSummary) error
	// ListMonths queries the MONTHLIST index partition (sorted desc,
	// natively paginated) — no full-table scan.
	ListMonths(ctx context.Context, limit int32, cursor map[string]types.AttributeValue) ([]model.MonthSummary, map[string]types.AttributeValue, error)
	// ListAllMonthsLegacy + BackfillMonthList power the one-time lazy
	// migration when the MONTHLIST partition is empty on an old table.
	ListAllMonthsLegacy(ctx context.Context) ([]model.MonthSummary, error)
	BackfillMonthList(ctx context.Context, summaries []model.MonthSummary) error
	// EnsureMonthListMirror back-fills the single MONTHLIST mirror row for a
	// month (full copy of the canonical summary, race-tolerant) so the
	// attribute_exists(PK) condition on the atomic mutations' monthListUpdate
	// cannot cancel the transaction on legacy tables that predate the mirror.
	EnsureMonthListMirror(ctx context.Context, month string) error
	// PropagateLaterMonthDeltas applies a conditional delta to
	// starting_balance + ending_balance on each named month's canonical row
	// AND its mirror, batched into one TransactWriteItems (chunked at the
	// 100-item cap) so carry-chain propagation is atomic and composes with
	// concurrent writes.
	PropagateLaterMonthDeltas(ctx context.Context, months []string, delta float64) error

	// Expenses
	GetExpense(ctx context.Context, month string, expenseID string) (*model.Expense, error)
	GetExpenses(ctx context.Context, month string, limit int32, cursor map[string]types.AttributeValue) ([]model.Expense, map[string]types.AttributeValue, error)
	UpdateExpense(ctx context.Context, month string, expenseID string, amount float64, description string) (*model.Expense, error)
	DeleteExpense(ctx context.Context, month string, expenseID string) (*model.Expense, error)

	// Atomic (TransactWriteItems) operations — service's preferred path
	// for any multi-row mutation. See dynamodb.go for rationale.
	AtomicAddExpense(ctx context.Context, month string, expense *model.Expense, checkBalance bool) error
	AtomicUpdateExpense(ctx context.Context, month string, expenseID string, oldAmount, newAmount float64, newDescription string, checkBalance bool) error
	AtomicDeleteExpense(ctx context.Context, month string, expenseID string, oldAmount float64) error
	AtomicCreateMonth(ctx context.Context, summary *model.MonthSummary, allowance float64) error
	AtomicAddFunds(ctx context.Context, month string, amount float64) error
	AtomicDeleteMonth(ctx context.Context, month string, allowanceAdded float64) error

	// Sessions
	CreateSession(ctx context.Context, token string, ttlHours int) error
	GetSession(ctx context.Context, token string) (*model.Session, error)
	DeleteSession(ctx context.Context, token string) error
	DeleteAllSessions(ctx context.Context) error

	// Rate limiting — per-IP scoping (PK = "RATELIMIT#<ip>").
	GetRateLimitEntry(ctx context.Context, sourceIP string) (*model.RateLimitEntry, error)
	// IncrementFailedAttempts conditionally bumps the counter while it is
	// below maxAttempts; ErrRateLimitCapReached when already at the cap (B6).
	IncrementFailedAttempts(ctx context.Context, sourceIP string, maxAttempts int) (*model.RateLimitEntry, error)
	ClearRateLimit(ctx context.Context, sourceIP string) error

	// WebAuthn — biometric unlock.
	// PutWebAuthnChallenge persists an in-flight ceremony session under
	// PK=SK="WACHAL#<challengeID>" with a short DynamoDB TTL.
	PutWebAuthnChallenge(ctx context.Context, challengeID, sessionData string, ttlSeconds int) error
	// GetWebAuthnChallenge fetches a stored ceremony session by ID; nil
	// (no error) when absent or past its TTL.
	GetWebAuthnChallenge(ctx context.Context, challengeID string) (*model.WebAuthnChallenge, error)
	// DeleteWebAuthnChallenge removes a ceremony session (single-use).
	DeleteWebAuthnChallenge(ctx context.Context, challengeID string) error
	// PutWebAuthnCredential stores a credential (canonical row + WACREDLIST
	// mirror) so login can enumerate it.
	PutWebAuthnCredential(ctx context.Context, cred *model.WebAuthnCredential) error
	// GetWebAuthnCredential fetches a single credential by its base64url ID;
	// nil (no error) when absent.
	GetWebAuthnCredential(ctx context.Context, credentialID string) (*model.WebAuthnCredential, error)
	// ListWebAuthnCredentials enumerates every stored credential via a single
	// Query over the WACREDLIST partition (mirrors the MONTHLIST pattern).
	ListWebAuthnCredentials(ctx context.Context) ([]model.WebAuthnCredential, error)
	// DeleteAllWebAuthnCredentials removes every stored credential (canonical
	// rows + WACREDLIST mirrors) so the user can disable biometrics.
	DeleteAllWebAuthnCredentials(ctx context.Context) error
}

// Compile-time assertion that the concrete Repository implements the interface.
var _ RepositoryInterface = (*Repository)(nil)
