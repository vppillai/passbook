#!/bin/bash
# Test harness for scripts/add-data.sh.
#
# Puts scripts/test/bin on PATH so `aws` resolves to fake-aws (see that file for
# what it models and why), gives each test a fresh table, and provides seed /
# read / assert helpers so a test reads as a statement about the ledger rather
# than a pile of jq.
#
# Sourced by add-data.test.sh; not executable on its own.

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"
ADD_DATA="$REPO_ROOT/scripts/add-data.sh"

TESTS_RUN=0
TESTS_FAILED=0
CURRENT_TEST=""
CURRENT_FAILED=0

# ---- fake aws on PATH -------------------------------------------------------
FAKE_BIN="$(mktemp -d)"
ln -s "$HARNESS_DIR/fake-aws" "$FAKE_BIN/aws"
export PATH="$FAKE_BIN:$PATH"

WORK_DIR="$(mktemp -d)"
cleanup() { rm -rf "$FAKE_BIN" "$WORK_DIR"; }
trap cleanup EXIT

# ---- test lifecycle ---------------------------------------------------------

# begin_test NAME — fresh empty table, fresh call log, default stack settings.
begin_test() {
    CURRENT_TEST="$1"
    CURRENT_FAILED=0
    TESTS_RUN=$((TESTS_RUN + 1))
    export PASSBOOK_FAKE_TABLE="$WORK_DIR/table.json"
    export PASSBOOK_FAKE_CALLS="$WORK_DIR/calls.log"
    echo '[]' > "$PASSBOOK_FAKE_TABLE"
    : > "$PASSBOOK_FAKE_CALLS"
    unset PASSBOOK_FAKE_NO_CREDS PASSBOOK_FAKE_NO_TABLE PASSBOOK_FAKE_NO_STACK
    export PASSBOOK_FAKE_CARRY=true
    export PASSBOOK_FAKE_OVERSPEND=false
}

end_test() {
    if [[ "$CURRENT_FAILED" -eq 0 ]]; then
        echo "  ok   $CURRENT_TEST"
    else
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo "  FAIL $CURRENT_TEST"
    fi
}

fail() {
    CURRENT_FAILED=1
    echo "       $*" >&2
}

summary() {
    echo
    echo "$TESTS_RUN tests, $TESTS_FAILED failed"
    [[ "$TESTS_FAILED" -eq 0 ]] || return 1
}

# ---- running the script under test -----------------------------------------

# run_add_data ARGS... — always with --instance test --yes so no prompt blocks.
# Captures combined output in $LAST_OUTPUT and the status in $LAST_STATUS;
# never aborts the suite, since a non-zero exit is often the thing under test.
run_add_data() {
    set +e
    LAST_OUTPUT=$("$ADD_DATA" --instance test --yes "$@" 2>&1)
    LAST_STATUS=$?
    set -e
}

# ---- seeding ----------------------------------------------------------------

put_item() {
    local item="$1"
    jq --argjson it "$item" '
        ($it | (.PK.S // "") + "|" + (.SK.S // "")) as $w
        | map(select(((.PK.S // "") + "|" + (.SK.S // "")) != $w)) + [$it]' \
        "$PASSBOOK_FAKE_TABLE" > "$WORK_DIR/tmp.json"
    mv "$WORK_DIR/tmp.json" "$PASSBOOK_FAKE_TABLE"
}

# seed_month MONTH START ALLOWANCE EXPENSES ENDING — canonical row AND its
# MONTHLIST mirror, which is the state a table written by the current backend is
# in.
seed_month() {
    local m="$1" st="$2" al="$3" ex="$4" en="$5"
    local body
    body=$(jq -n --arg m "$m" --arg st "$st" --arg al "$al" --arg ex "$ex" --arg en "$en" '{
        month: {S: $m}, starting_balance: {N: $st}, allowance_added: {N: $al},
        total_expenses: {N: $ex}, ending_balance: {N: $en},
        updated_at: {S: "2026-01-01T00:00:00Z"}}')
    put_item "$(jq -n --argjson b "$body" --arg m "$m" \
        '$b + {PK: {S: ("MONTH#" + $m)}, SK: {S: "SUMMARY"}}')"
    put_item "$(jq -n --argjson b "$body" --arg m "$m" \
        '$b + {PK: {S: "MONTHLIST"}, SK: {S: $m}}')"
}

# seed_legacy_month ... — canonical row only, NO mirror. The state of a table
# written before the MONTHLIST scheme existed.
seed_legacy_month() {
    local m="$1" st="$2" al="$3" ex="$4" en="$5"
    seed_month "$@"
    jq --arg m "$m" 'map(select(((.PK.S // "") == "MONTHLIST" and (.SK.S // "") == $m) | not))' \
        "$PASSBOOK_FAKE_TABLE" > "$WORK_DIR/tmp.json"
    mv "$WORK_DIR/tmp.json" "$PASSBOOK_FAKE_TABLE"
}

# seed_orphan_mirror MONTH — a MONTHLIST row whose canonical month is gone.
# Reachable for real: rmmonth deletes the two rows in separate calls.
seed_orphan_mirror() {
    local m="$1"
    put_item "$(jq -n --arg m "$m" '{
        PK: {S: "MONTHLIST"}, SK: {S: $m}, month: {S: $m},
        starting_balance: {N: "0"}, allowance_added: {N: "0"},
        total_expenses: {N: "0"}, ending_balance: {N: "0"}}')"
}

# seed_expense MONTH AMOUNT [DESCRIPTION] [SUFFIX]
seed_expense() {
    local m="$1" amt="$2" desc="${3:-item}" sfx="${4:-$RANDOM}"
    put_item "$(jq -n --arg m "$m" --arg amt "$amt" --arg d "$desc" --arg s "$sfx" '{
        PK: {S: ("MONTH#" + $m)}, SK: {S: ("EXP#1700000000000#" + $s)},
        amount: {N: $amt}, description: {S: $d},
        created_at: {S: ($m + "-15T12:00:00Z")}}')"
}

seed_balance() {
    put_item "$(jq -n --arg b "$1" '{
        PK: {S: "BALANCE"}, SK: {S: "BALANCE"}, total_balance: {N: $b}}')"
}

# ---- reading ----------------------------------------------------------------

# month_field MONTH FIELD — a numeric attribute of the canonical month row.
month_field() {
    jq -r --arg m "MONTH#$1" --arg f "$2" '
        map(select(.PK.S == $m and .SK.S == "SUMMARY")) | .[0][$f].N // "MISSING"' \
        "$PASSBOOK_FAKE_TABLE"
}

# mirror_field MONTH FIELD — the same attribute on the MONTHLIST mirror.
mirror_field() {
    jq -r --arg m "$1" --arg f "$2" '
        map(select(.PK.S == "MONTHLIST" and .SK.S == $m)) | .[0][$f].N // "MISSING"' \
        "$PASSBOOK_FAKE_TABLE"
}

total_balance() {
    jq -r 'map(select(.PK.S == "BALANCE")) | .[0].total_balance.N // "MISSING"' \
        "$PASSBOOK_FAKE_TABLE"
}

mirror_months() {
    jq -r 'map(select(.PK.S == "MONTHLIST")) | sort_by(.SK.S) | map(.SK.S) | join(",")' \
        "$PASSBOOK_FAKE_TABLE"
}

canonical_months() {
    jq -r 'map(select(.SK.S == "SUMMARY")) | sort_by(.PK.S)
           | map(.PK.S | sub("^MONTH#";"")) | join(",")' "$PASSBOOK_FAKE_TABLE"
}

# write_calls — how many mutating AWS calls were made. Used to prove --dry-run
# is a true preview.
write_calls() {
    grep -cE "^dynamodb (put-item|delete-item|transact-write-items|batch-write-item)" \
        "$PASSBOOK_FAKE_CALLS" || true
}

# ---- assertions -------------------------------------------------------------

assert_eq() {
    local got="$1" want="$2" what="$3"
    [[ "$got" == "$want" ]] || fail "$what: got '$got', want '$want'"
}

# assert_money — compares to the cent, so 100 and 100.00 are the same figure.
assert_money() {
    local got="$1" want="$2" what="$3"
    if ! LC_ALL=C awk "BEGIN { exit !((($got) - ($want) < 0.005) && (($want) - ($got) < 0.005)) }" 2>/dev/null; then
        fail "$what: got '$got', want '$want'"
    fi
}

assert_status() {
    local want="$1" what="$2"
    [[ "$LAST_STATUS" -eq "$want" ]] || \
        fail "$what: exit $LAST_STATUS, want $want. Output:
$LAST_OUTPUT"
}

assert_output_contains() {
    local needle="$1" what="$2"
    grep -qF -- "$needle" <<<"$LAST_OUTPUT" || fail "$what: output lacks '$needle'. Output:
$LAST_OUTPUT"
}

assert_output_lacks() {
    local needle="$1" what="$2"
    grep -qF -- "$needle" <<<"$LAST_OUTPUT" && fail "$what: output unexpectedly contains '$needle'. Output:
$LAST_OUTPUT"
    return 0
}
