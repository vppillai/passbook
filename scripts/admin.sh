#!/bin/bash
# Passbook Admin TUI
# Interactive terminal interface for managing passbook data.
#
# This is a THIN TUI. Every data operation (month/expense/funds/rmfunds/
# delete/export/import/recalc/balance) is delegated to add-data.sh, which is
# the single bash implementation of those operations. admin.sh owns only:
#   - the menu and summary display
#   - input prompts and the destructive-action confirmations
#   - PIN reset / session clearing (admin-only, not in add-data.sh)
# This removes the ~300 lines that used to be duplicated (and had drifted)
# between the two scripts.

set -euo pipefail

show_help() {
    cat << 'EOF'
Passbook Admin TUI - Interactive data management

Usage: ./scripts/admin.sh --instance <name> [options]

Options:
  -i, --instance <name>   Instance name (required)
  --region <region>       AWS region (default: us-west-2)
  -h, --help              Show this help message

Description:
  Interactive terminal interface for managing passbook data in DynamoDB.
  Provides a menu-driven interface for common operations. All data writes
  are delegated to add-data.sh.

Features:
  - View total balance and monthly history
  - Add/update months with allowance
  - Add expenses to any month
  - Add or remove funds
  - Delete months and all associated expenses
  - Set total balance directly
  - View detailed expenses for any month
  - Export all data to JSON backup
  - Import data from JSON backup
  - Reset PIN / Clear sessions

Prerequisites:
  - AWS CLI v2 configured with credentials
  - jq (JSON processor)
  - awk (POSIX, preinstalled everywhere)
  - xxd (for expense ID generation, used by add-data.sh)

Example:
  ./scripts/admin.sh --instance kids

For non-interactive CLI operations, use:
  ./scripts/add-data.sh --help
EOF
}

REGION="us-west-2"
INSTANCE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--instance)
            INSTANCE="${2:?--instance requires a value}"; shift 2 ;;
        --region)
            REGION="${2:?--region requires a value}"; shift 2 ;;
        -h|--help)
            show_help
            exit 0 ;;
        *)
            echo "Error: unknown option '$1'" >&2
            echo "Run '$0 --help' for usage." >&2
            exit 1 ;;
    esac
done

if [[ -z "$INSTANCE" ]]; then
    echo "Error: --instance <name> required (e.g., --instance kids)" >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1
fi

TABLE_NAME="passbook-${INSTANCE}-prod"

# Resolve add-data.sh relative to THIS script's directory so the TUI works
# regardless of the caller's working directory.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADD_DATA="$SCRIPT_DIR/add-data.sh"
if [[ ! -x "$ADD_DATA" ]]; then
    echo "Error: add-data.sh not found or not executable at $ADD_DATA" >&2
    exit 1
fi

# Fail fast if a required tool is missing. Degrading mid-run causes
# PARTIAL WRITES — refuse up front instead. xxd is used by add-data.sh
# for expense ID generation.
for tool in aws jq awk xxd; do
    command -v "$tool" >/dev/null 2>&1 || { echo "Error: required tool '$tool' not found" >&2; exit 1; }
done

# AWS preflight: verify credentials and that the table exists BEFORE the
# menu opens. Without this, wrong/expired credentials render as "$0 / no
# months" instead of an error, and any write would fail mid-flight.
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

# calc / num_gt — decimal arithmetic for the summary display only. LC_ALL=C
# pins the decimal point to '.' regardless of the operator's locale.
calc() { LC_ALL=C awk "BEGIN { printf \"%.2f\", $* }"; }
num_gt() { LC_ALL=C awk "BEGIN { exit !($1 > $2) }"; }

# run_add_data CMD ARGS... — delegate a data operation to add-data.sh with
# the current instance/region. Returns add-data.sh's exit status.
run_add_data() {
    "$ADD_DATA" --instance "$INSTANCE" --region "$REGION" "$@"
}

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Clear screen and show header. `clear` can fail under an unknown TERM
# (e.g. when piped or run in a bare environment); don't let that abort the
# script under set -e.
show_header() {
    clear 2>/dev/null || true
    echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}     ${BOLD}Passbook Admin Console${NC}                 ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
    echo -e "Instance: ${BOLD}${INSTANCE}${NC}"
    echo ""
}

# Show current data summary (read-only).
show_summary() {
    echo -e "${CYAN}Loading data...${NC}"

    local balance_data total_balance months_data
    balance_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null || echo "")
    total_balance=$(echo "$balance_data" | jq -r '.Item.total_balance.N // "0"')

    months_data=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --filter-expression "begins_with(PK, :pk) AND SK = :sk" \
        --expression-attribute-values '{":pk": {"S": "MONTH#"}, ":sk": {"S": "SUMMARY"}}' \
        --output json 2>/dev/null || echo "")

    show_header
    echo -e "${GREEN}Total Balance: \$${total_balance}${NC}"
    echo ""
    echo -e "${BOLD}Monthly History:${NC}"
    echo ""

    local count
    count=$(echo "$months_data" | jq -r '.Items | length' 2>/dev/null || echo "0")
    if [ -z "$count" ] || [ "$count" = "0" ]; then
        echo "  No months found"
    else
        printf "${BOLD}  %-10s │ %10s │ %10s │ %10s │ %10s │ %10s${NC}\n" \
            "Month" "Starting" "Allowance" "Expenses" "Ending" "Saved"
        echo "  ───────────┼────────────┼────────────┼────────────┼────────────┼────────────"

        echo "$months_data" | jq -r '.Items | sort_by(.month.S) | reverse | .[] |
            "\(.month.S)|\(.starting_balance.N)|\(.allowance_added.N)|\(.total_expenses.N)|\(.ending_balance.N)"' 2>/dev/null | \
        while IFS='|' read -r month start allow exp ending; do
            local saved
            saved=$(calc "$ending - $start")
            printf "  %-10s │ %10s │ %10s │ %10s │ %10s │ ${GREEN}%10s${NC}\n" \
                "$month" "\$$start" "+\$$allow" "-\$$exp" "\$$ending" "\$$saved"
        done
    fi
    echo ""
}

# Prompt for input with validation. printf -v assigns WITHOUT evaluating the
# input (so an apostrophe in a description can't break anything); read -r
# keeps backslashes literal.
prompt() {
    local message="$1"
    local var_name="$2"
    local default="$3"

    if [ -n "$default" ]; then
        echo -ne "${YELLOW}$message${NC} [${default}]: "
    else
        echo -ne "${YELLOW}$message${NC}: "
    fi
    local input
    read -r input

    if [ -z "$input" ] && [ -n "$default" ]; then
        printf -v "$var_name" '%s' "$default"
    else
        printf -v "$var_name" '%s' "$input"
    fi
}

# Pause and wait for key
pause() {
    echo ""
    echo -ne "${CYAN}Press Enter to continue...${NC}"
    read -r _
}

# Add/Update a month — delegates to add-data.sh `month`.
action_add_month() {
    show_header
    echo -e "${BOLD}Add/Update Month Summary${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month month allowance expenses
    current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"
    prompt "Allowance added" allowance "100"
    prompt "Total expenses" expenses "0"

    echo ""
    # add-data.sh validates, refuses to clobber a month that has expenses
    # (offering funds instead), recomputes later months' carry chain, and
    # recalculates the total balance.
    if run_add_data month "$month" "$allowance" "$expenses"; then
        echo -e "${GREEN}✓ Month $month added/updated${NC}"
    else
        echo -e "${RED}✗ Failed to add/update month $month (see message above)${NC}"
    fi
    pause
}

# Add an expense — delegates to add-data.sh `expense`.
action_add_expense() {
    show_header
    echo -e "${BOLD}Add Expense${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month month amount description
    current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"
    prompt "Amount" amount ""
    prompt "Description" description ""

    if [ -z "$amount" ] || [ -z "$description" ]; then
        echo -e "${RED}Error: Amount and description are required${NC}"
        pause
        return
    fi

    echo ""
    if run_add_data expense "$month" "$amount" "$description"; then
        echo -e "${GREEN}✓ Expense added: \$$amount for '$description'${NC}"
    else
        echo -e "${RED}✗ Failed to add expense (see message above)${NC}"
    fi
    pause
}

# Add funds — delegates to add-data.sh `funds`.
action_add_funds() {
    show_header
    echo -e "${BOLD}Add Funds${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month month amount
    current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"
    prompt "Amount to add" amount ""

    if [ -z "$amount" ]; then
        echo -e "${RED}Error: Amount is required${NC}"
        pause
        return
    fi

    echo ""
    if run_add_data funds "$month" "$amount"; then
        echo -e "${GREEN}✓ Added \$$amount to $month${NC}"
    else
        echo -e "${RED}✗ Failed to add funds (see message above)${NC}"
    fi
    pause
}

# Remove funds — delegates to add-data.sh `rmfunds`.
action_remove_funds() {
    show_header
    echo -e "${BOLD}Remove Funds${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month month amount
    current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"
    prompt "Amount to remove" amount ""

    if [ -z "$amount" ]; then
        echo -e "${RED}Error: Amount is required${NC}"
        pause
        return
    fi

    echo ""
    if run_add_data rmfunds "$month" "$amount"; then
        echo -e "${GREEN}✓ Removed \$$amount from $month${NC}"
    else
        echo -e "${RED}✗ Failed to remove funds (see message above)${NC}"
    fi
    pause
}

# Set total balance — delegates to add-data.sh `balance`.
action_set_balance() {
    show_header
    echo -e "${BOLD}Set Total Balance${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local balance_item current_total new_balance
    balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null || echo "")
    current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')

    echo -e "Current total balance: ${GREEN}\$$current_total${NC}"
    echo ""
    prompt "New total balance" new_balance ""

    if [ -z "$new_balance" ]; then
        echo -e "${RED}Error: Balance is required${NC}"
        pause
        return
    fi

    # The operator entered the value deliberately after seeing the current
    # balance; pass --yes so add-data.sh doesn't prompt again.
    if run_add_data --yes balance "$new_balance"; then
        echo -e "${GREEN}✓ Total balance set to \$$new_balance${NC}"
    else
        echo -e "${RED}✗ Failed to set balance (see message above)${NC}"
    fi
    pause
}

# Delete a month — TUI confirmation, then delegates to add-data.sh `rmmonth`.
action_delete_month() {
    show_header
    echo -e "${BOLD}${RED}Delete Month${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo -e "${YELLOW}Warning: This will delete the month summary and ALL expenses for that month.${NC}"
    echo ""

    local month
    prompt "Month to delete (YYYY-MM)" month ""

    if [ -z "$month" ]; then
        echo -e "${RED}Error: Month is required${NC}"
        pause
        return
    fi

    local month_data
    month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null || echo "")

    if [ -z "$month_data" ] || [ "$(echo "$month_data" | jq -r '.Item // empty')" = "" ]; then
        echo -e "${RED}Month $month not found${NC}"
        pause
        return
    fi

    local ending_balance confirm
    ending_balance=$(echo "$month_data" | jq -r '.Item.ending_balance.N // "0"')
    echo ""
    echo "Month $month has ending balance: \$$ending_balance"
    prompt "Type 'DELETE' to confirm" confirm ""

    if [ "$confirm" = "DELETE" ]; then
        # Already confirmed at the TUI; pass --yes so add-data.sh doesn't
        # prompt again.
        if run_add_data --yes rmmonth "$month"; then
            echo -e "${GREEN}✓ Month $month deleted${NC}"
        else
            echo -e "${RED}✗ Failed to delete month (see message above)${NC}"
        fi
    else
        echo "Cancelled."
    fi
    pause
}

# View expenses for a month (read-only).
action_view_expenses() {
    show_header
    echo -e "${BOLD}View Month Expenses${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month month
    current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"

    echo ""
    echo -e "${CYAN}Loading expenses for $month...${NC}"
    echo ""

    local expenses summary
    expenses=$(aws dynamodb query --table-name "$TABLE_NAME" --region "$REGION" \
        --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
        --expression-attribute-values "{\":pk\": {\"S\": \"MONTH#$month\"}, \":sk\": {\"S\": \"EXP#\"}}" \
        --output json 2>/dev/null || echo "")

    summary=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null || echo "")

    if [ -n "$summary" ] && [ "$summary" != "{}" ]; then
        echo -e "${BOLD}Month Summary:${NC}"
        echo "  Starting balance: \$$(echo "$summary" | jq -r '.Item.starting_balance.N // "0"')"
        echo "  Allowance added:  \$$(echo "$summary" | jq -r '.Item.allowance_added.N // "0"')"
        echo "  Total expenses:   \$$(echo "$summary" | jq -r '.Item.total_expenses.N // "0"')"
        echo "  Ending balance:   \$$(echo "$summary" | jq -r '.Item.ending_balance.N // "0"')"
        echo ""
    fi

    echo -e "${BOLD}Expenses:${NC}"
    echo "─────────────────────────────────────────────"

    local count
    count=$(echo "$expenses" | jq -r '.Items | length' 2>/dev/null || echo "0")
    if [ "$count" = "0" ] || [ -z "$count" ]; then
        echo "  No expenses found for $month"
    else
        echo "$expenses" | jq -r '.Items | sort_by(.created_at.S) | .[] |
            "  \(.created_at.S | split("T")[0])  │  $\(.amount.N)  │  \(.description.S)"'
    fi
    echo ""
    pause
}

# Export data — delegates to add-data.sh `export`.
action_export_data() {
    show_header
    echo -e "${BOLD}Export Data${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local default_file output_file
    default_file="passbook-backup-$(date +%Y%m%d-%H%M%S).json"
    prompt "Output file" output_file "$default_file"

    echo ""
    if run_add_data export "$output_file"; then
        echo -e "${GREEN}✓ Export complete${NC}"
    else
        echo -e "${RED}✗ Export failed (see message above)${NC}"
    fi
    pause
}

# Import data — TUI confirmation (IMPORT), then delegates to add-data.sh.
action_import_data() {
    show_header
    echo -e "${BOLD}${YELLOW}Import Data${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo -e "${RED}Warning: This will ADD items to the database.${NC}"
    echo -e "${RED}Existing items with the same keys will be OVERWRITTEN.${NC}"
    echo ""

    local input_file
    prompt "Input file" input_file ""

    if [ -z "$input_file" ]; then
        echo -e "${RED}Error: File path is required${NC}"
        pause
        return
    fi
    if [ ! -f "$input_file" ]; then
        echo -e "${RED}Error: File not found: $input_file${NC}"
        pause
        return
    fi

    local item_count
    item_count=$(jq -r '.items | length' "$input_file" 2>/dev/null || echo "")
    if [ -z "$item_count" ] || [ "$item_count" = "null" ]; then
        echo -e "${RED}Error: Invalid backup file format${NC}"
        pause
        return
    fi

    echo ""
    echo "File contains $item_count items"
    echo ""
    local confirm
    prompt "Type 'IMPORT' to confirm" confirm ""

    if [ "$confirm" != "IMPORT" ]; then
        echo "Cancelled."
        pause
        return
    fi

    echo ""
    # add-data.sh checks the backup's table_name against the target, requires
    # a typed confirmation on mismatch, and offers a post-import recalc.
    if run_add_data import "$input_file"; then
        echo -e "${GREEN}✓ Import complete${NC}"
    else
        echo -e "${RED}✗ Import completed with errors (see message above)${NC}"
    fi
    pause
}

# Recalculate total balance — delegates to add-data.sh `recalc`.
action_recalc() {
    echo ""
    if run_add_data recalc; then
        echo -e "${GREEN}✓ Balance recalculated${NC}"
    else
        echo -e "${RED}✗ Recalc failed (see message above)${NC}"
    fi
    pause
}

# ---- Admin-only operations (PIN/sessions) — kept local ----------------------

# Reset PIN
action_reset_pin() {
    show_header
    echo -e "${BOLD}${RED}Reset PIN${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo -e "${YELLOW}Warning: This will delete the current PIN configuration.${NC}"
    echo "The user will need to set up a new PIN on next login."
    echo ""
    local confirm
    prompt "Type 'RESET' to confirm" confirm ""

    if [ "$confirm" = "RESET" ]; then
        aws dynamodb delete-item --table-name "$TABLE_NAME" --region "$REGION" \
            --key '{"PK": {"S": "CONFIG"}, "SK": {"S": "CONFIG"}}'
        echo -e "${GREEN}✓ PIN configuration deleted${NC}"
    else
        echo "Cancelled."
    fi
    pause
}

# Clear all sessions
action_clear_sessions() {
    show_header
    echo -e "${BOLD}Clear All Sessions${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo "This will log out all active sessions."
    local confirm
    prompt "Type 'YES' to confirm" confirm ""

    if [ "$confirm" = "YES" ]; then
        echo -e "${CYAN}Scanning for sessions...${NC}"
        local sessions count
        sessions=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
            --filter-expression "begins_with(PK, :pk)" \
            --expression-attribute-values '{":pk": {"S": "SESSION#"}}' \
            --projection-expression "PK, SK" \
            --output json 2>/dev/null || echo "")

        count=$(echo "$sessions" | jq -r '.Items | length' 2>/dev/null || echo "0")
        if [ "$count" = "0" ] || [ -z "$count" ]; then
            echo "No active sessions found."
        else
            echo "Deleting $count session(s)..."
            echo "$sessions" | jq -c '.Items[]' | while IFS= read -r item; do
                local pk sk
                pk=$(echo "$item" | jq -r '.PK.S')
                sk=$(echo "$item" | jq -r '.SK.S')
                aws dynamodb delete-item --table-name "$TABLE_NAME" --region "$REGION" \
                    --key "{\"PK\": {\"S\": \"$pk\"}, \"SK\": {\"S\": \"$sk\"}}"
            done
            echo -e "${GREEN}✓ Sessions cleared${NC}"
        fi
    else
        echo "Cancelled."
    fi
    pause
}

# Admin submenu for PIN and sessions
action_admin_menu() {
    show_header
    echo -e "${BOLD}Admin Options${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo "  1) Reset PIN"
    echo "  2) Clear all sessions"
    echo "  b) Back to main menu"
    echo ""
    echo -ne "${YELLOW}Select option:${NC} "
    local choice
    read -r choice

    case "$choice" in
        1) action_reset_pin ;;
        2) action_clear_sessions ;;
        b|B) return ;;
        *) echo -e "${RED}Invalid option${NC}"; sleep 1 ;;
    esac
}

# Main menu
main_menu() {
    while true; do
        show_summary

        echo -e "${BOLD}Actions:${NC}"
        echo "─────────────────────────────────────────────"
        echo "  1) Add/Update month      6) Set total balance"
        echo "  2) Add expense           7) View month expenses"
        echo "  3) Add funds             8) Export data"
        echo "  4) Remove funds          9) Import data"
        echo "  5) Delete month          r) Recalculate balance"
        echo "  0) Admin (PIN/Sessions)  q) Quit"
        echo ""
        echo -ne "${YELLOW}Select option:${NC} "
        local choice
        read -r choice

        case "$choice" in
            1) action_add_month ;;
            2) action_add_expense ;;
            3) action_add_funds ;;
            4) action_remove_funds ;;
            5) action_delete_month ;;
            6) action_set_balance ;;
            7) action_view_expenses ;;
            8) action_export_data ;;
            9) action_import_data ;;
            r|R) action_recalc ;;
            0) action_admin_menu ;;
            q|Q)
                clear 2>/dev/null || true
                echo "Goodbye!"
                exit 0
                ;;
            *)
                echo -e "${RED}Invalid option${NC}"
                sleep 1
                ;;
        esac
    done
}

# Entry point
main_menu
