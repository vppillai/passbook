package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/vppillai/passbook/backend/internal/model"
)

// TestAddExpense_PastDateLandsInRightMonth pins Feature B's core contract: a
// past "YYYY-MM-DD" date files the expense into the month derived from the
// date (auto-creating it), stamps the row at 12:00:00 UTC of that date, and
// produces an SK that sorts correctly within the month.
func TestAddExpense_PastDateLandsInRightMonth(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0) // overspend on, no carry

	// A date safely in the past relative to now (computed so the test is
	// independent of the wall clock CI runs on).
	pastDay := time.Now().UTC().AddDate(0, -3, 0)
	pastMonth := fmt.Sprintf("%04d-%02d", pastDay.Year(), pastDay.Month())
	dateStr := fmt.Sprintf("%04d-%02d-%02d", pastDay.Year(), pastDay.Month(), pastDay.Day())

	resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount:      20,
		Description: "back-dated book",
		Date:        dateStr,
	})
	if err != nil {
		t.Fatalf("AddExpense with past date: %v", err)
	}

	// The expense must be stored under the date's month, not the current one.
	if repo.Months[pastMonth] == nil {
		t.Fatalf("month %s not auto-created for the back-dated expense", pastMonth)
	}
	if GetCurrentMonth() != pastMonth && repo.Months[GetCurrentMonth()] != nil {
		t.Errorf("expense leaked into current month %s", GetCurrentMonth())
	}

	// Timestamp must be noon UTC on the supplied date.
	wantTime := time.Date(pastDay.Year(), pastDay.Month(), pastDay.Day(), 12, 0, 0, 0, time.UTC)
	if !resp.Expense.CreatedAt.Equal(wantTime) {
		t.Errorf("CreatedAt = %v, want %v (noon UTC of the date)", resp.Expense.CreatedAt, wantTime)
	}

	// SK is EXP#<unixnano>#<id>; the embedded timestamp must equal noon UTC.
	gotNano := skNanos(t, resp.Expense.SK)
	if gotNano != wantTime.UnixNano() {
		t.Errorf("SK timestamp = %d, want %d (noon UTC nanos)", gotNano, wantTime.UnixNano())
	}
}

// TestAddExpense_PastDateSKOrdering pins that two back-dated expenses on
// different days in the same month produce SKs that order by date (the SK's
// epoch component sorts the earlier day first).
func TestAddExpense_PastDateSKOrdering(t *testing.T) {
	ctx := context.Background()
	svc, _ := newExpenseService(t, true, false, 0)

	// Two distinct days in a safely-past month, computed off the wall clock.
	base := time.Now().UTC().AddDate(0, -3, 0)
	day2 := fmt.Sprintf("%04d-%02d-02", base.Year(), base.Month())
	day20 := fmt.Sprintf("%04d-%02d-20", base.Year(), base.Month())

	earlier, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 5, Description: "a", Date: day2})
	if err != nil {
		t.Fatalf("earlier add: %v", err)
	}
	later, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 5, Description: "b", Date: day20})
	if err != nil {
		t.Fatalf("later add: %v", err)
	}

	// DynamoDB sorts by SK lexicographically; the fixed-width epoch-nanos
	// component means the earlier date's SK is the lexicographically smaller
	// one. Querying descending (most recent first) would return `later` first.
	if !(earlier.Expense.SK < later.Expense.SK) {
		t.Errorf("SK ordering broken: earlier %q should sort before later %q", earlier.Expense.SK, later.Expense.SK)
	}
}

// TestAddExpense_TodayUsesCurrentTime pins that supplying today's date uses
// the current time (not noon), so a same-day back-date add still sorts after
// earlier same-day adds.
func TestAddExpense_TodayUsesCurrentTime(t *testing.T) {
	ctx := context.Background()
	svc, _ := newExpenseService(t, true, false, 0)

	now := time.Now().UTC()
	today := fmt.Sprintf("%04d-%02d-%02d", now.Year(), now.Month(), now.Day())
	noon := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, time.UTC)

	before := time.Now()
	resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 5, Description: "today", Date: today})
	after := time.Now()
	if err != nil {
		t.Fatalf("AddExpense today: %v", err)
	}
	// The timestamp must be a real "now", not the noon sentinel (unless the
	// test genuinely runs at noon UTC, which would still be within [before,
	// after]). Assert it falls inside the wall-clock window of the call.
	ts := resp.Expense.CreatedAt
	if ts.Before(before.Add(-time.Second)) || ts.After(after.Add(time.Second)) {
		t.Errorf("CreatedAt = %v, want a current timestamp in [%v, %v]", ts, before, after)
	}
	// Sanity: only flag the noon-sentinel mistake when "now" isn't actually noon.
	if ts.Equal(noon) && !now.Truncate(time.Minute).Equal(noon.Truncate(time.Minute)) {
		t.Error("today's date used the noon sentinel instead of the current time")
	}
}

// TestAddExpense_FutureDateRejected pins that a future date is refused with
// ErrFutureDate (handler → 400) and nothing is written.
func TestAddExpense_FutureDateRejected(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	future := time.Now().UTC().AddDate(0, 0, 2)
	dateStr := fmt.Sprintf("%04d-%02d-%02d", future.Year(), future.Month(), future.Day())

	_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 5, Description: "future", Date: dateStr})
	if !errors.Is(err, ErrFutureDate) {
		t.Fatalf("future date = %v, want ErrFutureDate", err)
	}
	if len(repo.Expenses) != 0 {
		t.Errorf("expense written despite future-date rejection: %d rows", len(repo.Expenses))
	}
}

// TestAddExpense_DateMonthMismatchRejected pins that a date whose month
// disagrees with an explicitly supplied month field is refused with
// ErrDateMonthMismatch (handler → 400).
func TestAddExpense_DateMonthMismatchRejected(t *testing.T) {
	ctx := context.Background()
	svc, _ := newExpenseService(t, true, false, 0)

	_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount:      5,
		Description: "mismatch",
		Month:       "2026-04",
		Date:        "2026-03-15",
	})
	if !errors.Is(err, ErrDateMonthMismatch) {
		t.Fatalf("date/month mismatch = %v, want ErrDateMonthMismatch", err)
	}
}

// TestAddExpense_DateMatchingMonthAccepted pins that a date whose month
// matches the supplied month is accepted (the validation only rejects a real
// mismatch).
func TestAddExpense_DateMatchingMonthAccepted(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{
		Amount:      5,
		Description: "match",
		Month:       "2026-03",
		Date:        "2026-03-15",
	})
	if err != nil {
		t.Fatalf("matching date+month should be accepted, got %v", err)
	}
	if repo.Months["2026-03"] == nil {
		t.Error("expense not filed into 2026-03")
	}
}

// TestAddExpense_InvalidDateRejected pins that a malformed or impossible date
// is refused with ErrInvalidDate (handler → 400).
func TestAddExpense_InvalidDateRejected(t *testing.T) {
	ctx := context.Background()
	svc, _ := newExpenseService(t, true, false, 0)

	for _, bad := range []string{"2026-13-01", "2026-02-30", "03/15/2026", "2026-3-5", "not-a-date"} {
		_, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 5, Description: "x", Date: bad})
		if !errors.Is(err, ErrInvalidDate) {
			t.Errorf("date %q = %v, want ErrInvalidDate", bad, err)
		}
	}
}

// TestAddExpense_AbsentDateUnchanged pins that omitting the date preserves the
// pre-feature behavior: month from the month field (or UTC current), timestamp
// = now.
func TestAddExpense_AbsentDateUnchanged(t *testing.T) {
	ctx := context.Background()
	svc, repo := newExpenseService(t, true, false, 0)

	before := time.Now()
	resp, err := svc.AddExpense(ctx, &model.AddExpenseRequest{Amount: 5, Description: "x", Month: "2026-05"})
	after := time.Now()
	if err != nil {
		t.Fatalf("AddExpense (no date): %v", err)
	}
	if repo.Months["2026-05"] == nil {
		t.Error("expense not filed into the explicit month 2026-05")
	}
	ts := resp.Expense.CreatedAt
	if ts.Before(before.Add(-time.Second)) || ts.After(after.Add(time.Second)) {
		t.Errorf("CreatedAt = %v, want a current timestamp (absent date)", ts)
	}
}

// skNanos extracts the epoch-nanos component from an "EXP#<nanos>#<id>" SK.
func skNanos(t *testing.T, sk string) int64 {
	t.Helper()
	trimmed := strings.TrimPrefix(sk, "EXP#")
	hash := strings.IndexByte(trimmed, '#')
	if hash < 0 {
		t.Fatalf("malformed SK %q", sk)
	}
	var n int64
	if _, err := fmt.Sscanf(trimmed[:hash], "%d", &n); err != nil {
		t.Fatalf("could not parse SK nanos from %q: %v", sk, err)
	}
	return n
}
