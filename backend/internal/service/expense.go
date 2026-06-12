// Package service implements the core business logic for the Passbook
// application. The expense service manages monthly budgets, expense tracking,
// fund allocation, and balance calculations. It acts as the intermediary
// between HTTP handlers and the DynamoDB repository, enforcing validation
// rules (positive amounts, description length limits, sufficient funds) and
// coordinating multi-step operations such as updating an expense amount while
// adjusting both the month summary and the global balance atomically.
package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/google/uuid"
	"github.com/vppillai/passbook/backend/internal/model"
	"github.com/vppillai/passbook/backend/internal/repository"
)

var (
	ErrInvalidAmount      = errors.New("amount must be positive")
	ErrDescriptionTooLong = errors.New("description too long (max 100 characters)")
	ErrExpenseNotFound    = errors.New("expense not found")
	// ErrExpenseModified means the expense was found on read but changed
	// (or vanished) before the conditional write landed — a genuine
	// concurrent edit. Handler maps to 409 "refresh and retry", distinct
	// from the 404 ErrExpenseNotFound for an expense that never existed (U4).
	ErrExpenseModified   = errors.New("expense was modified")
	ErrInsufficientFunds = errors.New("insufficient funds")
	ErrNoChanges         = errors.New("no changes provided")
	ErrMonthExists       = errors.New("month already exists")
	ErrMonthNotFound     = errors.New("month not found")
	ErrInvalidMonth      = errors.New("invalid month format")
	ErrFundsNotPositive  = errors.New("funds amount must be positive")
	// ErrInvalidDate is returned when the optional expense date is not a
	// valid "YYYY-MM-DD" calendar date. Handler maps to 400.
	ErrInvalidDate = errors.New("invalid date format")
	// ErrFutureDate is returned when the optional expense date is in the
	// future (UTC; today is allowed). Handler maps to 400.
	ErrFutureDate = errors.New("date cannot be in the future")
	// ErrDateMonthMismatch is returned when both date and month are supplied
	// but the date's month does not match the month field. Handler maps to 400.
	ErrDateMonthMismatch = errors.New("date and month do not match")
	// ErrMonthHasExpenses is returned by DeleteMonth when the target month
	// still has expenses; handler maps to 409 (U2).
	ErrMonthHasExpenses = errors.New("month has expenses")
	// ErrInvalidCursor is returned when a paginated endpoint receives an
	// opaque cursor that decodes but doesn't refer to a valid resume
	// point (e.g. cursorMonth not found in the current month list).
	// Handler maps to 400. Replaces the previous strings.Contains check.
	ErrInvalidCursor = errors.New("invalid pagination cursor")
)

// InsufficientFundsError carries the amount that WAS available when an
// expense add/edit was refused under hard-stop, so the handler can tell the
// user what they have to work with instead of a bare "Insufficient funds"
// (U4). It wraps ErrInsufficientFunds so existing errors.Is checks still
// match.
type InsufficientFundsError struct {
	Available float64
}

func (e *InsufficientFundsError) Error() string { return ErrInsufficientFunds.Error() }
func (e *InsufficientFundsError) Unwrap() error { return ErrInsufficientFunds }

type ExpenseService struct {
	repo              repository.RepositoryInterface
	monthlyAllowance  float64
	allowOverspending bool
	carryOverBalance  bool
}

func NewExpenseService(repo repository.RepositoryInterface, monthlyAllowance float64, allowOverspending bool, carryOverBalance bool) *ExpenseService {
	return &ExpenseService{
		repo:              repo,
		monthlyAllowance:  monthlyAllowance,
		allowOverspending: allowOverspending,
		carryOverBalance:  carryOverBalance,
	}
}

// roundCents rounds a dollar amount to 2 decimal places. JSON inputs and
// month arithmetic arrive/happen in float64, and attributevalue marshals
// float64 at full precision — without rounding, a carried balance like
// -522.16 + 500 was written to DynamoDB as -22.159999999999968 (observed
// in prod). Repository deltas already go through %.2f; this closes the
// remaining absolute-value writes and the service-boundary inputs.
func roundCents(v float64) float64 {
	return math.Round(v*100) / 100
}

// GetCurrentMonth returns the current month key in YYYY-MM format. Uses
// UTC by construction so behavior is identical regardless of the host's
// local timezone (Lambda runs UTC, but tests and local runs may not).
func GetCurrentMonth() string {
	now := time.Now().UTC()
	return fmt.Sprintf("%04d-%02d", now.Year(), now.Month())
}

// ValidateMonth is the single source of truth for the "YYYY-MM" month-key
// rule, used by both the HTTP handlers and the service layer (previously
// the rule was implemented three ways: len()==7, inline time.Parse, and a
// handler-local helper). Returns ErrInvalidMonth on anything that doesn't
// parse as a real year-month.
func ValidateMonth(month string) error {
	if _, err := time.Parse("2006-01", month); err != nil {
		return ErrInvalidMonth
	}
	return nil
}

// GetPreviousMonth returns the previous month key. Input must be a validated
// "YYYY-MM" key; behavior on malformed input is undefined (currently returns
// a nonsense key such as "0000-12"). Callers are responsible for validating
// with validateMonthKey/resolveMonth first.
func GetPreviousMonth(month string) string {
	t, _ := time.Parse("2006-01", month)
	prev := t.AddDate(0, -1, 0)
	return fmt.Sprintf("%04d-%02d", prev.Year(), prev.Month())
}

// Cursor helpers for pagination

// encodeCursor serializes a DynamoDB LastEvaluatedKey into a URL-safe
// base64 string that can be returned to the client as an opaque pagination
// token. Only string-typed attribute values are preserved, which is
// sufficient for the PK/SK key schema used throughout this application.
func encodeCursor(key map[string]types.AttributeValue) (string, error) {
	simple := make(map[string]string)
	for k, v := range key {
		if sv, ok := v.(*types.AttributeValueMemberS); ok {
			simple[k] = sv.Value
		}
	}
	data, err := json.Marshal(simple)
	if err != nil {
		return "", err
	}
	return base64.URLEncoding.EncodeToString(data), nil
}

// decodeCursor is the inverse of encodeCursor. It takes a base64-encoded
// cursor string received from the client and reconstructs the DynamoDB
// ExclusiveStartKey map needed to resume a paginated query.
func decodeCursor(cursor string) (map[string]types.AttributeValue, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, err
	}
	var simple map[string]string
	if err := json.Unmarshal(data, &simple); err != nil {
		return nil, err
	}
	key := make(map[string]types.AttributeValue)
	for k, v := range simple {
		key[k] = &types.AttributeValueMemberS{Value: v}
	}
	return key, nil
}

// validateExpenseCursor checks that a decoded expense-pagination cursor is a
// well-formed ExclusiveStartKey for the GetExpenses query on `month`: exactly
// the keys PK and SK, PK equal to this month's partition, and SK beginning
// with the EXP# prefix. A fabricated or cross-month cursor returns
// ErrInvalidCursor (→ 400) instead of reaching DynamoDB and triggering a
// ValidationException → 500 (B5).
func validateExpenseCursor(cursor map[string]types.AttributeValue, month string) error {
	if len(cursor) != 2 {
		return ErrInvalidCursor
	}
	pkAV, pkOK := cursor["PK"].(*types.AttributeValueMemberS)
	skAV, skOK := cursor["SK"].(*types.AttributeValueMemberS)
	if !pkOK || !skOK {
		return ErrInvalidCursor
	}
	if pkAV.Value != repository.MonthPrefix+month {
		return ErrInvalidCursor
	}
	if !strings.HasPrefix(skAV.Value, repository.ExpensePrefix) {
		return ErrInvalidCursor
	}
	return nil
}

// GetMonthData retrieves the summary and a paginated list of expenses for
// the specified month. The limit parameter controls how many expenses are
// returned per page, and cursorStr is the opaque pagination token from a
// previous response's NextCursor field (pass empty string for the first
// page). If the month does not exist in the database, an empty summary with
// zero balances is returned rather than an error.
func (s *ExpenseService) GetMonthData(ctx context.Context, month string, limit int32, cursorStr string) (*model.MonthDataResponse, error) {
	// Get month summary (don't auto-create)
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	// If month doesn't exist, return empty summary
	if summary == nil {
		summary = &model.MonthSummary{
			Month:           month,
			StartingBalance: 0,
			AllowanceAdded:  0,
			TotalExpenses:   0,
			EndingBalance:   0,
		}
	}

	// Decode cursor if provided
	var cursor map[string]types.AttributeValue
	if cursorStr != "" {
		cursor, err = decodeCursor(cursorStr)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidCursor, err)
		}
		// Validate the decoded cursor shape so a bogus token yields a 400
		// (ErrInvalidCursor) rather than a DynamoDB ValidationException →
		// 500 (B5). A resume key for this query must be exactly {PK, SK}
		// where PK is this month's partition and SK is an EXP# row.
		if err := validateExpenseCursor(cursor, month); err != nil {
			return nil, err
		}
	}

	// Get expenses for the month with pagination
	expenses, lastKey, err := s.repo.GetExpenses(ctx, month, limit, cursor)
	if err != nil {
		return nil, err
	}

	// Convert to response format
	expenseItems := make([]model.ExpenseItem, len(expenses))
	for i, exp := range expenses {
		expenseItems[i] = model.ExpenseItem{
			ID:          exp.SK,
			Amount:      exp.Amount,
			Description: exp.Description,
			CreatedAt:   exp.CreatedAt,
		}
	}

	// Get total balance
	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}

	// Encode next cursor
	nextCursor := ""
	if lastKey != nil {
		nextCursor, err = encodeCursor(lastKey)
		if err != nil {
			return nil, err
		}
	}

	return &model.MonthDataResponse{
		Month:        month,
		Summary:      summary,
		Expenses:     expenseItems,
		TotalBalance: balance.TotalBalance,
		NextCursor:   nextCursor,
	}, nil
}

// ensureMonthExists gets or creates a month summary with $0 allowance (the
// monthly allowance is only applied by an explicit CreateMonth). When
// carry-over is enabled, the previous month's ending balance is carried
// forward as the starting balance; no global balance credit occurs here —
// carrying moves no money.
func (s *ExpenseService) ensureMonthExists(ctx context.Context, month string) (*model.MonthSummary, error) {
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}

	if summary != nil {
		return summary, nil
	}

	// Carry the previous month's ending balance, mirroring CreateMonth.
	// Without this, an expense filed into a not-yet-created month broke
	// the carry chain (start=0), and the next CreateMonth would carry
	// from this orphan's ending instead of the real history. No global
	// balance credit happens here — carrying moves no money.
	startingBalance := 0.0
	if s.carryOverBalance {
		prevSummary, err := s.repo.GetMonthSummary(ctx, GetPreviousMonth(month))
		if err != nil {
			return nil, err
		}
		if prevSummary != nil {
			startingBalance = roundCents(prevSummary.EndingBalance)
		}
	}

	// Create new month summary with $0 allowance using a conditional put
	// (attribute_not_exists). If a concurrent request created the month in
	// the gap between our Get and this write, we lose the race — re-read
	// and return the winner so we never clobber it (B2). The old
	// unconditional Put could overwrite a month another request just
	// created, permanently desyncing the month vs the global balance.
	summary = &model.MonthSummary{
		Month:           month,
		StartingBalance: startingBalance,
		AllowanceAdded:  0,
		TotalExpenses:   0,
		EndingBalance:   startingBalance,
	}

	if err := s.repo.CreateMonthSummaryIfAbsent(ctx, summary); err != nil {
		if errors.Is(err, repository.ErrMonthAlreadyExists) {
			winner, rerr := s.repo.GetMonthSummary(ctx, month)
			if rerr != nil {
				return nil, rerr
			}
			if winner != nil {
				return winner, nil
			}
			// Extremely unlikely (created then deleted); surface the
			// original conflict rather than a nil summary.
			return nil, err
		}
		return nil, err
	}

	return summary, nil
}

// fetchSummaryAndBalance reads the post-mutation month summary and the
// global balance concurrently. Before, these were two sequential round
// trips on the hot path of every mutation response; they're independent,
// so running them in parallel halves the post-write latency (C3).
func (s *ExpenseService) fetchSummaryAndBalance(ctx context.Context, month string) (*model.MonthSummary, *model.Balance, error) {
	var (
		summary    *model.MonthSummary
		balance    *model.Balance
		summaryErr error
		balanceErr error
		wg         sync.WaitGroup
	)
	wg.Add(2)
	go func() {
		defer wg.Done()
		summary, summaryErr = s.repo.GetMonthSummary(ctx, month)
	}()
	go func() {
		defer wg.Done()
		balance, balanceErr = s.repo.GetBalance(ctx)
	}()
	wg.Wait()
	if summaryErr != nil {
		return nil, nil, summaryErr
	}
	if balanceErr != nil {
		return nil, nil, balanceErr
	}
	return summary, balance, nil
}

// insufficientFunds builds the rich insufficient-funds error carrying the
// month's currently-available ending balance (U4). If the summary can't be
// read back, it degrades to the plain sentinel — the refusal is still
// correct, just without the available figure.
func (s *ExpenseService) insufficientFunds(ctx context.Context, month string) error {
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil || summary == nil {
		return ErrInsufficientFunds
	}
	return &InsufficientFundsError{Available: roundCents(summary.EndingBalance)}
}

// propagateToLaterMonths shifts every month strictly after `month` by
// endingDelta on both starting_balance and ending_balance. When carry-over
// is enabled, editing/deleting an expense in a PAST month must ripple
// through the carry chain — otherwise later months' starting balances stay
// permanently wrong (B3). When carry-over is off, later months start fresh
// from zero, so there is nothing to propagate.
//
// The later months are discovered from the canonical month rows
// (monthsAfter), which are complete regardless of MONTHLIST state — so on a
// table written before the mirror scheme (empty/partial MONTHLIST) this no
// longer silently no-ops and leaves later months' starting_balance wrong.
//
// Each later month is then shifted via a conditional DELTA update applied to
// both its canonical row and its mirror, all batched into ONE
// TransactWriteItems (PropagateLaterMonthDeltas). Deltas compose with any
// concurrent write to those months instead of clobbering it the way the
// previous unconditioned full-object Put of a stale snapshot did.
//
// Atomicity caveat: the propagation transaction is separate from the
// originating mutation's transaction (DynamoDB's 100-item cap rules out one
// mega-transaction). The propagation itself is all-or-nothing, but a crash
// after the mutation commits and before propagation lands would leave later
// months stale — see PropagateLaterMonthDeltas's residual-gap note.
func (s *ExpenseService) propagateToLaterMonths(ctx context.Context, month string, endingDelta float64) error {
	if !s.carryOverBalance || endingDelta == 0 {
		return nil
	}
	later, err := s.monthsAfter(ctx, month)
	if err != nil {
		return err
	}
	if len(later) == 0 {
		return nil
	}
	// Each later month's mirror must exist before the conditional delta
	// update runs (delta updates are not upserts). On a freshly backfilled
	// table the mirror exists; on a partially-backfilled one this closes
	// the gap. EnsureMonthListMirror is a no-op when the mirror is present.
	for _, m := range later {
		if err := s.repo.EnsureMonthListMirror(ctx, m); err != nil {
			return err
		}
	}
	return s.repo.PropagateLaterMonthDeltas(ctx, later, roundCents(endingDelta))
}

// monthsAfter returns the keys of every month strictly greater than `month`,
// ascending. It reads the CANONICAL month rows (ListAllMonthsLegacy — the
// full scan over MONTH#<m>/SUMMARY) rather than the MONTHLIST index.
//
// The index is the wrong source here: on a legacy table its partition is
// empty or partial, and reading it would silently miss later months, leaving
// their starting_balance permanently wrong (the HIGH defect this fix
// targets). It would also miss months whose mirror was just back-filled for
// THIS month but not yet for the later ones. The canonical rows are always
// complete regardless of mirror state, so propagation always sees the true
// set of later months. Propagation only fires when carry-over is on and a
// PAST month was mutated (a rare edit), and months are few (one row per
// calendar month), so the scan cost is negligible.
func (s *ExpenseService) monthsAfter(ctx context.Context, month string) ([]string, error) {
	canonical, err := s.repo.ListAllMonthsLegacy(ctx)
	if err != nil {
		return nil, err
	}
	var later []string
	for _, m := range canonical {
		if m.Month > month {
			later = append(later, m.Month)
		}
	}
	sort.Slice(later, func(i, j int) bool { return later[i] < later[j] })
	return later, nil
}

// AddExpense adds a new expense in a single DynamoDB transaction
// (expense Put + month summary + global balance + MONTHLIST mirror).
// Closes the non-atomic multi-write window that previously could leave the
// ledger corrupt if the Lambda timed out mid-flight.
//
// When req.Month is set, the expense is filed against that month
// (client knows its local timezone). Empty Month falls back to the
// server's UTC current month.
//
// When the instance forbids overspending, the transaction's condition
// expression atomically checks `ending_balance >= amount`, so two
// concurrent AddExpense calls cannot both succeed at $7 each on a $10
// balance.
//
// If the targeted month is not the latest, subsequent months' carried
// balances are walked forward to keep the ledger consistent (B3).
func (s *ExpenseService) AddExpense(ctx context.Context, req *model.AddExpenseRequest) (*model.AddExpenseResponse, error) {
	req.Amount = roundCents(req.Amount)
	if req.Amount <= 0 || req.Amount > 99999.99 {
		return nil, ErrInvalidAmount
	}
	if len(req.Description) > 100 {
		return nil, ErrDescriptionTooLong
	}
	req.Description = strings.TrimSpace(req.Description)
	if req.Description == "" {
		req.Description = "Expense"
	}

	// Resolve the target month and the expense timestamp together: an
	// optional req.Date back-dates the expense (deriving/validating the
	// month from it), otherwise we fall back to the legacy month resolution
	// with a now() timestamp.
	month, expenseTime, err := s.resolveMonthAndTime(req.Month, req.Date)
	if err != nil {
		return nil, err
	}

	// Ensure month summary exists. This non-atomic create-if-missing is
	// idempotent and rare (once per month); the atomic transaction below
	// then guarantees correctness of the actual expense write.
	if _, err := s.ensureMonthExists(ctx, month); err != nil {
		return nil, err
	}
	// Back-fill the MONTHLIST mirror on legacy tables before the atomic
	// transaction. ensureMonthExists only creates a mirror for months it
	// creates; a month that already exists canonically but predates the
	// mirror scheme has none, and AtomicAddExpense's monthListUpdate would
	// then cancel the whole transaction (→ 500).
	if err := s.repo.EnsureMonthListMirror(ctx, month); err != nil {
		return nil, err
	}

	expense := &model.Expense{
		SK:          fmt.Sprintf("%s%d#%s", repository.ExpensePrefix, expenseTime.UnixNano(), uuid.New().String()[:8]),
		Amount:      req.Amount,
		Description: req.Description,
		CreatedAt:   expenseTime,
	}

	if err := s.repo.AtomicAddExpense(ctx, month, expense, !s.allowOverspending); err != nil {
		if errors.Is(err, repository.ErrInsufficientBalance) {
			return nil, s.insufficientFunds(ctx, month)
		}
		return nil, err
	}

	// Adding an expense lowers this month's ending balance by the amount;
	// ripple that through later months' carry chain.
	if err := s.propagateToLaterMonths(ctx, month, -req.Amount); err != nil {
		return nil, err
	}

	// Read back the post-transaction state for an accurate response.
	updatedSummary, balance, err := s.fetchSummaryAndBalance(ctx, month)
	if err != nil {
		return nil, err
	}

	monthBalance := 0.0
	if updatedSummary != nil {
		monthBalance = updatedSummary.EndingBalance
	}

	return &model.AddExpenseResponse{
		Success:      true,
		Expense:      expense,
		MonthBalance: monthBalance,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// resolveMonth validates the optional client-supplied month parameter.
// Empty input falls back to the server's UTC current month (legacy
// behavior — preserved for callers that haven't been updated yet).
// Any non-empty value must parse as YYYY-MM; bad formats return
// ErrInvalidMonth so clients can fail loudly.
func resolveMonth(clientMonth string) (string, error) {
	if clientMonth == "" {
		return GetCurrentMonth(), nil
	}
	if err := ValidateMonth(clientMonth); err != nil {
		return "", err
	}
	return clientMonth, nil
}

// resolveMonthAndTime resolves the month an expense belongs to and the
// timestamp to stamp it with, from the optional client-supplied month and
// date.
//
//   - No date: legacy behavior — month from resolveMonth(clientMonth) and
//     timestamp = now.
//   - Date present: must be a valid "YYYY-MM-DD" (ErrInvalidDate) that is
//     not in the future in UTC, today allowed (ErrFutureDate). The month is
//     derived from the date and, if clientMonth is also supplied, must match
//     it (ErrDateMonthMismatch). The timestamp is the current time when the
//     date is today (so a same-day add sorts after earlier same-day adds),
//     else 12:00:00 UTC on that date.
func (s *ExpenseService) resolveMonthAndTime(clientMonth, clientDate string) (string, time.Time, error) {
	if clientDate == "" {
		month, err := resolveMonth(clientMonth)
		if err != nil {
			return "", time.Time{}, err
		}
		return month, time.Now(), nil
	}

	date, err := time.Parse("2006-01-02", clientDate)
	if err != nil {
		return "", time.Time{}, ErrInvalidDate
	}
	date = date.UTC()

	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if date.After(today) {
		return "", time.Time{}, ErrFutureDate
	}

	month := fmt.Sprintf("%04d-%02d", date.Year(), date.Month())
	if clientMonth != "" && clientMonth != month {
		return "", time.Time{}, ErrDateMonthMismatch
	}

	// Same calendar day → use the current time so same-day adds keep their
	// real ordering; a past day → noon UTC (a stable, mid-day timestamp).
	if date.Equal(today) {
		return month, time.Now(), nil
	}
	return month, time.Date(date.Year(), date.Month(), date.Day(), 12, 0, 0, 0, time.UTC), nil
}

// UpdateExpense updates an existing expense's amount, description, and/or
// date. Validation, read of current state, and the multi-row write are wrapped
// in a single DynamoDB transaction with conditions to detect concurrent edits
// (amount mismatch) and overspending. Returns ErrExpenseModified on a
// concurrent edit (409) and ErrExpenseNotFound on a stale/missing read (404).
//
// The optional date is validated exactly like the add path (resolveExpenseTime:
// valid YYYY-MM-DD, not in the future in UTC, today allowed). Because an
// expense's SK encodes its timestamp (EXP#<unixnano>#<id>), a date change to a
// new day re-keys the row:
//
//   - Same target month: delete the old SK + put a new SK (keeping the random
//     id suffix stable) in one transaction, composing any amount/description
//     change as summary/mirror/balance deltas (AtomicMoveExpenseSameMonth).
//   - Different target month: a full cross-month move that refunds the source
//     month and charges the destination, leaving BALANCE shifted only by the
//     amount diff (AtomicMoveExpenseAcrossMonths), then carry-propagates both
//     affected months when they're not the latest.
//
// When the date resolves to the same calendar day the row already sits on, the
// SK is unchanged and the edit collapses to the existing amount/description
// path so amount-only and description-only edits keep their established
// behavior.
func (s *ExpenseService) UpdateExpense(ctx context.Context, month string, expenseID string, req *model.UpdateExpenseRequest) (*model.UpdateExpenseResponse, error) {
	if req.Amount == nil && req.Description == nil && req.Date == "" {
		return nil, ErrNoChanges
	}
	if req.Amount != nil {
		rounded := roundCents(*req.Amount)
		req.Amount = &rounded
		if *req.Amount <= 0 || *req.Amount > 99999.99 {
			return nil, ErrInvalidAmount
		}
	}
	if req.Description != nil {
		trimmed := strings.TrimSpace(*req.Description)
		req.Description = &trimmed
		if len(*req.Description) > 100 {
			return nil, ErrDescriptionTooLong
		}
	}

	currentExpense, err := s.repo.GetExpense(ctx, month, expenseID)
	if err != nil {
		return nil, err
	}
	if currentExpense == nil {
		return nil, ErrExpenseNotFound
	}

	newAmount := currentExpense.Amount
	if req.Amount != nil {
		newAmount = *req.Amount
	}
	newDescription := currentExpense.Description
	if req.Description != nil {
		newDescription = *req.Description
	}
	if newDescription == "" {
		newDescription = "Expense"
	}

	// Resolve the (possibly new) timestamp and target month from the optional
	// date, using the same rule as the add path. An absent date keeps the
	// expense on its existing timestamp/month.
	newTime := currentExpense.CreatedAt
	targetMonth := month
	if req.Date != "" {
		resolvedMonth, resolvedTime, derr := s.resolveExpenseTime(req.Date)
		if derr != nil {
			return nil, derr
		}
		targetMonth = resolvedMonth
		// Only re-stamp when the date lands on a different calendar day than
		// the row currently carries; re-dating to the same day is a no-op for
		// the timestamp (and avoids a needless SK churn for an unchanged day).
		cur := currentExpense.CreatedAt.UTC()
		if !(cur.Year() == resolvedTime.Year() && cur.YearDay() == resolvedTime.YearDay()) {
			newTime = resolvedTime
		}
	}

	dateChanged := !newTime.Equal(currentExpense.CreatedAt)
	monthChanged := targetMonth != month

	switch {
	case monthChanged:
		// Cross-month move: a full transaction that refunds the source month,
		// charges the destination, and re-keys the expense (new SK encodes the
		// new timestamp; keep the random id suffix stable).
		newExpense, rerr := s.redatedExpense(currentExpense, newTime, newAmount, newDescription)
		if rerr != nil {
			return nil, rerr
		}
		// Ensure BOTH months exist + carry their MONTHLIST mirror before the
		// atomic transaction (delta updates are not upserts).
		if _, err := s.ensureMonthExists(ctx, month); err != nil {
			return nil, err
		}
		if err := s.repo.EnsureMonthListMirror(ctx, month); err != nil {
			return nil, err
		}
		if _, err := s.ensureMonthExists(ctx, targetMonth); err != nil {
			return nil, err
		}
		if err := s.repo.EnsureMonthListMirror(ctx, targetMonth); err != nil {
			return nil, err
		}
		if err := s.repo.AtomicMoveExpenseAcrossMonths(ctx, month, targetMonth, expenseID, newExpense, currentExpense.Amount, !s.allowOverspending); err != nil {
			switch {
			case errors.Is(err, repository.ErrInsufficientBalance):
				return nil, s.insufficientFunds(ctx, targetMonth)
			case errors.Is(err, repository.ErrExpenseStateMismatch):
				return nil, ErrExpenseModified
			default:
				return nil, err
			}
		}
		// The source month's ending balance rose by oldAmount (refund); the
		// destination's fell by newAmount. Ripple each through its own carry
		// chain when it isn't the latest month.
		if err := s.propagateToLaterMonths(ctx, month, currentExpense.Amount); err != nil {
			return nil, err
		}
		if err := s.propagateToLaterMonths(ctx, targetMonth, -newAmount); err != nil {
			return nil, err
		}
		return s.updateExpenseResponse(ctx, targetMonth, newExpense.SK, newAmount, newDescription, newTime)

	case dateChanged:
		// Same-month re-date: the SK changes (it encodes the timestamp), so
		// delete the old SK + put the new SK, composing any amount/description
		// change in the same transaction.
		newExpense, rerr := s.redatedExpense(currentExpense, newTime, newAmount, newDescription)
		if rerr != nil {
			return nil, rerr
		}
		if err := s.repo.EnsureMonthListMirror(ctx, month); err != nil {
			return nil, err
		}
		if err := s.repo.AtomicMoveExpenseSameMonth(ctx, month, expenseID, newExpense, currentExpense.Amount, !s.allowOverspending); err != nil {
			switch {
			case errors.Is(err, repository.ErrInsufficientBalance):
				return nil, s.insufficientFunds(ctx, month)
			case errors.Is(err, repository.ErrExpenseStateMismatch):
				return nil, ErrExpenseModified
			default:
				return nil, err
			}
		}
		amountDelta := newAmount - currentExpense.Amount
		if err := s.propagateToLaterMonths(ctx, month, -amountDelta); err != nil {
			return nil, err
		}
		return s.updateExpenseResponse(ctx, month, newExpense.SK, newAmount, newDescription, newTime)

	default:
		// No date change (or same-day re-date): the SK is stable, so this is
		// the established amount/description path.
		amountDelta := newAmount - currentExpense.Amount
		if amountDelta != 0 {
			// Back-fill the MONTHLIST mirror on legacy tables so the atomic
			// transaction's monthListUpdate condition can't cancel it (→ 500).
			if err := s.repo.EnsureMonthListMirror(ctx, month); err != nil {
				return nil, err
			}
			// Atomic transaction with optimistic concurrency on amount.
			if err := s.repo.AtomicUpdateExpense(ctx, month, expenseID, currentExpense.Amount, newAmount, newDescription, !s.allowOverspending); err != nil {
				switch {
				case errors.Is(err, repository.ErrInsufficientBalance):
					return nil, s.insufficientFunds(ctx, month)
				case errors.Is(err, repository.ErrExpenseStateMismatch):
					// We read the expense moments ago, so this is a genuine
					// concurrent edit, not a missing row → 409 refresh (U4).
					return nil, ErrExpenseModified
				default:
					return nil, err
				}
			}
			// Changing the amount shifts this month's ending balance by
			// -amountDelta; ripple through later months' carry chain.
			if err := s.propagateToLaterMonths(ctx, month, -amountDelta); err != nil {
				return nil, err
			}
		} else {
			// Description-only update doesn't touch summary/balance — single write is fine.
			oldExpense, err := s.repo.UpdateExpense(ctx, month, expenseID, newAmount, newDescription)
			if err != nil {
				return nil, err
			}
			if oldExpense == nil {
				return nil, ErrExpenseNotFound
			}
		}
		return s.updateExpenseResponse(ctx, month, currentExpense.SK, newAmount, newDescription, newTime)
	}
}

// resolveExpenseTime validates a "YYYY-MM-DD" edit date and returns the month
// it belongs to and the timestamp to stamp the expense with, using the same
// rule as the add path: a past day → 12:00:00 UTC, today → the current time.
// Mirrors resolveMonthAndTime's date branch but for an edit (no Month field to
// cross-check, since the path month is authoritative and a divergence is a
// legitimate move).
func (s *ExpenseService) resolveExpenseTime(clientDate string) (string, time.Time, error) {
	date, err := time.Parse("2006-01-02", clientDate)
	if err != nil {
		return "", time.Time{}, ErrInvalidDate
	}
	date = date.UTC()

	now := time.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if date.After(today) {
		return "", time.Time{}, ErrFutureDate
	}

	targetMonth := fmt.Sprintf("%04d-%02d", date.Year(), date.Month())
	if date.Equal(today) {
		return targetMonth, time.Now(), nil
	}
	return targetMonth, time.Date(date.Year(), date.Month(), date.Day(), 12, 0, 0, 0, time.UTC), nil
}

// redatedExpense builds the replacement expense row for a re-date: a new SK
// stamped with newTime but reusing the SAME random id suffix as the old SK so
// the expense keeps a stable identity across the move. Falls back to a fresh
// suffix only if the old SK is malformed (no embedded suffix).
func (s *ExpenseService) redatedExpense(old *model.Expense, newTime time.Time, newAmount float64, newDescription string) (*model.Expense, error) {
	suffix := expenseIDSuffix(old.SK)
	return &model.Expense{
		SK:          fmt.Sprintf("%s%d#%s", repository.ExpensePrefix, newTime.UnixNano(), suffix),
		Amount:      newAmount,
		Description: newDescription,
		CreatedAt:   newTime,
	}, nil
}

// expenseIDSuffix extracts the trailing random id from an
// "EXP#<unixnano>#<id>" SK so a re-date can preserve it. Returns a fresh
// 8-char uuid component if the SK doesn't carry one (defensive — every SK this
// app writes has the suffix).
func expenseIDSuffix(sk string) string {
	trimmed := strings.TrimPrefix(sk, repository.ExpensePrefix)
	if i := strings.IndexByte(trimmed, '#'); i >= 0 && i+1 < len(trimmed) {
		return trimmed[i+1:]
	}
	return uuid.New().String()[:8]
}

// updateExpenseResponse reads back the (target) month summary + global balance
// and assembles the UpdateExpenseResponse. The returned ExpenseItem carries
// the possibly-new id (SK) and the target month so the client can detect a
// cross-month move.
func (s *ExpenseService) updateExpenseResponse(ctx context.Context, month, sk string, amount float64, description string, createdAt time.Time) (*model.UpdateExpenseResponse, error) {
	updatedSummary, balance, err := s.fetchSummaryAndBalance(ctx, month)
	if err != nil {
		return nil, err
	}
	monthBalance := 0.0
	if updatedSummary != nil {
		monthBalance = updatedSummary.EndingBalance
	}
	return &model.UpdateExpenseResponse{
		Success: true,
		Expense: &model.ExpenseItem{
			ID:          sk,
			Amount:      amount,
			Description: description,
			CreatedAt:   createdAt,
			Month:       month,
		},
		MonthBalance: monthBalance,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// DeleteExpense deletes an expense and refunds the balance in a single
// transaction. The expense's amount is read first so the refund delta is
// known; the transaction conditions the delete on that amount to catch
// any concurrent edit that landed in between.
func (s *ExpenseService) DeleteExpense(ctx context.Context, month string, expenseID string) error {
	currentExpense, err := s.repo.GetExpense(ctx, month, expenseID)
	if err != nil {
		return err
	}
	if currentExpense == nil {
		return ErrExpenseNotFound
	}

	// Back-fill the MONTHLIST mirror on legacy tables so the atomic
	// transaction's monthListUpdate condition can't cancel it (→ 500).
	if err := s.repo.EnsureMonthListMirror(ctx, month); err != nil {
		return err
	}

	if err := s.repo.AtomicDeleteExpense(ctx, month, expenseID, currentExpense.Amount); err != nil {
		if errors.Is(err, repository.ErrExpenseStateMismatch) {
			// Found on read, changed before the conditional delete → 409 (U4).
			return ErrExpenseModified
		}
		return err
	}

	// Deleting refunds this month's ending balance by the amount; ripple
	// that through later months' carry chain.
	if err := s.propagateToLaterMonths(ctx, month, currentExpense.Amount); err != nil {
		return err
	}
	return nil
}

// GetBalance returns the total balance
func (s *ExpenseService) GetBalance(ctx context.Context) (*model.BalanceResponse, error) {
	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}
	return &model.BalanceResponse{
		TotalBalance: balance.TotalBalance,
	}, nil
}

// ListMonths returns a paginated list of months sorted in descending order
// (most recent first). It is served by a single DynamoDB Query against the
// MONTHLIST index partition — natively sorted and paginated — instead of the
// old full-table Scan whose cost grew with every expense ever written.
//
// cursorMonth is the decoded month value (e.g. "2026-01") from a previous
// response's NextCursor; pass empty for the first page. A non-empty cursor
// that doesn't correspond to a real month returns ErrInvalidCursor (the
// handler maps that to 400) rather than silently restarting pagination.
//
// Lazy migration: on a table written before the MONTHLIST index existed the
// query returns nothing. In that case (and only on the first page) we fall
// back to the legacy full-table scan AND backfill the MONTHLIST copies, so
// the scan runs at most once per table.
func (s *ExpenseService) ListMonths(ctx context.Context, limit int, cursorMonth string) (*model.MonthsResponse, error) {
	var cursor map[string]types.AttributeValue
	if cursorMonth != "" {
		// Validate the cursor points at a real month. A point read is O(1)
		// and preserves the "fabricated cursor → 400" contract without a scan.
		summary, err := s.repo.GetMonthSummary(ctx, cursorMonth)
		if err != nil {
			return nil, err
		}
		if summary == nil {
			return nil, ErrInvalidCursor
		}
		cursor = map[string]types.AttributeValue{
			"PK": &types.AttributeValueMemberS{Value: repository.PKMonthList},
			"SK": &types.AttributeValueMemberS{Value: cursorMonth},
		}
	}

	months, lastKey, err := s.repo.ListMonths(ctx, int32(limit), cursor)
	if err != nil {
		return nil, err
	}

	// Lazy migration: empty MONTHLIST on the first page → fall back to the
	// legacy scan, backfill the index, and re-query so this page is correct.
	if len(months) == 0 && cursorMonth == "" {
		legacy, err := s.repo.ListAllMonthsLegacy(ctx)
		if err != nil {
			return nil, err
		}
		if len(legacy) > 0 {
			if err := s.repo.BackfillMonthList(ctx, legacy); err != nil {
				return nil, err
			}
			months, lastKey, err = s.repo.ListMonths(ctx, int32(limit), nil)
			if err != nil {
				return nil, err
			}
		}
	}

	items := make([]model.MonthListItem, len(months))
	for i, m := range months {
		// MonthlySaved is the user-visible "delta this month" — what the
		// month contributed above (or below) its starting balance. Using
		// EndingBalance - StartingBalance is the carry-over-consistent
		// answer; roundCents keeps float dust out of the JSON (B4).
		items[i] = model.MonthListItem{
			Month:        m.Month,
			MonthlySaved: roundCents(m.EndingBalance - m.StartingBalance),
		}
	}

	// Next cursor: base64 of the last month's key, matching the legacy
	// cursor format the handler decodes.
	nextCursor := ""
	if lastKey != nil {
		if sk, ok := lastKey["SK"].(*types.AttributeValueMemberS); ok {
			nextCursor = base64.URLEncoding.EncodeToString([]byte(sk.Value))
		}
	}

	return &model.MonthsResponse{
		Months:     items,
		NextCursor: nextCursor,
	}, nil
}

// CreateMonth creates a new month with the configured monthly allowance.
// The month summary write and the balance credit are wrapped in a single
// DynamoDB transaction; an attribute_not_exists condition on the put
// prevents two concurrent creates from both succeeding.
//
// Idempotent allowance activation (U1): if the month already exists but
// carries a $0 allowance — the state produced when an expense is filed
// into a not-yet-created month, auto-creating it via ensureMonthExists —
// CreateMonth applies the allowance via an AddFunds-style transaction
// instead of returning 409. This closes the "allowance trap" where that
// month's allowance was silently never granted. A month that already has
// a non-zero allowance still returns ErrMonthExists.
func (s *ExpenseService) CreateMonth(ctx context.Context, month string) (*model.CreateMonthResponse, error) {
	if err := ValidateMonth(month); err != nil {
		return nil, ErrInvalidMonth
	}

	existing, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		// Already activated with a real allowance — genuine duplicate.
		if existing.AllowanceAdded != 0 {
			return nil, ErrMonthExists
		}
		// Auto-created $0 month: top it up to the configured allowance.
		allowance := roundCents(s.monthlyAllowance)
		if allowance > 0 {
			// Back-fill the mirror on legacy tables before the atomic top-up.
			if err := s.repo.EnsureMonthListMirror(ctx, month); err != nil {
				return nil, err
			}
			if err := s.repo.AtomicAddFunds(ctx, month, allowance); err != nil {
				if errors.Is(err, repository.ErrExpenseStateMismatch) {
					return nil, ErrMonthNotFound
				}
				return nil, err
			}
		}
		updated, balance, err := s.fetchSummaryAndBalance(ctx, month)
		if err != nil {
			return nil, err
		}
		return &model.CreateMonthResponse{
			Success:      true,
			Summary:      updated,
			TotalBalance: balance.TotalBalance,
		}, nil
	}

	prevMonth := GetPreviousMonth(month)
	prevSummary, err := s.repo.GetMonthSummary(ctx, prevMonth)
	if err != nil {
		return nil, err
	}

	startingBalance := 0.0
	if s.carryOverBalance && prevSummary != nil {
		startingBalance = roundCents(prevSummary.EndingBalance)
	}
	allowance := s.monthlyAllowance
	summary := &model.MonthSummary{
		Month:           month,
		StartingBalance: startingBalance,
		AllowanceAdded:  allowance,
		TotalExpenses:   0,
		EndingBalance:   roundCents(startingBalance + allowance),
	}

	if err := s.repo.AtomicCreateMonth(ctx, summary, allowance); err != nil {
		if errors.Is(err, repository.ErrMonthAlreadyExists) {
			return nil, ErrMonthExists
		}
		return nil, err
	}

	balance, err := s.repo.GetBalance(ctx)
	if err != nil {
		return nil, err
	}
	return &model.CreateMonthResponse{
		Success:      true,
		Summary:      summary,
		TotalBalance: balance.TotalBalance,
	}, nil
}

// DeleteMonth removes a month and reverses its allowance credit (U2). The
// summary (and its MONTHLIST copy) are deleted and the global balance is
// debited by allowance_added in one transaction, conditioned on
// total_expenses == 0. A month that still has expenses returns
// ErrMonthHasExpenses (handler → 409); a missing month returns
// ErrMonthNotFound (handler → 404).
func (s *ExpenseService) DeleteMonth(ctx context.Context, month string) error {
	if err := ValidateMonth(month); err != nil {
		return ErrInvalidMonth
	}

	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return err
	}
	if summary == nil {
		return ErrMonthNotFound
	}
	if summary.TotalExpenses != 0 {
		return ErrMonthHasExpenses
	}

	if err := s.repo.AtomicDeleteMonth(ctx, month, summary.AllowanceAdded); err != nil {
		if errors.Is(err, repository.ErrMonthHasExpenses) {
			// Lost a race: an expense landed (or the month vanished)
			// between our pre-read and the conditional delete.
			return ErrMonthHasExpenses
		}
		return err
	}
	return nil
}

// AddFunds tops up an existing month's allowance and credits the global
// balance by the same amount in a single transaction.
func (s *ExpenseService) AddFunds(ctx context.Context, month string, amount float64) (*model.AddFundsResponse, error) {
	amount = roundCents(amount)
	if amount <= 0 {
		return nil, ErrFundsNotPositive
	}

	// Pre-check existence so the user gets a precise ErrMonthNotFound
	// instead of a generic state-mismatch from the transaction.
	summary, err := s.repo.GetMonthSummary(ctx, month)
	if err != nil {
		return nil, err
	}
	if summary == nil {
		return nil, ErrMonthNotFound
	}

	// Back-fill the MONTHLIST mirror on legacy tables so the atomic
	// transaction's monthListUpdate condition can't cancel it (→ 500).
	if err := s.repo.EnsureMonthListMirror(ctx, month); err != nil {
		return nil, err
	}

	if err := s.repo.AtomicAddFunds(ctx, month, amount); err != nil {
		if errors.Is(err, repository.ErrExpenseStateMismatch) {
			// Month vanished between our pre-check and the transaction.
			return nil, ErrMonthNotFound
		}
		return nil, err
	}

	updatedSummary, balance, err := s.fetchSummaryAndBalance(ctx, month)
	if err != nil {
		return nil, err
	}
	return &model.AddFundsResponse{
		Success:      true,
		Summary:      updatedSummary,
		TotalBalance: balance.TotalBalance,
	}, nil
}
