#!/bin/bash
# Helper script to add data to the passbook app.
#
# This is the single bash implementation of every passbook data operation.
# admin.sh is a thin interactive TUI that shells out to this script, so all
# write/validation logic lives here and only here (it used to be duplicated,
# and the two copies had already diverged).
#
# -u catches typo'd variables before they become `--table-name ""`;
# pipefail propagates aws failures through `aws ... | jq` pipes.
# Optional positionals are referenced as "${N:-}" to stay -u-safe.
set -euo pipefail

# Fail fast if a required tool is missing. Degrading mid-run causes
# PARTIAL WRITES (observed live with a missing bc: the expense row was
# written but the summary update was skipped) — refuse up front instead.
# xxd is used to generate the random suffix of expense IDs.
for tool in aws jq awk xxd; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Error: required tool '$tool' not found" >&2; exit 1; }
done

# calc EXPR — decimal arithmetic via awk, printed to cents. Replaces bc
# (not installed everywhere; its absence yielded empty values that set -e
# could not catch, because `local x=$(...)` masks substitution failures).
# LC_ALL=C pins awk's decimal point to '.' regardless of the operator's
# locale — a comma-decimal locale (de_DE etc.) otherwise prints "1,50",
# which DynamoDB rejects as a number.
calc() { LC_ALL=C awk "BEGIN { printf \"%.2f\", $* }"; }

# num_gt A B — true when A > B (decimal-aware, locale-independent).
num_gt() { LC_ALL=C awk "BEGIN { exit !($1 > $2) }"; }

# now_iso — UTC timestamp for created_at/updated_at attributes.
now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# gen_expense_id — millisecond timestamp + random suffix, matching the
# backend's EXP#<ns>#<uuid8> shape closely enough for the frontend.
# `date +%s%N` has no nanoseconds on macOS/BSD (prints a literal "N"),
# so detect that and fall back to seconds*1000.
gen_expense_id() {
    local ts
    ts=$(date +%s%N 2>/dev/null)
    case "$ts" in
        *N*|"") ts="$(date +%s)000" ;;   # macOS/BSD: no %N support
        *)      ts="${ts:0:13}" ;;        # GNU: take ms precision
    esac
    local rand
    rand=$(head -c 8 /dev/urandom | xxd -p)
    echo "EXP#${ts}#${rand}"
}

# ---- Input validation -------------------------------------------------------
# Reject bad input before ANY write. The backend validates equivalently;
# unvalidated input here previously let "2026-6" or "abc" reach DynamoDB and
# corrupt the carry chain or the number columns.

# validate_month YYYY-MM — strict 4-digit year, 01-12 month.
validate_month() {
    if [[ ! "$1" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]]; then
        echo "Error: invalid month '$1' (expected YYYY-MM, e.g. 2026-01)" >&2
        exit 1
    fi
}

# validate_amount AMOUNT — non-negative money with at most 2 decimals.
validate_amount() {
    if [[ ! "$1" =~ ^[0-9]+(\.[0-9]{1,2})?$ ]]; then
        echo "Error: invalid amount '$1' (expected a number with up to 2 decimals, e.g. 12.50)" >&2
        exit 1
    fi
}

# validate_signed_amount AMOUNT — like validate_amount but a leading '-'
# is allowed (used where a negative adjustment is meaningful, e.g. setting
# a negative total balance).
validate_signed_amount() {
    if [[ ! "$1" =~ ^-?[0-9]+(\.[0-9]{1,2})?$ ]]; then
        echo "Error: invalid amount '$1' (expected a number with up to 2 decimals, e.g. -12.50)" >&2
        exit 1
    fi
}

show_help() {
    cat << 'EOF'
Passbook CLI - Data management for passbook app

Usage: ./scripts/add-data.sh --instance <name> [--region <r>] [--dry-run] <command> [args...]

Options:
  -i, --instance <name>   Instance name (required)
  --region <region>       AWS region (default: us-west-2)
  --dry-run               Print the AWS calls that would run; make no writes
  -y, --yes               Skip confirmation prompts (rmmonth, balance)
  --force                 Skip overspend check when adding an expense

Commands:
  month YYYY-MM allowance expenses           Add/update a month (starting balance auto-calculated)
  expense YYYY-MM amount "description"       Add an expense to a month
  balance <amount>                           Set total balance
  funds YYYY-MM <amount>                     Add funds to a month
  rmfunds YYYY-MM <amount>                   Remove funds from a month
  rmmonth YYYY-MM                            Delete a month and all its expenses
  recalc                                     Recalculate total balance from all months
  export [filename]                          Export all data to JSON
  import <filename>                          Import data from JSON backup
  show                                       Show all data in the table
  help, --help, -h                           Show this help message

Examples:
  ./scripts/add-data.sh --instance kids month 2026-01 100 30    # January: allowance $100, spent $30
  ./scripts/add-data.sh --instance kids expense 2026-01 15 "Book purchase"
  ./scripts/add-data.sh --instance kids expense 2026-01 50 "Big purchase" --force  # skip overspend check
  ./scripts/add-data.sh --instance kids balance 170
  ./scripts/add-data.sh --instance kids funds 2026-02 50
  ./scripts/add-data.sh --instance kids rmfunds 2026-02 20
  ./scripts/add-data.sh --instance kids rmmonth 2026-01
  ./scripts/add-data.sh --instance kids export mybackup.json
  ./scripts/add-data.sh --instance kids import mybackup.json
  ./scripts/add-data.sh --instance kids show

Prerequisites:
  - AWS CLI v2 configured with credentials
  - jq (JSON processor)
  - awk (POSIX, preinstalled everywhere)
  - xxd (for expense ID generation)
EOF
}

REGION="us-west-2"
INSTANCE=""
DRY_RUN=false
ASSUME_YES=false
FORCE=false

# Parse global flags (must come BEFORE the positional command). Unknown
# flags before the command are an error; the first non-flag token is the
# command and ends flag parsing.
while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--instance)
            INSTANCE="${2:?--instance requires a value}"; shift 2 ;;
        --region)
            REGION="${2:?--region requires a value}"; shift 2 ;;
        --dry-run)
            DRY_RUN=true; shift ;;
        -y|--yes)
            ASSUME_YES=true; shift ;;
        --force)
            FORCE=true; shift ;;
        --)
            shift; break ;;
        -h|--help|help)
            show_help; exit 0 ;;
        -*)
            echo "Error: unknown option '$1'" >&2
            echo "Run '$0 --help' for usage." >&2
            exit 1 ;;
        *)
            break ;;
    esac
done

if [[ -z "$INSTANCE" ]]; then
    echo "Error: --instance <name> required (e.g., --instance kids)" >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1
fi

TABLE_NAME="passbook-${INSTANCE}-prod"
STACK_NAME="passbook-${INSTANCE}-prod"

# ---- AWS write wrapper ------------------------------------------------------
# aws_write runs an aws CLI command, or prints it under --dry-run. Use for
# every mutating call so --dry-run is a true preview.
aws_write() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] aws $*" >&2
        return 0
    fi
    aws "$@"
}

# confirm_destructive EXPECTED PROMPT — require the user to type EXPECTED to
# proceed. Skipped when --yes/--dry-run is set (admin.sh confirms at the TUI
# layer and passes --yes, and a preview needs no confirmation). Aborts (exit
# 1) on mismatch. read -r so a typed token can't be mangled by backslashes.
confirm_destructive() {
    local expected="$1" promptmsg="$2"
    if [[ "$ASSUME_YES" == "true" || "$DRY_RUN" == "true" ]]; then
        return 0
    fi
    local reply
    read -r -p "$promptmsg" reply
    if [[ "$reply" != "$expected" ]]; then
        echo "Aborted (confirmation did not match)." >&2
        exit 1
    fi
}

# ---- AWS preflight ----------------------------------------------------------
# Verify credentials and that the target table exists BEFORE any read or
# write. Without this a wrong/expired credential silently produced empty
# scans that were then interpreted as "no months" and written back as a
# $0 balance (the ledger-zeroing bug). Runs once; cached via a guard var.
PREFLIGHT_DONE=false
preflight() {
    [[ "$PREFLIGHT_DONE" == "true" ]] && return 0
    # Under --dry-run we have no real table; skip credential and table checks
    # so the dry-run preview works against a fake instance name without AWS.
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] skipping preflight (no real table required)" >&2
        PREFLIGHT_DONE=true
        return 0
    fi
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        echo "Error: AWS credentials not configured or expired (sts get-caller-identity failed)." >&2
        echo "       Run 'aws configure' or refresh your session, then retry." >&2
        exit 1
    fi
    if ! aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
        echo "Error: DynamoDB table '$TABLE_NAME' not found in region '$REGION'." >&2
        echo "       Check --instance and --region (instance '$INSTANCE' may not be deployed)." >&2
        exit 1
    fi
    PREFLIGHT_DONE=true
}

# ---- Instance settings (CarryOverBalance / AllowOverspending) ---------------
# These are CloudFormation stack PARAMETERS (not stored in DynamoDB), mirrored
# into the Lambda's env. Read them once so the scripts honor the same carry /
# overspend behavior the live app does. Fails closed: silently defaulting on a
# describe-stacks error would apply AllowOverspending=false to an instance
# deployed with true (and vice versa for carry-over).
CARRY_OVER_BALANCE=""
ALLOW_OVERSPENDING=""
load_settings() {
    [[ -n "$CARRY_OVER_BALANCE" ]] && return 0
    local params
    if ! params=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query "Stacks[0].Parameters" --output json); then
        echo "ERROR: could not read stack '$STACK_NAME' in $REGION to load instance settings." >&2
        echo "       Check credentials/region/stack name. Refusing to guess carry/overspend defaults." >&2
        exit 1
    fi
    CARRY_OVER_BALANCE=$(echo "$params" | jq -r \
        'map(select(.ParameterKey=="CarryOverBalance")) | .[0].ParameterValue // "true"')
    ALLOW_OVERSPENDING=$(echo "$params" | jq -r \
        'map(select(.ParameterKey=="AllowOverspending")) | .[0].ParameterValue // "false"')
    if [[ -z "$CARRY_OVER_BALANCE" || "$CARRY_OVER_BALANCE" == "null" ]]; then
        CARRY_OVER_BALANCE="true"
    fi
    if [[ -z "$ALLOW_OVERSPENDING" || "$ALLOW_OVERSPENDING" == "null" ]]; then
        ALLOW_OVERSPENDING="false"
    fi
}

# prev_month YYYY-MM -> YYYY-MM (previous calendar month).
prev_month() {
    local month="$1"
    local year=${month%-*}
    local mon=${month#*-}
    mon=$((10#$mon - 1))
    if [ "$mon" -eq 0 ]; then
        mon=12
        year=$((year - 1))
    fi
    printf "%04d-%02d" "$year" "$mon"
}

# next_month YYYY-MM -> YYYY-MM (following calendar month).
next_month() {
    local month="$1"
    local year=${month%-*}
    local mon=${month#*-}
    mon=$((10#$mon + 1))
    if [ "$mon" -eq 13 ]; then
        mon=1
        year=$((year + 1))
    fi
    printf "%04d-%02d" "$year" "$mon"
}

get_summary() {
    aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$1\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null
}

# ensure_monthlist_mirror MONTH — backfill the MONTHLIST/<month> mirror row
# if it is missing (legacy table written before the MONTHLIST scheme). Mirrors
# the backend's EnsureMonthListMirror: read-mirror → if absent, read canonical
# → conditional put with attribute_not_exists(PK). Under --dry-run, skip the
# AWS calls and just report what would happen; the real write below is still
# guarded by aws_write. Returns 0 whether the mirror existed or was just
# created; returns 1 if the canonical summary itself is also absent.
ensure_monthlist_mirror() {
    local month="$1"
    # Check whether the mirror row already exists.
    local mirror_data
    mirror_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTHLIST\"}, \"SK\": {\"S\": \"$month\"}}" \
        --output json 2>/dev/null)
    if [ "$(echo "$mirror_data" | jq -r '.Item // empty')" != "" ]; then
        return 0   # mirror already exists
    fi
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] would backfill MONTHLIST/$month mirror from canonical" >&2
        return 0
    fi
    # Mirror absent — read canonical and copy it.
    local canonical
    canonical=$(get_summary "$month") || true
    if [ "$(echo "$canonical" | jq -r '.Item // empty')" = "" ]; then
        return 1   # no canonical row either; caller's transaction will surface the error
    fi
    local item_json
    item_json=$(echo "$canonical" | jq -c '.Item | .PK.S = "MONTHLIST" | .SK.S = .month.S')
    # Conditional put: attribute_not_exists guards a concurrent backfill race.
    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" \
        --item "$item_json" \
        --condition-expression "attribute_not_exists(PK)" 2>/dev/null || true
    # Ignore ConditionalCheckFailedException: a concurrent call already created it.
    return 0
}

# ---- Carry-chain recompute --------------------------------------------------
# After a month-level change (allowance/expenses) the starting_balance of
# EVERY later month must be recomputed so the carry chain stays consistent —
# mirrors the backend's "walk forward" fix (B3) and CreateMonth carry logic.
# Only meaningful when CarryOverBalance is enabled; when disabled, months are
# independent and starting_balance stays 0, so this is a no-op.
#
# For each month after `from_month` (in ascending order, contiguous over the
# set of existing summaries), set starting_balance = prev.ending_balance and
# ending_balance = starting_balance + allowance_added - total_expenses.
recompute_carry_chain() {
    local from_month="$1"
    load_settings
    if [[ "$CARRY_OVER_BALANCE" == "false" ]]; then
        return 0
    fi

    # Under --dry-run there is no real table; skip the carry-chain scan and
    # just note what would happen.
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] recompute_carry_chain from $from_month (skipping scan — no real table)" >&2
        return 0
    fi

    # Gather all existing month summaries as a JSON array, ascending keys.
    local months_json months
    months_json=$(scan_month_summaries | jq '.Items')
    months=$(echo "$months_json" | jq -r '[.[] | .month.S] | sort | .[]')

    local prev_ending=""
    local m
    while IFS= read -r m; do
        [[ -z "$m" ]] && continue
        # Skip everything up to and including from_month; its ending is the
        # seed for the first later month.
        if [[ "$m" < "$from_month" || "$m" == "$from_month" ]]; then
            prev_ending=$(echo "$months_json" | jq -r --arg mm "$m" \
                '.[] | select(.month.S==$mm) | .ending_balance.N // "0"')
            continue
        fi
        [[ -z "$prev_ending" ]] && prev_ending="0"
        local allowance expenses new_start new_ending
        allowance=$(echo "$months_json" | jq -r --arg mm "$m" \
            '.[] | select(.month.S==$mm) | .allowance_added.N // "0"')
        expenses=$(echo "$months_json" | jq -r --arg mm "$m" \
            '.[] | select(.month.S==$mm) | .total_expenses.N // "0"')
        new_start=$(calc "$prev_ending")
        new_ending=$(calc "$new_start + $allowance - $expenses")
        echo "  Carry: $m starting_balance -> \$$new_start, ending_balance -> \$$new_ending"
        local carry_ts
        carry_ts=$(now_iso)
        local carry_expr carry_vals
        carry_expr="SET starting_balance = :s, ending_balance = :e, updated_at = :u"
        carry_vals="{
            \":s\": {\"N\": \"$new_start\"},
            \":e\": {\"N\": \"$new_ending\"},
            \":u\": {\"S\": \"$carry_ts\"}
        }"
        # Build a transact-write-items payload that updates both the canonical
        # row and the MONTHLIST mirror atomically.  The mirror update uses
        # attribute_exists(PK) — same guard as the backend's monthListUpdate.
        # On legacy tables (mirror absent) ensure_monthlist_mirror back-fills
        # it before we run the transaction.
        if [[ "$DRY_RUN" != "true" ]]; then
            ensure_monthlist_mirror "$m" || true
        fi
        local carry_tx
        carry_tx=$(jq -n \
            --arg table "$TABLE_NAME" \
            --arg pk_canon "MONTH#$m" \
            --arg pk_list  "MONTHLIST" \
            --arg sk_sum   "SUMMARY" \
            --arg sk_m     "$m" \
            --arg expr     "$carry_expr" \
            --argjson vals "$carry_vals" \
            '{
                "TransactItems": [
                    {"Update": {
                        "TableName": $table,
                        "Key": {"PK": {"S": $pk_canon}, "SK": {"S": $sk_sum}},
                        "UpdateExpression": $expr,
                        "ExpressionAttributeValues": $vals
                    }},
                    {"Update": {
                        "TableName": $table,
                        "Key": {"PK": {"S": $pk_list}, "SK": {"S": $sk_m}},
                        "UpdateExpression": $expr,
                        "ConditionExpression": "attribute_exists(PK)",
                        "ExpressionAttributeValues": $vals
                    }}
                ]
            }')
        if [[ "$DRY_RUN" == "true" ]]; then
            echo "  [DRY-RUN] transact-write-items (carry chain $m):" >&2
            echo "$carry_tx" | jq -c . >&2
        else
            aws dynamodb transact-write-items --region "$REGION" \
                --transact-items "$(echo "$carry_tx" | jq -c '.TransactItems')" >/dev/null
        fi
        prev_ending="$new_ending"
    done <<< "$months"
}

# scan_month_summaries — echoes the raw scan JSON for all MONTH#*/SUMMARY
# items, or returns non-zero (and prints nothing) on an AWS error. Uses the
# CLI's built-in pagination (it aggregates pages and emits the full .Items
# array); the previous hand-rolled NextToken loop never consumed
# LastEvaluatedKey and silently truncated past one page.
#
# Critically, stderr is NOT discarded and the aws exit status is propagated:
# a credential/permission error must be distinguishable from a genuinely
# empty table, so recalc never mistakes "API failed" for "zero months" and
# zeroes the ledger.
scan_month_summaries() {
    aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --filter-expression "begins_with(PK, :pk) AND SK = :sk" \
        --expression-attribute-values '{":pk": {"S": "MONTH#"}, ":sk": {"S": "SUMMARY"}}' \
        --output json
}

# Recalculate total balance from all months.
recalc_balance() {
    preflight
    echo "Recalculating total balance from all months..."

    # Under --dry-run there is no real table; skip the scan and write.
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] would scan months and write BALANCE row" >&2
        return 0
    fi

    # Capture scan output and exit status separately so a failed scan is
    # distinguished from an empty (zero-month) result. `set -e` is disabled
    # for just this call so we can inspect the status ourselves. The aws
    # stderr is captured to a mktemp file (not a fixed /tmp path).
    local scan_json scan_rc items count total errfile
    errfile=$(mktemp)
    set +e
    scan_json=$(scan_month_summaries 2>"$errfile")
    scan_rc=$?
    set -e
    if [ "$scan_rc" -ne 0 ]; then
        echo "Error: month scan FAILED (aws exit $scan_rc). NOT writing balance." >&2
        echo "       This is an API/credentials error, not an empty table — the" >&2
        echo "       previous code would have zeroed total_balance here." >&2
        sed 's/^/         aws: /' "$errfile" >&2 2>/dev/null || true
        rm -f "$errfile"
        exit 1
    fi
    rm -f "$errfile"

    items=$(echo "$scan_json" | jq '.Items')
    count=$(echo "$items" | jq 'length')

    # Genuinely zero months → writing 0 is destructive if it was a mistake,
    # so require an explicit confirmation (skippable via --yes/--dry-run).
    if [ "$count" = "0" ]; then
        echo "  Scan succeeded but found NO month summaries."
        confirm_destructive "yes" "Set total_balance to \$0.00 (no months exist)? Type 'yes' to confirm: "
    fi

    # Equals sum(ending-starting) under the ledger invariant ending = starting
    # + allowance - expenses; allowance-expenses is used because it is robust
    # to a broken carry chain. Rounded to cents (mirrors backend roundCents).
    total=$(echo "$items" | jq -r '[.[] | ((.allowance_added.N // "0") | tonumber) - ((.total_expenses.N // "0") | tonumber)] | add // 0')
    total=$(calc "$total")
    echo "  Calculated total balance: $total"

    aws_write dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$total\"},
        \"updated_at\": {\"S\": \"$(now_iso)\"}
    }" >/dev/null

    echo "  Total balance updated to: $total"
}

# Add or update a month summary.
add_month() {
    local month="$1"
    local allowance="$2"
    local expenses="$3"
    validate_month "$month"
    validate_amount "$allowance"
    validate_amount "$expenses"
    preflight
    load_settings

    # Refuse to silently overwrite a month that already has real expenses —
    # a `month` put would clobber total_expenses and orphan the carry chain.
    # get_summary calls aws which may return non-zero (e.g. under --dry-run
    # with a fake table); || true prevents set -e from aborting.
    local existing exp_total exp_count
    existing=$(get_summary "$month") || true
    if [ -n "$existing" ] && [ "$(echo "$existing" | jq -r '.Item // empty')" != "" ]; then
        exp_total=$(echo "$existing" | jq -r '.Item.total_expenses.N // "0"')
        # Count actual expense rows (not just the summary's total field).
        exp_count=$(aws dynamodb query --table-name "$TABLE_NAME" --region "$REGION" \
            --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
            --expression-attribute-values "{\":pk\": {\"S\": \"MONTH#$month\"}, \":sk\": {\"S\": \"EXP#\"}}" \
            --select COUNT --output json 2>/dev/null | jq -r '.Count // 0')
        if num_gt "$exp_total" 0 || [ "${exp_count:-0}" -gt 0 ]; then
            echo "Error: month $month already exists with expenses (total_expenses=\$$exp_total, $exp_count expense row(s))." >&2
            echo "       Overwriting would clobber them. Use 'funds $month <amount>' to top up its allowance instead." >&2
            exit 1
        fi
    fi

    # Auto-calculate starting balance from the previous month's ending,
    # but only when carry-over is enabled (matches the live app).
    local starting_balance="0"
    if [[ "$CARRY_OVER_BALANCE" != "false" ]]; then
        local prev pm prev_data
        pm=$(prev_month "$month")
        prev_data=$(get_summary "$pm") || true
        prev=$(echo "$prev_data" | jq -r '.Item.ending_balance.N // "0"')
        if [ -n "$prev" ] && [ "$prev" != "null" ]; then
            starting_balance=$(calc "$prev")
        fi
    fi

    local ending_balance
    ending_balance=$(calc "$starting_balance + $allowance - $expenses")

    echo "Adding month $month: starting=$starting_balance, allowance=$allowance, expenses=$expenses, ending=$ending_balance"

    local month_ts
    month_ts=$(now_iso)

    # Build a transact-write-items that puts BOTH the canonical row
    # (PK=MONTH#<m>/SK=SUMMARY) and the MONTHLIST mirror (PK=MONTHLIST/SK=<m>)
    # atomically — mirrors the backend's SaveMonthSummary transaction.
    local add_month_tx
    add_month_tx=$(jq -n \
        --arg table  "$TABLE_NAME" \
        --arg pk_canon "MONTH#$month" \
        --arg pk_list  "MONTHLIST" \
        --arg sk_sum   "SUMMARY" \
        --arg sk_m     "$month" \
        --arg mon      "$month" \
        --arg start    "$starting_balance" \
        --arg allow    "$allowance" \
        --arg exp      "$expenses" \
        --arg end      "$ending_balance" \
        --arg ts       "$month_ts" \
        '{
            "TransactItems": [
                {"Put": {
                    "TableName": $table,
                    "Item": {
                        "PK":               {"S": $pk_canon},
                        "SK":               {"S": $sk_sum},
                        "month":            {"S": $mon},
                        "starting_balance": {"N": $start},
                        "allowance_added":  {"N": $allow},
                        "total_expenses":   {"N": $exp},
                        "ending_balance":   {"N": $end},
                        "created_at":       {"S": $ts},
                        "updated_at":       {"S": $ts}
                    }
                }},
                {"Put": {
                    "TableName": $table,
                    "Item": {
                        "PK":               {"S": $pk_list},
                        "SK":               {"S": $sk_m},
                        "month":            {"S": $mon},
                        "starting_balance": {"N": $start},
                        "allowance_added":  {"N": $allow},
                        "total_expenses":   {"N": $exp},
                        "ending_balance":   {"N": $end},
                        "created_at":       {"S": $ts},
                        "updated_at":       {"S": $ts}
                    }
                }}
            ]
        }')

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] transact-write-items (add_month canonical+MONTHLIST):" >&2
        echo "$add_month_tx" | jq -c . >&2
    else
        aws dynamodb transact-write-items --region "$REGION" \
            --transact-items "$(echo "$add_month_tx" | jq -c '.TransactItems')" >/dev/null
    fi

    # Note: we intentionally do NOT create a synthetic "Total Expenses"
    # expense row. The summary's total_expenses field is the source of truth
    # for the frontend; a fake row stacked duplicates on every re-run and
    # diverged from the per-expense list. Use the `expense` command to record
    # individual expenses.

    # A month-level change can shift every later month's starting balance.
    recompute_carry_chain "$month"

    # Recalculate total balance.
    recalc_balance
}

# Add an expense to a month (delta-style writes so concurrent app writes
# are not clobbered).
add_expense() {
    local month="$1"
    local amount="$2"
    local description="$3"
    validate_month "$month"
    validate_amount "$amount"
    preflight
    load_settings

    echo "Adding expense to $month: amount=$amount, description=$description"

    # Ensure the month exists; carry the previous month's ending balance into
    # starting_balance when carry-over is enabled (mirrors backend
    # ensureMonthExists). Without this an expense filed into a missing month
    # broke the carry chain with start=0.
    local month_data month_exists
    month_data=$(get_summary "$month") || true
    month_exists=$(echo "$month_data" | jq -r '.Item.month.S // empty')

    if [ -z "$month_exists" ]; then
        local start="0"
        if [[ "$CARRY_OVER_BALANCE" != "false" ]]; then
            local pm prev_data prev
            pm=$(prev_month "$month")
            prev_data=$(get_summary "$pm") || true
            prev=$(echo "$prev_data" | jq -r '.Item.ending_balance.N // "0"')
            if [ -n "$prev" ] && [ "$prev" != "null" ]; then
                start=$(calc "$prev")
            fi
        fi
        echo "  Month $month doesn't exist, creating it (starting_balance=\$$start, \$0 allowance)..."
        local new_month_ts
        new_month_ts=$(now_iso)
        # Write canonical + MONTHLIST mirror together so the new month is
        # immediately visible in the app's month list.
        local new_month_tx
        new_month_tx=$(jq -n \
            --arg table    "$TABLE_NAME" \
            --arg pk_canon "MONTH#$month" \
            --arg pk_list  "MONTHLIST" \
            --arg sk_sum   "SUMMARY" \
            --arg sk_m     "$month" \
            --arg mon      "$month" \
            --arg s        "$start" \
            --arg ts       "$new_month_ts" \
            '{
                "TransactItems": [
                    {"Put": {
                        "TableName": $table,
                        "Item": {
                            "PK":               {"S": $pk_canon},
                            "SK":               {"S": $sk_sum},
                            "month":            {"S": $mon},
                            "starting_balance": {"N": $s},
                            "allowance_added":  {"N": "0"},
                            "total_expenses":   {"N": "0"},
                            "ending_balance":   {"N": $s},
                            "created_at":       {"S": $ts},
                            "updated_at":       {"S": $ts}
                        }
                    }},
                    {"Put": {
                        "TableName": $table,
                        "Item": {
                            "PK":               {"S": $pk_list},
                            "SK":               {"S": $sk_m},
                            "month":            {"S": $mon},
                            "starting_balance": {"N": $s},
                            "allowance_added":  {"N": "0"},
                            "total_expenses":   {"N": "0"},
                            "ending_balance":   {"N": $s},
                            "created_at":       {"S": $ts},
                            "updated_at":       {"S": $ts}
                        }
                    }}
                ]
            }')
        if [[ "$DRY_RUN" == "true" ]]; then
            echo "  [DRY-RUN] transact-write-items (new month canonical+MONTHLIST for expense):" >&2
            echo "$new_month_tx" | jq -c . >&2
        else
            aws dynamodb transact-write-items --region "$REGION" \
                --transact-items "$(echo "$new_month_tx" | jq -c '.TransactItems')" >/dev/null
        fi
    fi

    # Add the expense row.
    local expense_id amount_n
    expense_id=$(gen_expense_id)
    amount_n=$(calc "$amount")

    local exp_ts
    exp_ts=$(now_iso)

    # Determine the ConditionExpression for the month summary update.
    # When ALLOW_OVERSPENDING is false and --force is not set, mirror the
    # backend's check: ending_balance >= :amt (mirrors dynamodb.go ~838-840).
    local month_condition="attribute_exists(PK)"
    if [[ "$ALLOW_OVERSPENDING" == "false" && "$FORCE" != "true" ]]; then
        month_condition="attribute_exists(PK) AND ending_balance >= :amt"
    fi

    # Ensure the MONTHLIST mirror exists (legacy-table guard) before the
    # transact so its attribute_exists(PK) condition can't cancel it.
    if [[ "$DRY_RUN" != "true" ]]; then
        ensure_monthlist_mirror "$month" || true
    fi

    # Build a single transact-write-items: expense put + canonical summary
    # delta + MONTHLIST mirror delta + global balance delta.  The summary
    # update carries the overspend condition; the mirror update carries
    # attribute_exists(PK).  Mirrors the backend's AtomicAddExpense.
    local exp_tx
    exp_tx=$(jq -n \
        --arg table    "$TABLE_NAME" \
        --arg pk_canon "MONTH#$month" \
        --arg pk_list  "MONTHLIST" \
        --arg sk_sum   "SUMMARY" \
        --arg sk_m     "$month" \
        --arg pk_exp   "MONTH#$month" \
        --arg sk_exp   "$expense_id" \
        --arg amt      "$amount_n" \
        --arg desc     "$description" \
        --arg ts       "$exp_ts" \
        --arg month_cond "$month_condition" \
        '{
            "TransactItems": [
                {"Put": {
                    "TableName": $table,
                    "Item": {
                        "PK":          {"S": $pk_exp},
                        "SK":          {"S": $sk_exp},
                        "amount":      {"N": $amt},
                        "description": {"S": $desc},
                        "created_at":  {"S": $ts}
                    }
                }},
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": $pk_canon}, "SK": {"S": $sk_sum}},
                    "UpdateExpression": "SET total_expenses = total_expenses + :amt, ending_balance = ending_balance - :amt, updated_at = :u",
                    "ConditionExpression": $month_cond,
                    "ExpressionAttributeValues": {
                        ":amt": {"N": $amt},
                        ":u":   {"S": $ts}
                    }
                }},
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": $pk_list}, "SK": {"S": $sk_m}},
                    "UpdateExpression": "SET total_expenses = total_expenses + :amt, ending_balance = ending_balance - :amt, updated_at = :u",
                    "ConditionExpression": "attribute_exists(PK)",
                    "ExpressionAttributeValues": {
                        ":amt": {"N": $amt},
                        ":u":   {"S": $ts}
                    }
                }},
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}},
                    "UpdateExpression": "SET total_balance = if_not_exists(total_balance, :z) - :amt, updated_at = :u",
                    "ExpressionAttributeValues": {
                        ":amt": {"N": $amt},
                        ":z":   {"N": "0"},
                        ":u":   {"S": $ts}
                    }
                }}
            ]
        }')

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] transact-write-items (add_expense canonical+MONTHLIST+BALANCE):" >&2
        echo "$exp_tx" | jq -c . >&2
    else
        local EXP_TX_ERR
        EXP_TX_ERR=$(mktemp)
        if ! aws dynamodb transact-write-items --region "$REGION" \
            --transact-items "$(echo "$exp_tx" | jq -c '.TransactItems')" 2>"$EXP_TX_ERR"; then
            # Check if it was a ConditionalCheckFailed on the summary item (index 1).
            if grep -q "ConditionalCheckFailed" "$EXP_TX_ERR" 2>/dev/null; then
                local cur_bal
                cur_bal=$(get_summary "$month" | jq -r '.Item.ending_balance.N // "0"')
                echo "Error: insufficient funds (month $month balance \$$cur_bal is less than expense \$$amount_n); use --force to override." >&2
                rm -f "$EXP_TX_ERR"
                exit 1
            fi
            cat "$EXP_TX_ERR" >&2
            rm -f "$EXP_TX_ERR"
            exit 1
        fi
        rm -f "$EXP_TX_ERR"
    fi

    echo "  Recorded expense \$$amount_n in $month (id: $expense_id)"
}

# Set total balance (absolute value — explicit operator intent).
set_balance() {
    local balance="$1"
    validate_signed_amount "$balance"
    preflight
    local balance_n
    balance_n=$(calc "$balance")
    # Setting the balance directly overrides the value the app computes from
    # months; confirm so it isn't done by accident.
    confirm_destructive "yes" "Overwrite total balance with \$$balance_n? Type 'yes' to confirm: "
    echo "Setting total balance to $balance_n"

    aws_write dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$balance_n\"},
        \"updated_at\": {\"S\": \"$(now_iso)\"}
    }" >/dev/null
}

# Add funds to a month (delta-style writes; mirrors backend AtomicAddFunds).
add_funds() {
    local month="$1"
    local amount="$2"
    validate_month "$month"
    validate_amount "$amount"
    preflight
    load_settings

    local amount_n
    amount_n=$(calc "$amount")
    echo "Adding $amount_n funds to month $month"

    local current
    current=$(get_summary "$month") || true

    if [ -z "$current" ] || [ "$(echo "$current" | jq -r '.Item // empty')" = "" ]; then
        echo "Month $month not found. Creating it with funds=$amount_n"
        # A top-up creating the month: the requested amount IS the allowance.
        add_month "$month" "$amount_n" "0"
        return
    fi

    # Ensure MONTHLIST mirror exists before the transaction (legacy-table guard).
    if [[ "$DRY_RUN" != "true" ]]; then
        ensure_monthlist_mirror "$month" || true
    fi

    local funds_ts
    funds_ts=$(now_iso)
    # Delta update: allowance_added and ending_balance both += amount, mirrored
    # to the MONTHLIST row in the same transaction.
    local funds_tx
    funds_tx=$(jq -n \
        --arg table    "$TABLE_NAME" \
        --arg pk_canon "MONTH#$month" \
        --arg pk_list  "MONTHLIST" \
        --arg sk_sum   "SUMMARY" \
        --arg sk_m     "$month" \
        --arg amt      "$amount_n" \
        --arg ts       "$funds_ts" \
        '{
            "TransactItems": [
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": $pk_canon}, "SK": {"S": $sk_sum}},
                    "UpdateExpression": "SET allowance_added = allowance_added + :amt, ending_balance = ending_balance + :amt, updated_at = :u",
                    "ConditionExpression": "attribute_exists(PK)",
                    "ExpressionAttributeValues": {":amt": {"N": $amt}, ":u": {"S": $ts}}
                }},
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": $pk_list}, "SK": {"S": $sk_m}},
                    "UpdateExpression": "SET allowance_added = allowance_added + :amt, ending_balance = ending_balance + :amt, updated_at = :u",
                    "ConditionExpression": "attribute_exists(PK)",
                    "ExpressionAttributeValues": {":amt": {"N": $amt}, ":u": {"S": $ts}}
                }},
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}},
                    "UpdateExpression": "SET total_balance = if_not_exists(total_balance, :z) + :amt, updated_at = :u",
                    "ExpressionAttributeValues": {":amt": {"N": $amt}, ":z": {"N": "0"}, ":u": {"S": $ts}}
                }}
            ]
        }')
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] transact-write-items (add_funds canonical+MONTHLIST+BALANCE):" >&2
        echo "$funds_tx" | jq -c . >&2
    else
        aws dynamodb transact-write-items --region "$REGION" \
            --transact-items "$(echo "$funds_tx" | jq -c '.TransactItems')" >/dev/null
    fi

    echo "  Added \$$amount_n to $month allowance and total balance."

    # Allowance change shifts later months' carry chain.
    recompute_carry_chain "$month"
}

# Remove funds from a month (delta-style writes).
remove_funds() {
    local month="$1"
    local amount="$2"
    validate_month "$month"
    validate_amount "$amount"
    preflight
    load_settings

    local amount_n current
    amount_n=$(calc "$amount")
    echo "Removing $amount_n from month $month"

    current=$(get_summary "$month") || true
    if [ -z "$current" ] || [ "$(echo "$current" | jq -r '.Item // empty')" = "" ]; then
        echo "Error: Month $month not found" >&2
        exit 1
    fi

    local current_allowance new_allowance
    current_allowance=$(echo "$current" | jq -r '.Item.allowance_added.N // "0"')
    new_allowance=$(calc "$current_allowance - $amount_n")
    if num_gt 0 "$new_allowance"; then
        echo "Error: cannot remove more than current allowance (\$$current_allowance)" >&2
        exit 1
    fi

    # Ensure MONTHLIST mirror exists before the transaction (legacy-table guard).
    if [[ "$DRY_RUN" != "true" ]]; then
        ensure_monthlist_mirror "$month" || true
    fi

    local rmfunds_ts
    rmfunds_ts=$(now_iso)
    # Delta update: allowance_added and ending_balance both -= amount, mirrored
    # to the MONTHLIST row in the same transaction.
    local rmfunds_tx
    rmfunds_tx=$(jq -n \
        --arg table    "$TABLE_NAME" \
        --arg pk_canon "MONTH#$month" \
        --arg pk_list  "MONTHLIST" \
        --arg sk_sum   "SUMMARY" \
        --arg sk_m     "$month" \
        --arg amt      "$amount_n" \
        --arg ts       "$rmfunds_ts" \
        '{
            "TransactItems": [
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": $pk_canon}, "SK": {"S": $sk_sum}},
                    "UpdateExpression": "SET allowance_added = allowance_added - :amt, ending_balance = ending_balance - :amt, updated_at = :u",
                    "ConditionExpression": "attribute_exists(PK)",
                    "ExpressionAttributeValues": {":amt": {"N": $amt}, ":u": {"S": $ts}}
                }},
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": $pk_list}, "SK": {"S": $sk_m}},
                    "UpdateExpression": "SET allowance_added = allowance_added - :amt, ending_balance = ending_balance - :amt, updated_at = :u",
                    "ConditionExpression": "attribute_exists(PK)",
                    "ExpressionAttributeValues": {":amt": {"N": $amt}, ":u": {"S": $ts}}
                }},
                {"Update": {
                    "TableName": $table,
                    "Key": {"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}},
                    "UpdateExpression": "SET total_balance = if_not_exists(total_balance, :z) - :amt, updated_at = :u",
                    "ExpressionAttributeValues": {":amt": {"N": $amt}, ":z": {"N": "0"}, ":u": {"S": $ts}}
                }}
            ]
        }')
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] transact-write-items (remove_funds canonical+MONTHLIST+BALANCE):" >&2
        echo "$rmfunds_tx" | jq -c . >&2
    else
        aws dynamodb transact-write-items --region "$REGION" \
            --transact-items "$(echo "$rmfunds_tx" | jq -c '.TransactItems')" >/dev/null
    fi

    echo "  Removed \$$amount_n from $month allowance and total balance."

    # Allowance change shifts later months' carry chain.
    recompute_carry_chain "$month"
}

# Delete a month and all its expense rows.
delete_month() {
    local month="$1"
    validate_month "$month"
    preflight

    echo "Deleting month $month and all its expenses"

    local month_data
    month_data=$(get_summary "$month") || true
    if [ -z "$month_data" ] || [ "$(echo "$month_data" | jq -r '.Item // empty')" = "" ]; then
        echo "Error: Month $month not found" >&2
        exit 1
    fi

    # rmmonth deletes the month summary AND every expense in it — confirm.
    confirm_destructive "DELETE" "Delete month $month and ALL its expenses? Type 'DELETE' to confirm: "

    local items count
    items=$(aws dynamodb query --table-name "$TABLE_NAME" --region "$REGION" \
        --key-condition-expression "PK = :pk" \
        --expression-attribute-values "{\":pk\": {\"S\": \"MONTH#$month\"}}" \
        --projection-expression "PK, SK" \
        --output json 2>/dev/null)
    count=$(echo "$items" | jq -r '.Items | length')
    echo "  Deleting $count item(s)..."

    echo "$items" | jq -c '.Items[]' | while IFS= read -r item; do
        local pk sk
        pk=$(echo "$item" | jq -r '.PK.S')
        sk=$(echo "$item" | jq -r '.SK.S')
        aws_write dynamodb delete-item --table-name "$TABLE_NAME" --region "$REGION" \
            --key "{\"PK\": {\"S\": \"$pk\"}, \"SK\": {\"S\": \"$sk\"}}" >/dev/null
    done

    # Also delete the MONTHLIST mirror row so the deleted month no longer
    # appears in the app's month list (mirrors AtomicDeleteMonth in backend).
    aws_write dynamodb delete-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTHLIST\"}, \"SK\": {\"S\": \"$month\"}}" >/dev/null

    # Deleting a month breaks the carry chain for later months.
    recompute_carry_chain "$(prev_month "$month")"

    # Recalculate total balance.
    recalc_balance

    echo "Month $month deleted"
}

# Show all data.
show_data() {
    preflight
    echo "=== All Data in $TABLE_NAME ==="
    aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --output json | jq -r '.Items[] | "\(.PK.S)/\(.SK.S): \(del(.PK, .SK) | to_entries | map("\(.key)=\(.value.N // .value.S)") | join(", "))"' | sort
}

# Export all data to JSON file.
#
# - Uses the CLI's built-in pagination (it aggregates pages into .Items).
# - Filters out SESSION#* and RATELIMIT#* rows (transient — restoring them
#   would not log the user back in anyway). Both the new "RATELIMIT#" prefix
#   and the legacy bare "RATELIMIT" PK are matched.
# - Sets restrictive file permissions (0600) and warns that the export still
#   contains the PIN hash (CONFIG row). Treat as a credential. The umask is
#   saved and restored so it doesn't leak to anything that sources this.
export_data() {
    local output_file="$1"
    preflight

    if [ -z "$output_file" ]; then
        output_file="passbook-backup-$(date +%Y%m%d-%H%M%S).json"
    fi

    echo "Exporting data to $output_file..."

    local all_items total
    all_items=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" --output json 2>/dev/null | jq '.Items')
    if [ -z "$all_items" ] || [ "$all_items" = "null" ]; then
        echo "Error: scan returned empty result" >&2
        exit 1
    fi
    total=$(echo "$all_items" | jq 'length')

    # Filter out transient auth state (new prefixed + legacy bare keys).
    local filtered kept skipped
    filtered=$(echo "$all_items" | jq '[.[] | select((.PK.S // "") as $pk | ($pk | startswith("SESSION#")) or ($pk | startswith("RATELIMIT#")) or ($pk == "RATELIMIT") | not)]')
    kept=$(echo "$filtered" | jq 'length')
    skipped=$((total - kept))

    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] would write $kept items (skip $skipped transient) to $output_file" >&2
        return 0
    fi

    # Restrictive perms on creation; backup contains PIN hash. Save and
    # restore the umask so this side effect doesn't leak.
    local old_umask
    old_umask=$(umask)
    umask 077
    cat <<EOF | jq '.' > "$output_file"
{
  "export_info": {
    "table_name": "$TABLE_NAME",
    "region": "$REGION",
    "exported_at": "$(now_iso)",
    "item_count": $kept,
    "skipped_transient": $skipped,
    "warning": "Contains CONFIG.pin_hash — treat this file as a credential."
  },
  "items": $filtered
}
EOF
    umask "$old_umask"

    echo "Exported $kept items to $output_file ($skipped transient SESSION/RATELIMIT rows skipped)"
    echo "NOTE: Backup contains the PIN hash. File permissions set to 600. Do not commit or share."
}

# Import data from JSON file.
#
# Compares the backup's export_info.table_name against the target table and
# requires explicit typed confirmation on a mismatch (cross-instance restore).
import_data() {
    local input_file="$1"
    preflight

    if [ -z "$input_file" ]; then
        echo "Error: Input file required" >&2
        exit 1
    fi
    if [ ! -f "$input_file" ]; then
        echo "Error: File not found: $input_file" >&2
        exit 1
    fi

    local item_count
    item_count=$(jq -r '.items | length' "$input_file" 2>/dev/null)
    if [ -z "$item_count" ] || [ "$item_count" = "null" ]; then
        echo "Error: Invalid backup file format" >&2
        exit 1
    fi

    # Cross-instance guard: warn + require typed confirmation if the backup
    # was taken from a different table than the one we're importing into.
    local backup_table
    backup_table=$(jq -r '.export_info.table_name // ""' "$input_file" 2>/dev/null)
    if [ -n "$backup_table" ] && [ "$backup_table" != "$TABLE_NAME" ]; then
        echo "WARNING: backup was exported from table '$backup_table'," >&2
        echo "         but you are importing into '$TABLE_NAME'." >&2
        echo "         This will copy one instance's data (including its PIN hash) into another." >&2
        if [[ "$DRY_RUN" != "true" ]]; then
            read -r -p "Type the destination table name ('$TABLE_NAME') to confirm: " confirm_tbl
            if [ "$confirm_tbl" != "$TABLE_NAME" ]; then
                echo "Aborted (confirmation did not match)." >&2
                exit 1
            fi
        fi
    fi

    echo "Importing $item_count items from $input_file..."

    # Counters live in tmp files because `jq | while` runs the loop body in a
    # subshell — plain shell variables don't survive that scope.
    local tmpdir
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' RETURN
    echo 0 > "$tmpdir/success"
    echo 0 > "$tmpdir/failed"

    while IFS= read -r item; do
        if [[ "$DRY_RUN" == "true" ]]; then
            echo "  [DRY-RUN] would put $(echo "$item" | jq -r '.PK.S + "/" + .SK.S')"
            echo $(( $(cat "$tmpdir/success") + 1 )) > "$tmpdir/success"
            continue
        fi
        if aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" \
            --item "$item" 2>/dev/null; then
            echo $(( $(cat "$tmpdir/success") + 1 )) > "$tmpdir/success"
        else
            echo $(( $(cat "$tmpdir/failed") + 1 )) > "$tmpdir/failed"
            echo "  Failed to import: $(echo "$item" | jq -r '.PK.S + "/" + .SK.S')"
        fi
    done < <(jq -c '.items[]' "$input_file")

    local s f
    s=$(cat "$tmpdir/success")
    f=$(cat "$tmpdir/failed")
    echo "Import complete: $s succeeded, $f failed"

    if [ "$f" -gt 0 ]; then
        echo "Error: $f item(s) failed to import — review log above" >&2
        exit 1
    fi

    # Regenerate MONTHLIST mirrors if the backup predates the MONTHLIST scheme
    # (i.e. no MONTHLIST rows were present in the backup file).  For each
    # canonical MONTH#*/SUMMARY row imported, write a matching
    # PK=MONTHLIST/SK=<yyyy-mm> copy if one is not already present.
    local has_monthlist
    has_monthlist=$(jq -r '[.items[] | select(.PK.S == "MONTHLIST")] | length' "$input_file" 2>/dev/null || echo "0")
    if [ "$has_monthlist" = "0" ]; then
        echo "Backup contains no MONTHLIST rows — regenerating mirrors from imported canonical summaries..."
        local regenerated=0
        while IFS= read -r item; do
            # The jq filter already selected MONTH#*/SUMMARY rows; read the
            # month value from the item's month attribute (not SK, which is
            # always "SUMMARY").
            local mon
            mon=$(echo "$item" | jq -r '.month.S // empty')
            [[ -z "$mon" ]] && continue
            # Build the mirror item: identical attributes, different PK/SK.
            local mirror_item
            mirror_item=$(echo "$item" | jq -c '.PK.S = "MONTHLIST" | .SK.S = .month.S')
            if [[ "$DRY_RUN" == "true" ]]; then
                echo "  [DRY-RUN] would put MONTHLIST/$mon mirror" >&2
                regenerated=$((regenerated + 1))
            else
                if aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" \
                    --item "$mirror_item" \
                    --condition-expression "attribute_not_exists(PK)" 2>/dev/null; then
                    regenerated=$((regenerated + 1))
                else
                    # Mirror already exists (concurrent or re-import) — not an error.
                    regenerated=$((regenerated + 1))
                fi
            fi
        done < <(jq -c '.items[] | select(.PK.S | startswith("MONTH#")) | select(.SK.S == "SUMMARY")' "$input_file")
        echo "  Regenerated $regenerated MONTHLIST mirror(s)."
    fi

    # Offer to recalc the total balance after a successful import: the
    # restored BALANCE row may not match the restored month summaries.
    if [[ "$DRY_RUN" != "true" ]]; then
        read -r -p "Recalculate total balance from restored months now? (y/N): " do_recalc
        if [[ "$do_recalc" =~ ^[Yy]$ ]]; then
            recalc_balance
        fi
    fi
}

# Show help if no command provided.
if [[ -z "${1:-}" ]]; then
    show_help
    exit 0
fi

# Main command dispatch ("${1:-}": flags-only invocations leave $# = 0,
# which must reach the usage branch, not trip set -u).
case "${1:-}" in
    month)
        if [ $# -ne 4 ]; then
            echo "Usage: $0 --instance <name> month YYYY-MM allowance expenses" >&2
            echo "  Starting balance is auto-calculated from previous month" >&2
            exit 1
        fi
        add_month "$2" "$3" "$4"
        ;;
    expense)
        if [ $# -lt 4 ]; then
            echo "Usage: $0 --instance <name> expense YYYY-MM amount description" >&2
            exit 1
        fi
        # Allow --force anywhere after the command (e.g., after the description).
        # Strip it from the description words so it doesn't appear in the expense text.
        _exp_desc_parts=()
        for _exp_arg in "${@:4}"; do
            if [[ "$_exp_arg" == "--force" ]]; then
                FORCE=true
            else
                _exp_desc_parts+=("$_exp_arg")
            fi
        done
        add_expense "$2" "$3" "${_exp_desc_parts[*]}"
        ;;
    balance)
        if [ $# -ne 2 ]; then
            echo "Usage: $0 --instance <name> balance amount" >&2
            exit 1
        fi
        set_balance "$2"
        ;;
    funds)
        if [ $# -ne 3 ]; then
            echo "Usage: $0 --instance <name> funds YYYY-MM amount" >&2
            exit 1
        fi
        add_funds "$2" "$3"
        ;;
    rmfunds)
        if [ $# -ne 3 ]; then
            echo "Usage: $0 --instance <name> rmfunds YYYY-MM amount" >&2
            exit 1
        fi
        remove_funds "$2" "$3"
        ;;
    rmmonth)
        if [ $# -ne 2 ]; then
            echo "Usage: $0 --instance <name> rmmonth YYYY-MM" >&2
            exit 1
        fi
        delete_month "$2"
        ;;
    show)
        show_data
        ;;
    export)
        # Filename is optional — export_data generates a timestamped one.
        export_data "${2:-}"
        ;;
    import)
        if [ $# -ne 2 ]; then
            echo "Usage: $0 --instance <name> import <file.json>" >&2
            exit 1
        fi
        import_data "$2"
        ;;
    recalc)
        recalc_balance
        ;;
    *)
        echo "Error: unknown command '$1'" >&2
        echo "Run '$0 --help' for usage." >&2
        exit 1
        ;;
esac
