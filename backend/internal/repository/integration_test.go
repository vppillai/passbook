package repository

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/vppillai/passbook/backend/internal/model"
)

// Integration tests against a real DynamoDB (DynamoDB Local).
//
// WHY THESE EXIST
//
// internal/repository sat at ~6% coverage while holding every
// ConditionExpression and every TransactWriteItems in the app — the logic where
// being wrong corrupts the ledger. Everything above it is tested against
// testutil.FakeRepo, which is a MODEL of DynamoDB's semantics written by hand.
// A model and the real service can disagree and every unit test still passes.
//
// So these deliberately only cover what a fake cannot validate:
//
//   - that the ConditionExpressions actually say what we think (an overspend
//     guard that never fires would be invisible to a fake that implements the
//     same guard in Go)
//   - that a cancelled transaction writes NOTHING, rather than partially
//   - that txConditionFailedIndex correctly parses REAL cancellation reasons to
//     decide which item failed. This is error-shape parsing against an AWS
//     response, and it is exactly what no fake can exercise; a change in how the
//     SDK surfaces CancellationReasons would silently remap our error codes.
//   - that conditional increments and TTL behave as the rate limiter assumes
//
// They do NOT re-test business arithmetic. That belongs upstairs, against the
// fake, where it is fast.
//
// RUNNING
//
// Skipped automatically when DynamoDB Local is not reachable, so `go test ./...`
// stays green on a machine without it:
//
//	docker run -d -p 8000:8000 amazon/dynamodb-local \
//	  -jar DynamoDBLocal.jar -inMemory -sharedDb
//	go test ./internal/repository/
//
// Endpoint overridable with PASSBOOK_DDB_ENDPOINT.

const defaultLocalEndpoint = "http://localhost:8000"

func localEndpoint() string {
	if v := os.Getenv("PASSBOOK_DDB_ENDPOINT"); v != "" {
		return v
	}
	return defaultLocalEndpoint
}

// newIntegrationRepo returns a Repository backed by DynamoDB Local with a fresh,
// uniquely-named table, or skips the test when the service is not reachable.
//
// A table per test, not a shared one: these exercise conditional writes, and a
// shared table would make them order-dependent — the failure mode being that a
// test passes only when run after another.
func newIntegrationRepo(t *testing.T) (*Repository, context.Context) {
	t.Helper()
	ctx := context.Background()
	ep := localEndpoint()

	// Cheap reachability probe first: a failed dial is a skip, but a table
	// creation that fails for any OTHER reason must be a hard failure rather
	// than a silent skip, or a broken setup would look like a pass.
	host := ep
	for _, p := range []string{"http://", "https://"} {
		if len(host) > len(p) && host[:len(p)] == p {
			host = host[len(p):]
		}
	}
	conn, derr := net.DialTimeout("tcp", host, 750*time.Millisecond)
	if derr != nil {
		t.Skipf("DynamoDB Local not reachable at %s (%v) — see this file's header to run these", ep, derr)
	}
	_ = conn.Close()

	client := dynamodb.New(dynamodb.Options{
		Region:       "us-west-2",
		BaseEndpoint: aws.String(ep),
		Credentials:  credentials.NewStaticCredentialsProvider("fake", "fake", ""),
	})

	table := fmt.Sprintf("passbook-it-%d", time.Now().UnixNano())
	// Schema mirrors infrastructure/template.yaml: PK/SK strings, TTL on `ttl`.
	if _, err := client.CreateTable(ctx, &dynamodb.CreateTableInput{
		TableName:   aws.String(table),
		BillingMode: types.BillingModePayPerRequest,
		AttributeDefinitions: []types.AttributeDefinition{
			{AttributeName: aws.String("PK"), AttributeType: types.ScalarAttributeTypeS},
			{AttributeName: aws.String("SK"), AttributeType: types.ScalarAttributeTypeS},
		},
		KeySchema: []types.KeySchemaElement{
			{AttributeName: aws.String("PK"), KeyType: types.KeyTypeHash},
			{AttributeName: aws.String("SK"), KeyType: types.KeyTypeRange},
		},
	}); err != nil {
		t.Fatalf("CreateTable on %s: %v", ep, err)
	}
	t.Cleanup(func() {
		_, _ = client.DeleteTable(context.Background(), &dynamodb.DeleteTableInput{
			TableName: aws.String(table),
		})
	})

	return NewRepository(client, table), ctx
}

// seedMonth writes a month summary and its MONTHLIST mirror, the state a table
// written by the current code is in.
func seedMonth(t *testing.T, r *Repository, ctx context.Context, month string, start, allow, expenses, ending float64) {
	t.Helper()
	s := &model.MonthSummary{
		Month: month, StartingBalance: start, AllowanceAdded: allow,
		TotalExpenses: expenses, EndingBalance: ending,
	}
	if err := r.SaveMonthSummary(ctx, s); err != nil {
		t.Fatalf("SaveMonthSummary(%s): %v", month, err)
	}
	if err := r.EnsureMonthListMirror(ctx, month); err != nil {
		t.Fatalf("EnsureMonthListMirror(%s): %v", month, err)
	}
}

func mustSummary(t *testing.T, r *Repository, ctx context.Context, month string) *model.MonthSummary {
	t.Helper()
	s, err := r.GetMonthSummary(ctx, month)
	if err != nil {
		t.Fatalf("GetMonthSummary(%s): %v", month, err)
	}
	if s == nil {
		t.Fatalf("month %s missing", month)
	}
	return s
}

// =====================================================================
// The overspend ConditionExpression
// =====================================================================

// The hard stop is `ending_balance >= :amount` inside a transaction. A fake that
// implements the same comparison in Go proves the SERVICE reads its result
// correctly; only the real service proves the expression fires at all.
func TestIntegration_AtomicAddExpense_OverspendConditionActuallyFires(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-01", 0, 100, 0, 100)

	exp := &model.Expense{
		SK: ExpensePrefix + "1700000000000#over", Amount: 250,
		Description: "too much", CreatedAt: time.Now(),
	}
	err := r.AtomicAddExpense(ctx, "2026-01", exp, true)
	if !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("err = %v, want ErrInsufficientBalance", err)
	}

	// And nothing landed: a transaction is all-or-nothing, so the refused
	// expense must not exist and the summary must be untouched.
	s := mustSummary(t, r, ctx, "2026-01")
	if s.TotalExpenses != 0 || s.EndingBalance != 100 {
		t.Errorf("summary moved despite refusal: expenses=%v ending=%v", s.TotalExpenses, s.EndingBalance)
	}
	items, _, err := r.GetExpenses(ctx, "2026-01", 10, nil)
	if err != nil {
		t.Fatalf("GetExpenses: %v", err)
	}
	if len(items) != 0 {
		t.Errorf("%d expense rows written by a cancelled transaction", len(items))
	}
}

func TestIntegration_AtomicAddExpense_AllowedWhenAffordable(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-01", 0, 100, 0, 100)

	exp := &model.Expense{
		SK: ExpensePrefix + "1700000000000#ok", Amount: 40,
		Description: "book", CreatedAt: time.Now(),
	}
	if err := r.AtomicAddExpense(ctx, "2026-01", exp, true); err != nil {
		t.Fatalf("AtomicAddExpense: %v", err)
	}
	s := mustSummary(t, r, ctx, "2026-01")
	if s.TotalExpenses != 40 || s.EndingBalance != 60 {
		t.Errorf("expenses=%v ending=%v, want 40 / 60", s.TotalExpenses, s.EndingBalance)
	}
	// The mirror must have moved in the same transaction.
	if err := r.EnsureMonthListMirror(ctx, "2026-01"); err != nil {
		t.Fatalf("EnsureMonthListMirror: %v", err)
	}
	months, _, err := r.ListMonths(ctx, 10, nil)
	if err != nil {
		t.Fatalf("ListMonths: %v", err)
	}
	if len(months) != 1 || months[0].TotalExpenses != 40 {
		t.Errorf("mirror not updated in the transaction: %+v", months)
	}
}

// With the check disabled (allow_overspending instances) the same write must go
// through and take the balance negative.
func TestIntegration_AtomicAddExpense_NoCheckPermitsNegative(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-01", 0, 100, 0, 100)

	exp := &model.Expense{
		SK: ExpensePrefix + "1700000000000#neg", Amount: 250,
		Description: "over", CreatedAt: time.Now(),
	}
	if err := r.AtomicAddExpense(ctx, "2026-01", exp, false); err != nil {
		t.Fatalf("AtomicAddExpense with checkBalance=false: %v", err)
	}
	if s := mustSummary(t, r, ctx, "2026-01"); s.EndingBalance != -150 {
		t.Errorf("ending = %v, want -150", s.EndingBalance)
	}
}

// =====================================================================
// AtomicDeleteMonth's allowance guard — added in v2.8.0, until now verified
// only against the fake's reimplementation of it
// =====================================================================

func TestIntegration_AtomicDeleteMonth_RefusesWhenAllowanceMoved(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	const month = "2026-03"
	// One month, total_expenses 0 throughout, stored allowance 150. The two
	// calls below differ in NOTHING except the allowance figure passed, so a
	// refusal can only be attributable to that clause.
	//
	// Asserting both halves matters: a test that only checks the refusal passes
	// just as happily when the delete is refused for some unrelated reason, or
	// when the guard is removed and something else refuses it. Proving the
	// matching call SUCCEEDS is what pins the guard specifically.
	seedMonth(t, r, ctx, month, 0, 150, 0, 150)

	// Stale figure — a top-up landed between the caller's pre-read and here.
	if err := r.AtomicDeleteMonth(ctx, month, 100); !errors.Is(err, ErrMonthHasExpenses) {
		t.Fatalf("stale allowance: err = %v, want ErrMonthHasExpenses", err)
	}
	if s, _ := r.GetMonthSummary(ctx, month); s == nil {
		t.Fatal("the month was deleted despite a stale allowance figure — the " +
			"balance debit would have been wrong by the difference, permanently")
	}

	// Same call, correct figure: must go through, or the refusal above proved
	// nothing about the allowance clause.
	if err := r.AtomicDeleteMonth(ctx, month, 150); err != nil {
		t.Fatalf("matching allowance was refused: %v", err)
	}
	if s, _ := r.GetMonthSummary(ctx, month); s != nil {
		t.Error("month survived a delete with the correct allowance")
	}
}

func TestIntegration_AtomicDeleteMonth_RefusesWhenExpensesRemain(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-03", 0, 100, 25, 75)

	if err := r.AtomicDeleteMonth(ctx, "2026-03", 100); !errors.Is(err, ErrMonthHasExpenses) {
		t.Fatalf("err = %v, want ErrMonthHasExpenses", err)
	}
	if s, _ := r.GetMonthSummary(ctx, "2026-03"); s == nil {
		t.Error("a month with expenses was deleted")
	}
}

func TestIntegration_AtomicDeleteMonth_SucceedsAndDebitsTheBalance(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-03", 0, 100, 0, 100)

	if err := r.AtomicDeleteMonth(ctx, "2026-03", 100); err != nil {
		t.Fatalf("AtomicDeleteMonth: %v", err)
	}
	if s, _ := r.GetMonthSummary(ctx, "2026-03"); s != nil {
		t.Error("month still present after a successful delete")
	}
	// The mirror must go in the same transaction, or the month becomes a
	// phantom in the history menu.
	months, _, err := r.ListMonths(ctx, 10, nil)
	if err != nil {
		t.Fatalf("ListMonths: %v", err)
	}
	for _, m := range months {
		if m.Month == "2026-03" {
			t.Error("MONTHLIST mirror survived the delete — an orphan")
		}
	}
}

// =====================================================================
// The cross-month move threshold — srcRefundReachesDst, also only ever
// checked against the fake's copy of the arithmetic
// =====================================================================

// Moving an expense FORWARD unchanged cannot alter any balance, because the
// source's refund lands in the destination. The condition must be measured
// against the NET charge or this is refused for insufficient funds.
func TestIntegration_MoveAcrossMonths_RefundOffsetsTheCharge(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-01", 0, 100, 100, 0)
	seedMonth(t, r, ctx, "2026-02", 0, 0, 0, 0)

	oldSK := ExpensePrefix + "1700000000000#move"
	seed := &model.Expense{SK: oldSK, Amount: 100, Description: "trip", CreatedAt: time.Now()}
	if err := r.AtomicAddExpense(ctx, "2026-01", seed, false); err != nil {
		t.Fatalf("seeding the expense: %v", err)
	}
	// AtomicAddExpense moved the summary; put it back to the intended state.
	seedMonth(t, r, ctx, "2026-01", 0, 100, 100, 0)

	newExp := &model.Expense{
		SK: ExpensePrefix + "1700000001000#move", Amount: 100,
		Description: "trip", CreatedAt: time.Now(),
	}
	// checkBalance=true, and the destination's own ending balance is 0 — so
	// without the refund offset this must fail.
	if err := r.AtomicMoveExpenseAcrossMonths(ctx, "2026-01", "2026-02", oldSK, newExp, 100, true, true); err != nil {
		t.Fatalf("move refused although the refund covers it: %v", err)
	}
	if s := mustSummary(t, r, ctx, "2026-02"); s.TotalExpenses != 100 {
		t.Errorf("destination expenses = %v, want 100", s.TotalExpenses)
	}
	if s := mustSummary(t, r, ctx, "2026-01"); s.TotalExpenses != 0 {
		t.Errorf("source expenses = %v, want 0 after the refund", s.TotalExpenses)
	}
}

// Without the offset flag the destination is judged on its own balance, which is
// correct when the refund does NOT reach it (a move to an earlier month).
func TestIntegration_MoveAcrossMonths_NoOffsetStillGuardsTheDestination(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-01", 0, 100, 100, 0)
	seedMonth(t, r, ctx, "2026-02", 0, 0, 0, 0)

	oldSK := ExpensePrefix + "1700000000000#move2"
	seed := &model.Expense{SK: oldSK, Amount: 100, Description: "trip", CreatedAt: time.Now()}
	if err := r.AtomicAddExpense(ctx, "2026-01", seed, false); err != nil {
		t.Fatalf("seeding: %v", err)
	}
	seedMonth(t, r, ctx, "2026-01", 0, 100, 100, 0)

	newExp := &model.Expense{
		SK: ExpensePrefix + "1700000001000#move2", Amount: 100,
		Description: "trip", CreatedAt: time.Now(),
	}
	err := r.AtomicMoveExpenseAcrossMonths(ctx, "2026-01", "2026-02", oldSK, newExp, 100, true, false)
	if !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("err = %v, want ErrInsufficientBalance when no refund reaches the destination", err)
	}
}

// A stale oldAmount means someone edited the expense underneath us. That
// condition sits on a DIFFERENT transaction item than the balance check, and
// txConditionFailedIndex has to tell them apart from the real cancellation
// reasons — the one thing a fake fundamentally cannot verify.
func TestIntegration_MoveAcrossMonths_StaleAmountIsDistinguishedFromOverspend(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-01", 0, 500, 0, 500)
	seedMonth(t, r, ctx, "2026-02", 0, 500, 0, 500)

	oldSK := ExpensePrefix + "1700000000000#stale"
	seed := &model.Expense{SK: oldSK, Amount: 30, Description: "book", CreatedAt: time.Now()}
	if err := r.AtomicAddExpense(ctx, "2026-01", seed, false); err != nil {
		t.Fatalf("seeding: %v", err)
	}

	newExp := &model.Expense{
		SK: ExpensePrefix + "1700000001000#stale", Amount: 30,
		Description: "book", CreatedAt: time.Now(),
	}
	// Claim the old amount was 99 when it is really 30. Both months can easily
	// afford everything, so a balance failure cannot be the cause — the error
	// must be the expense-state one.
	err := r.AtomicMoveExpenseAcrossMonths(ctx, "2026-01", "2026-02", oldSK, newExp, 99, true, false)
	if !errors.Is(err, ErrExpenseStateMismatch) {
		t.Fatalf("err = %v, want ErrExpenseStateMismatch — the cancellation-reason "+
			"parsing must distinguish the delete condition from the balance one", err)
	}
}

// =====================================================================
// Conditional creates
// =====================================================================

func TestIntegration_CreateMonthSummaryIfAbsent_SecondCallLoses(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	s := &model.MonthSummary{Month: "2026-05", StartingBalance: 10, AllowanceAdded: 20, EndingBalance: 30}

	if err := r.CreateMonthSummaryIfAbsent(ctx, s); err != nil {
		t.Fatalf("first create: %v", err)
	}
	other := &model.MonthSummary{Month: "2026-05", StartingBalance: 999, AllowanceAdded: 999, EndingBalance: 999}
	if err := r.CreateMonthSummaryIfAbsent(ctx, other); !errors.Is(err, ErrMonthAlreadyExists) {
		t.Fatalf("second create err = %v, want ErrMonthAlreadyExists", err)
	}
	// The winner's values must survive: this guard exists so a concurrent
	// create cannot clobber a month and desync it from the global balance.
	if got := mustSummary(t, r, ctx, "2026-05"); got.StartingBalance != 10 {
		t.Errorf("starting = %v, want 10 — the loser overwrote the winner", got.StartingBalance)
	}
}

func TestIntegration_CreateConfig_IsExclusive(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	if err := r.CreateConfig(ctx, &model.Config{PinHash: "first", CreatedAt: time.Now()}); err != nil {
		t.Fatalf("first CreateConfig: %v", err)
	}
	err := r.CreateConfig(ctx, &model.Config{PinHash: "second", CreatedAt: time.Now()})
	if !errors.Is(err, ErrConfigAlreadyExists) {
		t.Fatalf("err = %v, want ErrConfigAlreadyExists", err)
	}
	// This is the first-deploy takeover guard: the PIN slot must not be
	// claimable twice.
	c, err := r.GetConfig(ctx)
	if err != nil {
		t.Fatalf("GetConfig: %v", err)
	}
	if c.PinHash != "first" {
		t.Errorf("PinHash = %q, want \"first\"", c.PinHash)
	}
}

func TestIntegration_EnsureMonthListMirror_IsIdempotent(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	seedMonth(t, r, ctx, "2026-06", 0, 50, 10, 40)

	// Already mirrored by seedMonth; a second call must be a no-op rather than
	// overwriting with a snapshot, which is the hazard documented on
	// PropagateLaterMonthDeltas.
	if err := r.EnsureMonthListMirror(ctx, "2026-06"); err != nil {
		t.Fatalf("second EnsureMonthListMirror: %v", err)
	}
	months, _, err := r.ListMonths(ctx, 10, nil)
	if err != nil {
		t.Fatalf("ListMonths: %v", err)
	}
	if len(months) != 1 {
		t.Fatalf("mirrors = %d, want 1", len(months))
	}
	if months[0].TotalExpenses != 10 {
		t.Errorf("mirror expenses = %v, want 10", months[0].TotalExpenses)
	}
}

// =====================================================================
// The rate limiter's conditional increment and TTL
// =====================================================================

// The cap is enforced by `attempts < :max` on the update itself, so a caller can
// refuse atomically without burning Argon2 cycles.
func TestIntegration_IncrementFailedAttempts_StopsAtTheCap(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	const ip = "203.0.113.9"
	const max = 5

	for i := 1; i <= max; i++ {
		e, err := r.IncrementFailedAttempts(ctx, ip, max)
		if err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
		if e.Attempts != i {
			t.Fatalf("attempt %d recorded %d", i, e.Attempts)
		}
	}
	if _, err := r.IncrementFailedAttempts(ctx, ip, max); !errors.Is(err, ErrRateLimitCapReached) {
		t.Fatalf("past the cap err = %v, want ErrRateLimitCapReached", err)
	}
	e, err := r.GetRateLimitEntry(ctx, ip)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	if e.Attempts != max {
		t.Errorf("attempts = %d, want pinned at %d", e.Attempts, max)
	}
}

// The window must not be extendable by continuing to hammer it, or an attacker
// could hold the PIN path shut indefinitely. Because the increment is
// conditional, a refused write cannot refresh the TTL.
func TestIntegration_IncrementFailedAttempts_CapDoesNotExtendTheWindow(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	const ip = "198.51.100.4"
	const max = 3

	for i := 0; i < max; i++ {
		if _, err := r.IncrementFailedAttempts(ctx, ip, max); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	atCap, err := r.GetRateLimitEntry(ctx, ip)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	ttlAtCap := atCap.TTL

	for i := 0; i < 3; i++ {
		if _, err := r.IncrementFailedAttempts(ctx, ip, max); !errors.Is(err, ErrRateLimitCapReached) {
			t.Fatalf("post-cap attempt %d err = %v, want ErrRateLimitCapReached", i, err)
		}
	}
	after, err := r.GetRateLimitEntry(ctx, ip)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	if after.TTL != ttlAtCap {
		t.Errorf("TTL moved %d -> %d: a sustained attack is extending the lockout, "+
			"so the outage would never end", ttlAtCap, after.TTL)
	}
}

func TestIntegration_ClearRateLimit_RemovesTheRow(t *testing.T) {
	r, ctx := newIntegrationRepo(t)
	const ip = "192.0.2.5"
	if _, err := r.IncrementFailedAttempts(ctx, ip, 5); err != nil {
		t.Fatalf("IncrementFailedAttempts: %v", err)
	}
	if err := r.ClearRateLimit(ctx, ip); err != nil {
		t.Fatalf("ClearRateLimit: %v", err)
	}
	e, err := r.GetRateLimitEntry(ctx, ip)
	if err != nil {
		t.Fatalf("GetRateLimitEntry: %v", err)
	}
	if e != nil && e.Attempts != 0 {
		t.Errorf("attempts = %d after clear", e.Attempts)
	}
}
