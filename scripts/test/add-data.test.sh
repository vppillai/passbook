#!/bin/bash
# Tests for scripts/add-data.sh — the largest file in the repo (~1770 lines) and
# the only code that rewrites production ledger data, previously with no
# automated test of any kind.
#
# Eight of its functions mutate the ledger: repair_ledger,
# recompute_carry_chain, recompute_total_expenses, prune_orphan_mirrors,
# set_balance, delete_month, import_data, plus add_month/add_expense/funds. Four
# of those were added during a 2026-07 review and verified only by an ad-hoc
# stub that was never committed.
#
# Run: scripts/test/add-data.test.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

echo "add-data.sh"

# =============================================================================
# audit — read-only, and the safety net every repair is judged against
# =============================================================================

begin_test "audit passes on a consistent ledger"
# audit also checks total_expenses against the actual expense rows, so a fixture
# that claims spending must carry rows to back it.
seed_month 2026-01 0 100 40 60
seed_expense 2026-01 40 "book" a
seed_month 2026-02 60 100 30 130
seed_expense 2026-02 30 "shoes" b
seed_balance 130
run_add_data audit
assert_status 0 "consistent ledger"
assert_output_contains "OK" "consistent ledger reports OK"
end_test

begin_test "audit exits 1 when a month's own arithmetic is wrong"
# ending should be 0 + 100 - 40 = 60, not 99.
seed_month 2026-01 0 100 40 99
seed_expense 2026-01 40 "book" a
seed_balance 99
run_add_data audit
assert_status 1 "self-inconsistent month is drift"
end_test

begin_test "audit exits 1 on a broken carry chain"
# February starts at 5 but January ended at 60. Rows match the stated expenses,
# so the chain is the ONLY defect — otherwise this would pass for another reason.
seed_month 2026-01 0 100 40 60
seed_expense 2026-01 40 "book" a
seed_month 2026-02 5 100 30 75
seed_expense 2026-02 30 "shoes" b
seed_balance 135
run_add_data audit
assert_status 1 "broken carry chain is drift"
end_test

begin_test "audit exits 1 when BALANCE disagrees with the months"
seed_month 2026-01 0 100 40 60
seed_expense 2026-01 40 "book" a
seed_balance 999
run_add_data audit
assert_status 1 "balance mismatch is drift"
end_test

begin_test "audit writes nothing, even on drift"
seed_month 2026-01 0 100 40 99
seed_balance 99
run_add_data audit
assert_eq "$(write_calls)" "0" "audit is read-only"
end_test

begin_test "audit reports a month whose total_expenses disagrees with its rows"
seed_month 2026-01 0 100 40 60
seed_expense 2026-01 25 "book" a
# Only 25 of the recorded 40 exists as a row.
seed_balance 60
run_add_data audit
assert_status 1 "expense-row mismatch is drift"
end_test

# =============================================================================
# fixexpenses — recompute total_expenses from the actual rows
# =============================================================================

begin_test "fixexpenses recomputes total_expenses from the expense rows"
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 30 "book" a
seed_expense 2026-01 12.50 "snack" b
seed_balance -899
run_add_data fixexpenses 2026-01
assert_status 0 "fixexpenses succeeds"
assert_money "$(month_field 2026-01 total_expenses)" 42.50 "total_expenses recomputed"
end_test

begin_test "fixexpenses leaves ending_balance to fixchain"
# It writes SET total_expenses = :t and nothing else, which is why the command
# prints "now run fixchain then recalc". Pinned so a future change cannot
# quietly half-do the chain and leave the ledger in a third state.
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 30 "book" a
seed_balance -899
run_add_data fixexpenses 2026-01
assert_money "$(month_field 2026-01 total_expenses)" 30 "total_expenses is its job"
assert_money "$(month_field 2026-01 ending_balance)" -899 "ending_balance is not"
assert_output_contains "fixchain" "tells the operator what to run next"
end_test

begin_test "fixexpenses alone still leaves the ledger failing audit"
# The three stages are not independently sufficient; only the full repair is.
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 30 "book" a
seed_balance -899
run_add_data fixexpenses 2026-01
run_add_data audit
assert_status 1 "ending_balance and BALANCE are still stale"
end_test

begin_test "fixexpenses keeps the MONTHLIST mirror in step"
# A mirror left stale is how a month goes missing from the history menu, so the
# repair has to touch both rows.
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 30 "book" a
seed_balance -899
run_add_data fixexpenses 2026-01
assert_money "$(mirror_field 2026-01 total_expenses)" 30 "mirror total_expenses"
end_test

begin_test "fixexpenses zeroes a month whose expense rows are all gone"
seed_month 2026-01 0 100 40 60
seed_balance 60
run_add_data fixexpenses 2026-01
assert_money "$(month_field 2026-01 total_expenses)" 0 "no rows means no expenses"
assert_money "$(mirror_field 2026-01 total_expenses)" 0 "mirror zeroed too"
end_test

begin_test "fixexpenses on a legacy month backfills the missing mirror"
# The transaction updates both rows, so without a backfill its condition on the
# mirror cancels the whole thing.
seed_legacy_month 2026-01 0 100 999 -899
seed_expense 2026-01 30 "book" a
seed_balance -899
assert_eq "$(mirror_months)" "" "starts with no mirror"
run_add_data fixexpenses 2026-01
assert_status 0 "legacy month repairs"
assert_eq "$(mirror_months)" "2026-01" "mirror backfilled"
assert_money "$(month_field 2026-01 total_expenses)" 30 "canonical repaired"
end_test

begin_test "fixexpenses leaves an already-correct month alone"
seed_month 2026-01 0 100 30 70
seed_expense 2026-01 30 "book" a
seed_balance 70
run_add_data fixexpenses 2026-01
assert_money "$(month_field 2026-01 total_expenses)" 30 "unchanged total_expenses"
assert_money "$(month_field 2026-01 ending_balance)" 70 "already-correct ending untouched"
end_test

# =============================================================================
# prune-orphans — MONTHLIST rows whose canonical month is gone
# =============================================================================

begin_test "prune-orphans deletes a mirror with no canonical month"
seed_month 2026-01 0 100 0 100
seed_orphan_mirror 2025-12
seed_balance 100
assert_eq "$(mirror_months)" "2025-12,2026-01" "orphan present before"
run_add_data prune-orphans
assert_status 0 "prune succeeds"
assert_eq "$(mirror_months)" "2026-01" "orphan removed"
assert_eq "$(canonical_months)" "2026-01" "canonical months untouched"
end_test

begin_test "prune-orphans keeps every mirror that has a canonical month"
seed_month 2026-01 0 100 0 100
seed_month 2026-02 100 100 0 200
seed_balance 200
run_add_data prune-orphans
assert_eq "$(mirror_months)" "2026-01,2026-02" "healthy mirrors kept"
end_test

begin_test "prune-orphans does not touch the balance"
seed_month 2026-01 0 100 0 100
seed_orphan_mirror 2025-12
seed_balance 100
run_add_data prune-orphans
assert_money "$(total_balance)" 100 "balance untouched by a mirror prune"
end_test

# =============================================================================
# fixchain — repair starting balances from a month onward
# =============================================================================

begin_test "fixchain relinks starting balances across the whole chain"
seed_month 2026-01 0 100 40 60
seed_month 2026-02 0 100 30 70    # should start at 60
seed_month 2026-03 0 100 0 100    # should start at 130
seed_balance 230
run_add_data fixchain 2026-01
assert_status 0 "fixchain succeeds"
assert_money "$(month_field 2026-02 starting_balance)" 60 "Feb starts where Jan ended"
assert_money "$(month_field 2026-02 ending_balance)" 130 "Feb ending recomputed"
assert_money "$(month_field 2026-03 starting_balance)" 130 "Mar starts where Feb ended"
assert_money "$(month_field 2026-03 ending_balance)" 230 "Mar ending recomputed"
end_test

begin_test "fixchain is inclusive of the month it is given"
# `fixchain 2026-02` must fix February itself, not only what follows it.
seed_month 2026-01 0 100 40 60
seed_month 2026-02 999 100 30 70
seed_balance 130
run_add_data fixchain 2026-02
assert_money "$(month_field 2026-02 starting_balance)" 60 "the named month is repaired too"
end_test

begin_test "fixchain leaves the first month's starting balance at zero"
seed_month 2026-01 55 100 40 60
seed_balance 60
run_add_data fixchain 2026-01
assert_money "$(month_field 2026-01 starting_balance)" 0 "nothing precedes the first month"
assert_money "$(month_field 2026-01 ending_balance)" 60 "ending follows from it"
end_test

begin_test "fixchain zeroes starting balances when carry-over is off"
export PASSBOOK_FAKE_CARRY=false
seed_month 2026-01 0 100 40 60
seed_month 2026-02 60 100 30 130
seed_balance 190
run_add_data fixchain 2026-01
assert_money "$(month_field 2026-02 starting_balance)" 0 "no carry means no inherited balance"
assert_money "$(month_field 2026-02 ending_balance)" 70 "ending is allowance minus expenses"
end_test

begin_test "fixchain carries a deficit forward, not just a surplus"
export PASSBOOK_FAKE_OVERSPEND=true
seed_month 2026-01 0 100 250 -150
seed_month 2026-02 0 100 0 100
seed_balance -50
run_add_data fixchain 2026-01
assert_money "$(month_field 2026-02 starting_balance)" -150 "deficit carries"
assert_money "$(month_field 2026-02 ending_balance)" -50 "and compounds"
end_test

# =============================================================================
# repair — the full reconciliation, and the one most likely to be pointed at
# production in a hurry
# =============================================================================

begin_test "repair fixes expenses, chain and balance together"
seed_month 2026-01 0 100 999 -899     # total_expenses wrong
seed_expense 2026-01 40 "book" a
seed_month 2026-02 777 100 30 70      # starting_balance wrong
seed_expense 2026-02 30 "shoes" b
seed_balance 12345                    # balance wrong
run_add_data repair
assert_status 0 "repair succeeds"
assert_money "$(month_field 2026-01 total_expenses)" 40 "expenses recomputed"
assert_money "$(month_field 2026-01 ending_balance)" 60 "Jan ending"
assert_money "$(month_field 2026-02 starting_balance)" 60 "chain relinked"
assert_money "$(month_field 2026-02 ending_balance)" 130 "Feb ending"
assert_money "$(total_balance)" 130 "balance reconciled to the chain"
end_test

begin_test "repair zeroes a month whose expenses have no rows behind them"
# Not a quirk to work around: total_expenses is DERIVED from the rows, so a
# figure nothing backs is drift and repair is right to clear it.
seed_month 2026-01 0 100 30 70
seed_balance 70
run_add_data repair
assert_money "$(month_field 2026-01 total_expenses)" 0 "unbacked expenses cleared"
assert_money "$(month_field 2026-01 ending_balance)" 100 "ending follows"
assert_money "$(total_balance)" 100 "balance follows"
end_test

begin_test "a repaired ledger then passes audit"
# The real contract: repair leaves the ledger in a state audit accepts.
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 40 "book" a
seed_month 2026-02 777 100 30 70
seed_expense 2026-02 30 "shoes" b
seed_balance 12345
run_add_data repair
run_add_data audit
assert_status 0 "audit passes after repair"
assert_output_contains "OK" "audit reports OK after repair"
end_test

begin_test "repair also clears orphan mirrors"
seed_month 2026-01 0 100 40 60
seed_expense 2026-01 40 "book" a
seed_orphan_mirror 2025-11
seed_balance 60
run_add_data repair
assert_eq "$(mirror_months)" "2026-01" "orphan gone after repair"
end_test

begin_test "repair is idempotent"
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 40 "book" a
seed_balance 12345
run_add_data repair
local_first_end=$(month_field 2026-01 ending_balance)
local_first_bal=$(total_balance)
run_add_data repair
assert_money "$(month_field 2026-01 ending_balance)" "$local_first_end" "second repair changes nothing"
assert_money "$(total_balance)" "$local_first_bal" "balance stable across repairs"
end_test

# =============================================================================
# --dry-run must be a true preview
# =============================================================================

begin_test "dry-run repair makes no writes"
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 40 "book" a
seed_balance 12345
before=$(cat "$PASSBOOK_FAKE_TABLE")
set +e
"$ADD_DATA" --instance test --yes --dry-run repair >/dev/null 2>&1
set -e
assert_eq "$(write_calls)" "0" "no mutating calls under --dry-run"
assert_eq "$(cat "$PASSBOOK_FAKE_TABLE")" "$before" "table byte-identical after a dry run"
end_test

begin_test "dry-run fixexpenses makes no writes"
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 40 "book" a
seed_balance -899
before=$(cat "$PASSBOOK_FAKE_TABLE")
set +e
"$ADD_DATA" --instance test --yes --dry-run fixexpenses 2026-01 >/dev/null 2>&1
set -e
assert_eq "$(write_calls)" "0" "no mutating calls under --dry-run"
assert_eq "$(cat "$PASSBOOK_FAKE_TABLE")" "$before" "table unchanged"
end_test

begin_test "dry-run rmmonth makes no writes"
seed_month 2026-01 0 100 40 60
seed_expense 2026-01 40 "book" a
seed_balance 60
before=$(cat "$PASSBOOK_FAKE_TABLE")
set +e
"$ADD_DATA" --instance test --yes --dry-run rmmonth 2026-01 >/dev/null 2>&1
set -e
assert_eq "$(write_calls)" "0" "no mutating calls under --dry-run"
assert_eq "$(cat "$PASSBOOK_FAKE_TABLE")" "$before" "table unchanged"
end_test

begin_test "a preview survives an unreadable stack"
# load_settings fails closed on a real run, because guessing carry/overspend
# wrong would write a corrupted chain. A preview writes nothing, so it has
# nothing to protect — yet it aborted here too, which made the documented
# "preview against a fake instance" impossible whenever the stack could not be
# read (a scoped-down role, or a stack in another account/region).
#
# Note the contract this pins: --dry-run means reads happen and WRITES are
# suppressed. A preview that could not read the table could not tell you what it
# would change, so "works with no AWS at all" was never the promise.
export PASSBOOK_FAKE_NO_STACK=1
seed_month 2026-01 0 100 999 -899
seed_expense 2026-01 40 "book" a
seed_balance -899
before=$(cat "$PASSBOOK_FAKE_TABLE")
run_add_data --dry-run repair
assert_status 0 "a preview does not abort on an unreadable stack"
assert_output_contains "previewing with" "states the settings it assumed"
assert_output_lacks "Refusing to guess" "does not fail closed on a preview"
assert_eq "$(write_calls)" "0" "still no writes"
assert_eq "$(cat "$PASSBOOK_FAKE_TABLE")" "$before" "table byte-identical"
unset PASSBOOK_FAKE_NO_STACK
end_test

begin_test "a REAL run still refuses to guess an unreadable stack"
# The fail-closed path must survive: this is the one that protects the chain.
export PASSBOOK_FAKE_NO_STACK=1
seed_month 2026-01 0 100 999 -899
seed_balance -899
run_add_data repair
assert_status 1 "aborts rather than guessing"
assert_output_contains "Refusing to guess" "says why"
assert_eq "$(write_calls)" "0" "nothing written"
unset PASSBOOK_FAKE_NO_STACK
end_test

# =============================================================================
# preflight — the guard that exists because empty scans once zeroed the ledger
# =============================================================================

begin_test "expired credentials abort before any write"
export PASSBOOK_FAKE_NO_CREDS=1
seed_month 2026-01 0 100 40 60
seed_balance 60
run_add_data recalc
assert_status 1 "aborts on bad credentials"
assert_money "$(total_balance)" 60 "balance untouched"
assert_eq "$(write_calls)" "0" "nothing written"
unset PASSBOOK_FAKE_NO_CREDS
end_test

begin_test "a missing table aborts before any write"
export PASSBOOK_FAKE_NO_TABLE=1
seed_month 2026-01 0 100 40 60
seed_balance 60
run_add_data recalc
assert_status 1 "aborts on missing table"
assert_eq "$(write_calls)" "0" "nothing written"
unset PASSBOOK_FAKE_NO_TABLE
end_test

begin_test "recalc on an empty table does not zero a real balance"
# The ledger-zeroing bug: an empty scan read as "no months" and written back as
# $0. With no months at all there is nothing to reconcile against.
seed_balance 500
run_add_data recalc
if [[ "$(total_balance)" == "0" ]]; then
    fail "recalc zeroed the balance from an empty month set"
fi
end_test

# =============================================================================
# input validation — rejected before any write reaches the table
# =============================================================================

begin_test "a malformed month is rejected"
seed_balance 0
run_add_data month 2026-6 100 0
assert_status 1 "2026-6 is not YYYY-MM"
assert_eq "$(write_calls)" "0" "nothing written"
end_test

begin_test "a non-numeric amount is rejected"
seed_month 2026-01 0 100 0 100
seed_balance 100
run_add_data expense 2026-01 abc "bad"
assert_status 1 "abc is not an amount"
assert_eq "$(write_calls)" "0" "nothing written"
end_test

begin_test "a month outside 01-12 is rejected"
seed_balance 0
run_add_data month 2026-13 100 0
assert_status 1 "month 13 does not exist"
assert_eq "$(write_calls)" "0" "nothing written"
end_test

summary
