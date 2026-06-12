// Package testutil provides the shared in-memory fake of
// repository.RepositoryInterface plus small helpers used across the
// service, handler, and middleware test suites. It is imported only by
// _test.go files and is never linked into the Lambda binary.
package testutil

import (
	"context"
	"errors"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
)

// FakeRepo is an in-memory fake of RepositoryInterface. Each test should
// instantiate a fresh one — no shared state. Fields are exported so tests
// can seed and assert on state directly.
//
// The atomic methods (AtomicAddExpense, etc.) compose the simpler
// primitives, modelling the real DDB transaction semantics: condition
// first (returning ErrInsufficientBalance / ErrExpenseStateMismatch on
// failure), then all mutations together.
type FakeRepo struct {
	Config  *model.Config
	Balance *model.Balance
	Months  map[string]*model.MonthSummary
	// MonthList models the MONTHLIST index partition (PK="MONTHLIST").
	// Kept in sync with Months by every write path, exactly like the real
	// repository's transactional mirror. Tests can clear it to exercise
	// the lazy-migration fallback in ListMonths.
	MonthList  map[string]*model.MonthSummary
	Expenses   map[string]*model.Expense
	RateLimits map[string]*model.RateLimitEntry // keyed by sourceIP
	Sessions   map[string]*model.Session
	// WebAuthn state. WAChallenges is keyed by challenge_id; WACredentials
	// is keyed by the credential's base64url ID (mirroring the WACREDLIST
	// enumeration partition).
	WAChallenges  map[string]*model.WebAuthnChallenge
	WACredentials map[string]*model.WebAuthnCredential
}

func NewFakeRepo() *FakeRepo {
	return &FakeRepo{
		Months:        make(map[string]*model.MonthSummary),
		MonthList:     make(map[string]*model.MonthSummary),
		Expenses:      make(map[string]*model.Expense),
		Sessions:      make(map[string]*model.Session),
		RateLimits:    make(map[string]*model.RateLimitEntry),
		WAChallenges:  make(map[string]*model.WebAuthnChallenge),
		WACredentials: make(map[string]*model.WebAuthnCredential),
		Balance:       &model.Balance{TotalBalance: 0},
	}
}

var _ repository.RepositoryInterface = (*FakeRepo)(nil)

// ExpenseKey builds the composite map key used to store expenses by
// (month, SK). Mirrors the PK+SK addressing in DynamoDB.
func ExpenseKey(month, sk string) string { return month + "|" + sk }

// SeedMonth inserts a month summary with the given balances into both the
// canonical Months map and the MonthList index (mirroring the real
// repository's dual-write — the state of a table written under the MONTHLIST
// scheme).
func SeedMonth(f *FakeRepo, month string, start, allow, expenses, ending float64) {
	s := &model.MonthSummary{
		Month:           month,
		StartingBalance: start,
		AllowanceAdded:  allow,
		TotalExpenses:   expenses,
		EndingBalance:   ending,
	}
	f.Months[month] = s
	listCopy := *s
	f.MonthList[month] = &listCopy
}

// SeedLegacyMonth inserts ONLY the canonical month summary with NO MonthList
// mirror — exactly the state of a live production table written before the
// MONTHLIST scheme existed. The atomic mutation methods model DynamoDB's
// transactional condition: a monthList delta against a missing mirror
// CANCELS the transaction (returns errMonthListMirrorMissing), so this
// helper exercises the legacy-table regression that EnsureMonthListMirror
// fixes.
func SeedLegacyMonth(f *FakeRepo, month string, start, allow, expenses, ending float64) {
	f.Months[month] = &model.MonthSummary{
		Month:           month,
		StartingBalance: start,
		AllowanceAdded:  allow,
		TotalExpenses:   expenses,
		EndingBalance:   ending,
	}
	delete(f.MonthList, month)
}

// FmtFloat renders a float64 exactly as attributevalue marshals it into
// DynamoDB (shortest round-trip form). Cent-rounding bugs are invisible
// to tolerance-based comparison — dusty and clean values differ by ~1
// ULP — but show up plainly in this string.
func FmtFloat(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

// AlmostEqual compares dollar floats with a tolerance; cent values are
// not exactly representable in float64, so direct == on arithmetic
// results is flaky by one ULP.
func AlmostEqual(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

// =====================================================================
// Config
// =====================================================================

func (f *FakeRepo) GetConfig(_ context.Context) (*model.Config, error) {
	if f.Config == nil {
		return nil, nil
	}
	c := *f.Config
	return &c, nil
}

func (f *FakeRepo) SaveConfig(_ context.Context, config *model.Config) error {
	c := *config
	f.Config = &c
	return nil
}

func (f *FakeRepo) CreateConfig(_ context.Context, config *model.Config) error {
	if f.Config != nil {
		return repository.ErrConfigAlreadyExists
	}
	c := *config
	f.Config = &c
	return nil
}

// =====================================================================
// Balance
// =====================================================================

func (f *FakeRepo) GetBalance(_ context.Context) (*model.Balance, error) {
	if f.Balance == nil {
		return &model.Balance{TotalBalance: 0}, nil
	}
	b := *f.Balance
	return &b, nil
}

// =====================================================================
// Months
// =====================================================================

// errMonthListMirrorMissing models DynamoDB cancelling a TransactWriteItems
// because a monthListUpdate's attribute_exists(PK) condition failed — the
// MONTHLIST mirror row does not exist (the legacy-table CRITICAL defect).
var errMonthListMirrorMissing = errors.New("month list mirror missing: transaction cancelled")

// putMonthListMirror writes a full copy of the canonical summary into the
// MonthList index — the dual-Put done inside transactions that CREATE a
// month (AtomicCreateMonth / CreateMonthSummaryIfAbsent / SaveMonthSummary),
// which always materialise both rows together.
func (f *FakeRepo) putMonthListMirror(month string) {
	s, ok := f.Months[month]
	if !ok {
		delete(f.MonthList, month)
		return
	}
	copy := *s
	f.MonthList[month] = &copy
}

// applyMonthListDelta models the real monthListUpdate: a conditional delta
// update on the mirror row whose attribute_exists(PK) guard CANCELS the
// whole transaction when the mirror is absent. Returns
// errMonthListMirrorMissing in that case, exactly as DynamoDB would. When
// the mirror exists it is mutated by the supplied deltas (NOT re-synced from
// the canonical row) so the fake faithfully reproduces independent-row
// drift if the two ever diverge.
func (f *FakeRepo) applyMonthListDelta(month string, totalExpensesDelta, endingDelta, allowanceDelta, startingDelta float64) error {
	mirror, ok := f.MonthList[month]
	if !ok {
		return errMonthListMirrorMissing
	}
	mirror.TotalExpenses += totalExpensesDelta
	mirror.EndingBalance += endingDelta
	mirror.AllowanceAdded += allowanceDelta
	mirror.StartingBalance += startingDelta
	return nil
}

func (f *FakeRepo) GetMonthSummary(_ context.Context, month string) (*model.MonthSummary, error) {
	s, ok := f.Months[month]
	if !ok {
		return nil, nil
	}
	out := *s
	return &out, nil
}

func (f *FakeRepo) SaveMonthSummary(_ context.Context, summary *model.MonthSummary) error {
	s := *summary
	f.Months[summary.Month] = &s
	f.putMonthListMirror(summary.Month)
	return nil
}

func (f *FakeRepo) CreateMonthSummaryIfAbsent(_ context.Context, summary *model.MonthSummary) error {
	if _, exists := f.Months[summary.Month]; exists {
		return repository.ErrMonthAlreadyExists
	}
	s := *summary
	f.Months[summary.Month] = &s
	f.putMonthListMirror(summary.Month)
	return nil
}

// ListMonths reads the MonthList index, sorts descending by month, and
// applies native key-based pagination via the lastKey marker. The cursor
// map carries the SK ("month") of the last item from the previous page.
func (f *FakeRepo) ListMonths(_ context.Context, limit int32, cursor map[string]types.AttributeValue) ([]model.MonthSummary, map[string]types.AttributeValue, error) {
	all := make([]model.MonthSummary, 0, len(f.MonthList))
	for _, s := range f.MonthList {
		all = append(all, *s)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].Month > all[j].Month })

	start := 0
	if cursor != nil {
		if sk, ok := cursor["SK"].(*types.AttributeValueMemberS); ok {
			for i, s := range all {
				if s.Month == sk.Value {
					start = i + 1
					break
				}
			}
		}
	}

	end := len(all)
	if limit > 0 && start+int(limit) < end {
		end = start + int(limit)
	}
	page := all[start:end]

	var lastKey map[string]types.AttributeValue
	if end < len(all) && len(page) > 0 {
		lastKey = map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: repository.PKMonthList},
			"SK": &types.AttributeValueMemberS{Value: page[len(page)-1].Month},
		}
	}
	return page, lastKey, nil
}

func (f *FakeRepo) ListAllMonthsLegacy(_ context.Context) ([]model.MonthSummary, error) {
	out := make([]model.MonthSummary, 0, len(f.Months))
	for _, s := range f.Months {
		out = append(out, *s)
	}
	return out, nil
}

func (f *FakeRepo) BackfillMonthList(_ context.Context, summaries []model.MonthSummary) error {
	for i := range summaries {
		s := summaries[i]
		f.MonthList[s.Month] = &s
	}
	return nil
}

// EnsureMonthListMirror back-fills the mirror row from the canonical summary
// when absent — the fix the service calls before every atomic mutation on a
// legacy month. Idempotent: a present mirror is left untouched (no clobber
// of any independent drift). A missing canonical row is tolerated (no-op),
// matching the real repository.
func (f *FakeRepo) EnsureMonthListMirror(_ context.Context, month string) error {
	if _, ok := f.MonthList[month]; ok {
		return nil
	}
	s, ok := f.Months[month]
	if !ok {
		return nil
	}
	copy := *s
	f.MonthList[month] = &copy
	return nil
}

// PropagateLaterMonthDeltas applies the carry-chain delta to both the
// canonical row and the mirror of every named month, in one logical
// transaction. It models DynamoDB's all-or-nothing semantics: it first
// validates that every canonical row AND every mirror exists (a missing
// mirror is the legacy-table failure mode), and only then mutates — so a
// single missing mirror cancels the entire propagation with no partial
// writes.
func (f *FakeRepo) PropagateLaterMonthDeltas(_ context.Context, months []string, delta float64) error {
	if len(months) == 0 || delta == 0 {
		return nil
	}
	for _, m := range months {
		if _, ok := f.Months[m]; !ok {
			return errors.New("month not found: propagation transaction cancelled")
		}
		if _, ok := f.MonthList[m]; !ok {
			return errMonthListMirrorMissing
		}
	}
	for _, m := range months {
		s := f.Months[m]
		s.StartingBalance += delta
		s.EndingBalance += delta
		mirror := f.MonthList[m]
		mirror.StartingBalance += delta
		mirror.EndingBalance += delta
	}
	return nil
}

// =====================================================================
// Expenses
// =====================================================================

func (f *FakeRepo) GetExpense(_ context.Context, month string, expenseID string) (*model.Expense, error) {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	out := *e
	return &out, nil
}

func (f *FakeRepo) GetExpenses(_ context.Context, month string, _ int32, _ map[string]types.AttributeValue) ([]model.Expense, map[string]types.AttributeValue, error) {
	out := []model.Expense{}
	for k, e := range f.Expenses {
		if len(k) > len(month) && k[:len(month)] == month {
			out = append(out, *e)
		}
	}
	return out, nil, nil
}

func (f *FakeRepo) UpdateExpense(_ context.Context, month, expenseID string, amount float64, description string) (*model.Expense, error) {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	old := *e
	e.Amount = amount
	e.Description = description
	return &old, nil
}

func (f *FakeRepo) DeleteExpense(_ context.Context, month, expenseID string) (*model.Expense, error) {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return nil, nil
	}
	delete(f.Expenses, ExpenseKey(month, expenseID))
	out := *e
	return &out, nil
}

// =====================================================================
// Atomic operations
// =====================================================================

func (f *FakeRepo) AtomicAddExpense(_ context.Context, month string, expense *model.Expense, checkBalance bool) error {
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	if checkBalance && s.EndingBalance < expense.Amount {
		return repository.ErrInsufficientBalance
	}
	// Transaction includes the monthListUpdate: a missing mirror cancels
	// the whole transaction before any write lands (legacy-table defect).
	if _, ok := f.MonthList[month]; !ok {
		return errMonthListMirrorMissing
	}
	e := *expense
	e.PK = "MONTH#" + month
	f.Expenses[ExpenseKey(month, expense.SK)] = &e
	s.TotalExpenses += expense.Amount
	s.EndingBalance -= expense.Amount
	_ = f.applyMonthListDelta(month, expense.Amount, -expense.Amount, 0, 0)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance -= expense.Amount
	return nil
}

func (f *FakeRepo) AtomicUpdateExpense(_ context.Context, month, expenseID string, oldAmount, newAmount float64, newDescription string, checkBalance bool) error {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	delta := newAmount - oldAmount
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	if checkBalance && delta > 0 && s.EndingBalance < delta {
		return repository.ErrInsufficientBalance
	}
	// Missing mirror cancels the whole transaction (legacy-table defect).
	if _, ok := f.MonthList[month]; !ok {
		return errMonthListMirrorMissing
	}
	e.Amount = newAmount
	e.Description = newDescription
	s.TotalExpenses += delta
	s.EndingBalance -= delta
	_ = f.applyMonthListDelta(month, delta, -delta, 0, 0)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance -= delta
	return nil
}

func (f *FakeRepo) AtomicDeleteExpense(_ context.Context, month, expenseID string, oldAmount float64) error {
	e, ok := f.Expenses[ExpenseKey(month, expenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	// Missing mirror cancels the whole transaction before any write lands
	// (legacy-table defect) — check before deleting the expense row.
	if _, ok := f.MonthList[month]; !ok {
		return errMonthListMirrorMissing
	}
	delete(f.Expenses, ExpenseKey(month, expenseID))
	s.TotalExpenses -= oldAmount
	s.EndingBalance += oldAmount
	_ = f.applyMonthListDelta(month, -oldAmount, oldAmount, 0, 0)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += oldAmount
	return nil
}

// AtomicMoveExpenseSameMonth models the real same-month re-date transaction:
// optimistic-lock the old row (amount = oldAmount → ErrExpenseStateMismatch),
// then in one logical transaction delete the old SK, put the new SK, and
// shift the summary + mirror + balance by the amount delta. A missing mirror
// cancels the whole transaction (legacy-table defect); an overspend with
// checkBalance && delta>0 returns ErrInsufficientBalance before any write.
func (f *FakeRepo) AtomicMoveExpenseSameMonth(_ context.Context, month string, oldExpenseID string, newExpense *model.Expense, oldAmount float64, checkBalance bool) error {
	e, ok := f.Expenses[ExpenseKey(month, oldExpenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	s, ok := f.Months[month]
	if !ok {
		return errors.New("month not found")
	}
	delta := newExpense.Amount - oldAmount
	if checkBalance && delta > 0 && s.EndingBalance < delta {
		return repository.ErrInsufficientBalance
	}
	// Missing mirror cancels the whole transaction (legacy-table defect).
	if _, ok := f.MonthList[month]; !ok {
		return errMonthListMirrorMissing
	}
	delete(f.Expenses, ExpenseKey(month, oldExpenseID))
	ne := *newExpense
	ne.PK = "MONTH#" + month
	f.Expenses[ExpenseKey(month, newExpense.SK)] = &ne
	s.TotalExpenses += delta
	s.EndingBalance -= delta
	_ = f.applyMonthListDelta(month, delta, -delta, 0, 0)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance -= delta
	return nil
}

// AtomicMoveExpenseAcrossMonths models the real cross-month move transaction:
// optimistic-lock the source row, then (all-or-nothing) delete it, refund the
// source summary + mirror by oldAmount, put the new row in dstMonth, charge
// the destination summary + mirror by newAmount, and shift BALANCE by
// (oldAmount - newAmount). A missing mirror on either month cancels the whole
// transaction; an overspend on the destination (checkBalance) returns
// ErrInsufficientBalance before any write lands.
func (f *FakeRepo) AtomicMoveExpenseAcrossMonths(_ context.Context, srcMonth, dstMonth, oldExpenseID string, newExpense *model.Expense, oldAmount float64, checkBalance bool) error {
	e, ok := f.Expenses[ExpenseKey(srcMonth, oldExpenseID)]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	if e.Amount != oldAmount {
		return repository.ErrExpenseStateMismatch
	}
	src, ok := f.Months[srcMonth]
	if !ok {
		return errors.New("source month not found")
	}
	dst, ok := f.Months[dstMonth]
	if !ok {
		return errors.New("destination month not found")
	}
	if _, ok := f.MonthList[srcMonth]; !ok {
		return errMonthListMirrorMissing
	}
	if _, ok := f.MonthList[dstMonth]; !ok {
		return errMonthListMirrorMissing
	}
	if checkBalance && dst.EndingBalance < newExpense.Amount {
		return repository.ErrInsufficientBalance
	}
	delete(f.Expenses, ExpenseKey(srcMonth, oldExpenseID))
	ne := *newExpense
	ne.PK = "MONTH#" + dstMonth
	f.Expenses[ExpenseKey(dstMonth, newExpense.SK)] = &ne
	src.TotalExpenses -= oldAmount
	src.EndingBalance += oldAmount
	_ = f.applyMonthListDelta(srcMonth, -oldAmount, oldAmount, 0, 0)
	dst.TotalExpenses += newExpense.Amount
	dst.EndingBalance -= newExpense.Amount
	_ = f.applyMonthListDelta(dstMonth, newExpense.Amount, -newExpense.Amount, 0, 0)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += oldAmount - newExpense.Amount
	return nil
}

func (f *FakeRepo) AtomicCreateMonth(_ context.Context, summary *model.MonthSummary, allowance float64) error {
	if _, exists := f.Months[summary.Month]; exists {
		return repository.ErrMonthAlreadyExists
	}
	s := *summary
	f.Months[summary.Month] = &s
	f.putMonthListMirror(summary.Month)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += allowance
	return nil
}

func (f *FakeRepo) AtomicAddFunds(_ context.Context, month string, amount float64) error {
	s, ok := f.Months[month]
	if !ok {
		return repository.ErrExpenseStateMismatch
	}
	// Missing mirror cancels the whole transaction (legacy-table defect).
	if _, ok := f.MonthList[month]; !ok {
		return errMonthListMirrorMissing
	}
	s.AllowanceAdded += amount
	s.EndingBalance += amount
	_ = f.applyMonthListDelta(month, 0, amount, amount, 0)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance += amount
	return nil
}

func (f *FakeRepo) AtomicDeleteMonth(_ context.Context, month string, allowanceAdded float64) error {
	s, ok := f.Months[month]
	if !ok {
		return repository.ErrMonthHasExpenses
	}
	if s.TotalExpenses != 0 {
		return repository.ErrMonthHasExpenses
	}
	delete(f.Months, month)
	delete(f.MonthList, month)
	if f.Balance == nil {
		f.Balance = &model.Balance{}
	}
	f.Balance.TotalBalance -= allowanceAdded
	return nil
}

// =====================================================================
// Sessions
// =====================================================================

func (f *FakeRepo) CreateSession(_ context.Context, token string, _ int) error {
	f.Sessions[token] = &model.Session{Token: token}
	return nil
}

func (f *FakeRepo) GetSession(_ context.Context, token string) (*model.Session, error) {
	s, ok := f.Sessions[token]
	if !ok {
		return nil, nil
	}
	out := *s
	return &out, nil
}

func (f *FakeRepo) DeleteSession(_ context.Context, token string) error {
	delete(f.Sessions, token)
	return nil
}

func (f *FakeRepo) DeleteAllSessions(_ context.Context) error {
	f.Sessions = make(map[string]*model.Session)
	return nil
}

// =====================================================================
// Rate limiting (per-IP)
// =====================================================================

func (f *FakeRepo) GetRateLimitEntry(_ context.Context, sourceIP string) (*model.RateLimitEntry, error) {
	r, ok := f.RateLimits[sourceIP]
	if !ok {
		return nil, nil
	}
	out := *r
	return &out, nil
}

func (f *FakeRepo) IncrementFailedAttempts(_ context.Context, sourceIP string, maxAttempts int) (*model.RateLimitEntry, error) {
	r, ok := f.RateLimits[sourceIP]
	if ok && r.Attempts >= maxAttempts {
		// Mirrors the real conditional increment failing at the cap (B6).
		return nil, repository.ErrRateLimitCapReached
	}
	if !ok {
		r = &model.RateLimitEntry{}
		f.RateLimits[sourceIP] = r
	}
	r.Attempts++
	// Set a window TTL on (re)increment, matching the real 15-minute window.
	r.TTL = time.Now().Add(15 * time.Minute).Unix()
	out := *r
	return &out, nil
}

func (f *FakeRepo) ClearRateLimit(_ context.Context, sourceIP string) error {
	delete(f.RateLimits, sourceIP)
	return nil
}

// =====================================================================
// WebAuthn
// =====================================================================

func (f *FakeRepo) PutWebAuthnChallenge(_ context.Context, challengeID, sessionData string, ttlSeconds int) error {
	now := time.Now()
	f.WAChallenges[challengeID] = &model.WebAuthnChallenge{
		PK:          repository.WebAuthnChallengePrefix + challengeID,
		SK:          repository.WebAuthnChallengePrefix + challengeID,
		SessionData: sessionData,
		CreatedAt:   now.Unix(),
		TTL:         now.Add(time.Duration(ttlSeconds) * time.Second).Unix(),
	}
	return nil
}

func (f *FakeRepo) GetWebAuthnChallenge(_ context.Context, challengeID string) (*model.WebAuthnChallenge, error) {
	c, ok := f.WAChallenges[challengeID]
	if !ok {
		return nil, nil
	}
	if c.TTL < time.Now().Unix() {
		return nil, nil
	}
	out := *c
	return &out, nil
}

func (f *FakeRepo) DeleteWebAuthnChallenge(_ context.Context, challengeID string) error {
	delete(f.WAChallenges, challengeID)
	return nil
}

func (f *FakeRepo) PutWebAuthnCredential(_ context.Context, cred *model.WebAuthnCredential) error {
	c := *cred
	c.PK = repository.WebAuthnCredentialPrefix + cred.CredentialID
	c.SK = c.PK
	if c.CreatedAt == 0 {
		c.CreatedAt = time.Now().Unix()
	}
	f.WACredentials[cred.CredentialID] = &c
	return nil
}

func (f *FakeRepo) GetWebAuthnCredential(_ context.Context, credentialID string) (*model.WebAuthnCredential, error) {
	c, ok := f.WACredentials[credentialID]
	if !ok {
		return nil, nil
	}
	out := *c
	return &out, nil
}

func (f *FakeRepo) ListWebAuthnCredentials(_ context.Context) ([]model.WebAuthnCredential, error) {
	out := make([]model.WebAuthnCredential, 0, len(f.WACredentials))
	for _, c := range f.WACredentials {
		out = append(out, *c)
	}
	// Stable order so tests are deterministic (mirrors the sorted Query).
	sort.Slice(out, func(i, j int) bool { return out[i].CredentialID < out[j].CredentialID })
	return out, nil
}

func (f *FakeRepo) DeleteAllWebAuthnCredentials(_ context.Context) error {
	f.WACredentials = make(map[string]*model.WebAuthnCredential)
	return nil
}
