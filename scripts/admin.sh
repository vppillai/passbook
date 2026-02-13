#!/bin/bash
# Passbook Admin TUI
# Interactive terminal interface for managing passbook data
#
# Usage: ./scripts/admin.sh

TABLE_NAME="passbook-prod"
REGION="us-west-2"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Clear screen and show header
show_header() {
    clear
    echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}     ${BOLD}Passbook Admin Console${NC}                 ${BLUE}║${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
    echo ""
}

# Show current data summary
show_summary() {
    echo -e "${CYAN}Loading data...${NC}"

    local balance_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null)

    local total_balance=$(echo "$balance_data" | jq -r '.Item.total_balance.N // "0"')

    local months_data=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --filter-expression "begins_with(PK, :pk) AND SK = :sk" \
        --expression-attribute-values '{":pk": {"S": "MONTH#"}, ":sk": {"S": "SUMMARY"}}' \
        --output json 2>/dev/null)

    show_header
    echo -e "${GREEN}Total Balance: \$${total_balance}${NC}"
    echo ""
    echo -e "${BOLD}Monthly History:${NC}"
    echo ""

    local count=$(echo "$months_data" | jq -r '.Items | length' 2>/dev/null)
    if [ -z "$count" ] || [ "$count" = "0" ]; then
        echo "  No months found"
    else
        # Print table header
        printf "${BOLD}  %-10s │ %10s │ %10s │ %10s │ %10s │ %10s${NC}\n" \
            "Month" "Starting" "Allowance" "Expenses" "Ending" "Saved"
        echo "  ───────────┼────────────┼────────────┼────────────┼────────────┼────────────"

        # Print each month row
        echo "$months_data" | jq -r '.Items | sort_by(.month.S) | reverse | .[] |
            "\(.month.S)|\(.starting_balance.N)|\(.allowance_added.N)|\(.total_expenses.N)|\(.ending_balance.N)"' 2>/dev/null | \
        while IFS='|' read -r month start allow exp ending; do
            saved=$(echo "$allow - $exp" | bc)
            printf "  %-10s │ %10s │ %10s │ %10s │ %10s │ ${GREEN}%10s${NC}\n" \
                "$month" "\$$start" "+\$$allow" "-\$$exp" "\$$ending" "\$$saved"
        done
    fi
    echo ""
}

# Prompt for input with validation
prompt() {
    local message="$1"
    local var_name="$2"
    local default="$3"

    if [ -n "$default" ]; then
        echo -ne "${YELLOW}$message${NC} [${default}]: "
    else
        echo -ne "${YELLOW}$message${NC}: "
    fi
    read input

    if [ -z "$input" ] && [ -n "$default" ]; then
        eval "$var_name='$default'"
    else
        eval "$var_name='$input'"
    fi
}

# Add a new month
action_add_month() {
    show_header
    echo -e "${BOLD}Add/Update Month Summary${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"
    prompt "Starting balance" starting_balance "0"
    prompt "Allowance added" allowance "100"
    prompt "Total expenses" expenses "0"

    local ending_balance=$(echo "$starting_balance + $allowance - $expenses" | bc)

    echo ""
    echo -e "${CYAN}Creating month summary...${NC}"
    echo "  Starting: \$$starting_balance"
    echo "  Allowance: +\$$allowance"
    echo "  Expenses: -\$$expenses"
    echo "  Ending: \$$ending_balance"

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"MONTH#$month\"},
        \"SK\": {\"S\": \"SUMMARY\"},
        \"month\": {\"S\": \"$month\"},
        \"starting_balance\": {\"N\": \"$starting_balance\"},
        \"allowance_added\": {\"N\": \"$allowance\"},
        \"total_expenses\": {\"N\": \"$expenses\"},
        \"ending_balance\": {\"N\": \"$ending_balance\"},
        \"created_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},
        \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

    echo -e "${GREEN}✓ Month $month added/updated${NC}"
    pause
}

# Add an expense
action_add_expense() {
    show_header
    echo -e "${BOLD}Add Expense${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"
    prompt "Amount" amount ""
    prompt "Description" description ""

    if [ -z "$amount" ] || [ -z "$description" ]; then
        echo -e "${RED}Error: Amount and description are required${NC}"
        pause
        return
    fi

    echo ""
    echo -e "${CYAN}Adding expense...${NC}"

    # Check if month exists, create if not
    local month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    local month_exists=$(echo "$month_data" | jq -r '.Item.month.S // empty')

    if [ -z "$month_exists" ]; then
        echo "  Month $month doesn't exist, creating it with \$0 allowance..."
        aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
            \"PK\": {\"S\": \"MONTH#$month\"},
            \"SK\": {\"S\": \"SUMMARY\"},
            \"month\": {\"S\": \"$month\"},
            \"starting_balance\": {\"N\": \"0\"},
            \"allowance_added\": {\"N\": \"0\"},
            \"total_expenses\": {\"N\": \"0\"},
            \"ending_balance\": {\"N\": \"0\"},
            \"created_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},
            \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"
        # Refresh month_data after creation
        month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
            --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
            --output json 2>/dev/null)
    fi

    # Add the expense
    local timestamp=$(date +%s%N | cut -b1-13)
    local random_id=$(head -c 8 /dev/urandom | xxd -p)
    local expense_id="EXP#${timestamp}#${random_id}"

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"MONTH#$month\"},
        \"SK\": {\"S\": \"$expense_id\"},
        \"amount\": {\"N\": \"$amount\"},
        \"description\": {\"S\": \"$description\"},
        \"created_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

    # Update month summary
    local current_expenses=$(echo "$month_data" | jq -r '.Item.total_expenses.N // "0"')
    local current_ending=$(echo "$month_data" | jq -r '.Item.ending_balance.N // "0"')
    local new_expenses=$(echo "$current_expenses + $amount" | bc)
    local new_ending=$(echo "$current_ending - $amount" | bc)

    aws dynamodb update-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --update-expression "SET total_expenses = :e, ending_balance = :b, updated_at = :u" \
        --expression-attribute-values "{
            \":e\": {\"N\": \"$new_expenses\"},
            \":b\": {\"N\": \"$new_ending\"},
            \":u\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"

    # Update total balance
    local balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null)
    local current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')
    local new_total=$(echo "$current_total - $amount" | bc)

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$new_total\"},
        \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

    echo "  Month expenses: \$$current_expenses → \$$new_expenses"
    echo "  Total balance: \$$current_total → \$$new_total"
    echo -e "${GREEN}✓ Expense added: \$$amount for '$description'${NC}"
    pause
}

# Add funds
action_add_funds() {
    show_header
    echo -e "${BOLD}Add Funds${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"
    prompt "Amount to add" amount ""

    if [ -z "$amount" ]; then
        echo -e "${RED}Error: Amount is required${NC}"
        pause
        return
    fi

    echo ""
    echo -e "${CYAN}Adding funds...${NC}"

    local month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    if [ -z "$month_data" ] || [ "$month_data" = "{}" ]; then
        echo "  Month $month not found, creating it..."
        aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
            \"PK\": {\"S\": \"MONTH#$month\"},
            \"SK\": {\"S\": \"SUMMARY\"},
            \"month\": {\"S\": \"$month\"},
            \"starting_balance\": {\"N\": \"0\"},
            \"allowance_added\": {\"N\": \"$amount\"},
            \"total_expenses\": {\"N\": \"0\"},
            \"ending_balance\": {\"N\": \"$amount\"},
            \"created_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"},
            \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"
    else
        local current_allowance=$(echo "$month_data" | jq -r '.Item.allowance_added.N // "0"')
        local current_ending=$(echo "$month_data" | jq -r '.Item.ending_balance.N // "0"')
        local new_allowance=$(echo "$current_allowance + $amount" | bc)
        local new_ending=$(echo "$current_ending + $amount" | bc)

        aws dynamodb update-item --table-name "$TABLE_NAME" --region "$REGION" \
            --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
            --update-expression "SET allowance_added = :a, ending_balance = :e, updated_at = :u" \
            --expression-attribute-values "{
                \":a\": {\"N\": \"$new_allowance\"},
                \":e\": {\"N\": \"$new_ending\"},
                \":u\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
            }"

        echo "  Allowance: \$$current_allowance → \$$new_allowance"
        echo "  Ending balance: \$$current_ending → \$$new_ending"
    fi

    # Update total balance
    local balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null)
    local current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')
    local new_total=$(echo "$current_total + $amount" | bc)

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$new_total\"},
        \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

    echo "  Total balance: \$$current_total → \$$new_total"
    echo -e "${GREEN}✓ Added \$$amount to $month${NC}"
    pause
}

# Set total balance directly
action_set_balance() {
    show_header
    echo -e "${BOLD}Set Total Balance${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null)
    local current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')

    echo -e "Current total balance: ${GREEN}\$$current_total${NC}"
    echo ""
    prompt "New total balance" new_balance ""

    if [ -z "$new_balance" ]; then
        echo -e "${RED}Error: Balance is required${NC}"
        pause
        return
    fi

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$new_balance\"},
        \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

    echo -e "${GREEN}✓ Total balance set to \$$new_balance${NC}"
    pause
}

# View expenses for a month
action_view_expenses() {
    show_header
    echo -e "${BOLD}View Month Expenses${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"

    echo ""
    echo -e "${CYAN}Loading expenses for $month...${NC}"
    echo ""

    local expenses=$(aws dynamodb query --table-name "$TABLE_NAME" --region "$REGION" \
        --key-condition-expression "PK = :pk AND begins_with(SK, :sk)" \
        --expression-attribute-values "{\":pk\": {\"S\": \"MONTH#$month\"}, \":sk\": {\"S\": \"EXP#\"}}" \
        --output json 2>/dev/null)

    local summary=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

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

    local count=$(echo "$expenses" | jq -r '.Items | length')
    if [ "$count" = "0" ] || [ -z "$count" ]; then
        echo "  No expenses found for $month"
    else
        echo "$expenses" | jq -r '.Items | sort_by(.created_at.S) | .[] |
            "  \(.created_at.S | split("T")[0])  │  $\(.amount.N)  │  \(.description.S)"'
    fi
    echo ""
    pause
}

# Reset PIN
action_reset_pin() {
    show_header
    echo -e "${BOLD}${RED}Reset PIN${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo -e "${YELLOW}Warning: This will delete the current PIN configuration.${NC}"
    echo "The user will need to set up a new PIN on next login."
    echo ""
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
    prompt "Type 'YES' to confirm" confirm ""

    if [ "$confirm" = "YES" ]; then
        echo -e "${CYAN}Scanning for sessions...${NC}"
        local sessions=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
            --filter-expression "begins_with(PK, :pk)" \
            --expression-attribute-values '{":pk": {"S": "SESSION#"}}' \
            --projection-expression "PK, SK" \
            --output json 2>/dev/null)

        local count=$(echo "$sessions" | jq -r '.Items | length')
        if [ "$count" = "0" ] || [ -z "$count" ]; then
            echo "No active sessions found."
        else
            echo "Deleting $count session(s)..."
            echo "$sessions" | jq -c '.Items[]' | while read item; do
                local pk=$(echo "$item" | jq -r '.PK.S')
                local sk=$(echo "$item" | jq -r '.SK.S')
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

# Delete a month and all its expenses
action_delete_month() {
    show_header
    echo -e "${BOLD}${RED}Delete Month${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo -e "${YELLOW}Warning: This will delete the month summary and ALL expenses for that month.${NC}"
    echo ""

    prompt "Month to delete (YYYY-MM)" month ""

    if [ -z "$month" ]; then
        echo -e "${RED}Error: Month is required${NC}"
        pause
        return
    fi

    # Check if month exists
    local month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    if [ -z "$month_data" ] || [ "$(echo "$month_data" | jq -r '.Item // empty')" = "" ]; then
        echo -e "${RED}Month $month not found${NC}"
        pause
        return
    fi

    local ending_balance=$(echo "$month_data" | jq -r '.Item.ending_balance.N // "0"')
    echo ""
    echo "Month $month has ending balance: \$$ending_balance"
    prompt "Type 'DELETE' to confirm" confirm ""

    if [ "$confirm" = "DELETE" ]; then
        echo -e "${CYAN}Deleting month data...${NC}"

        # Delete all expenses for this month
        local expenses=$(aws dynamodb query --table-name "$TABLE_NAME" --region "$REGION" \
            --key-condition-expression "PK = :pk" \
            --expression-attribute-values "{\":pk\": {\"S\": \"MONTH#$month\"}}" \
            --projection-expression "PK, SK" \
            --output json 2>/dev/null)

        local count=$(echo "$expenses" | jq -r '.Items | length')
        echo "Deleting $count item(s)..."

        echo "$expenses" | jq -c '.Items[]' | while read item; do
            local pk=$(echo "$item" | jq -r '.PK.S')
            local sk=$(echo "$item" | jq -r '.SK.S')
            aws dynamodb delete-item --table-name "$TABLE_NAME" --region "$REGION" \
                --key "{\"PK\": {\"S\": \"$pk\"}, \"SK\": {\"S\": \"$sk\"}}"
        done

        # Update total balance (subtract this month's ending balance)
        local balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
            --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
            --output json 2>/dev/null)
        local current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')
        local new_total=$(echo "$current_total - $ending_balance" | bc)

        aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
            \"PK\": {\"S\": \"BALANCE\"},
            \"SK\": {\"S\": \"BALANCE\"},
            \"total_balance\": {\"N\": \"$new_total\"},
            \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"

        echo "  Total balance: \$$current_total → \$$new_total"
        echo -e "${GREEN}✓ Month $month deleted${NC}"
    else
        echo "Cancelled."
    fi
    pause
}

# Remove funds from a month
action_remove_funds() {
    show_header
    echo -e "${BOLD}Remove Funds${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local current_month=$(date +%Y-%m)
    prompt "Month (YYYY-MM)" month "$current_month"

    # Get current month data
    local month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    if [ -z "$month_data" ] || [ "$(echo "$month_data" | jq -r '.Item // empty')" = "" ]; then
        echo -e "${RED}Month $month not found${NC}"
        pause
        return
    fi

    local current_allowance=$(echo "$month_data" | jq -r '.Item.allowance_added.N // "0"')
    local current_ending=$(echo "$month_data" | jq -r '.Item.ending_balance.N // "0"')

    echo ""
    echo -e "Current allowance: ${GREEN}\$$current_allowance${NC}"
    echo -e "Current ending balance: ${GREEN}\$$current_ending${NC}"
    echo ""
    prompt "Amount to remove" amount ""

    if [ -z "$amount" ]; then
        echo -e "${RED}Error: Amount is required${NC}"
        pause
        return
    fi

    local new_allowance=$(echo "$current_allowance - $amount" | bc)
    local new_ending=$(echo "$current_ending - $amount" | bc)

    if [ "$(echo "$new_allowance < 0" | bc)" -eq 1 ]; then
        echo -e "${RED}Error: Cannot remove more than current allowance (\$$current_allowance)${NC}"
        pause
        return
    fi

    echo ""
    echo -e "${CYAN}Removing funds...${NC}"

    aws dynamodb update-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --update-expression "SET allowance_added = :a, ending_balance = :e, updated_at = :u" \
        --expression-attribute-values "{
            \":a\": {\"N\": \"$new_allowance\"},
            \":e\": {\"N\": \"$new_ending\"},
            \":u\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"

    echo "  Allowance: \$$current_allowance → \$$new_allowance"
    echo "  Ending balance: \$$current_ending → \$$new_ending"

    # Update total balance
    local balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null)
    local current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')
    local new_total=$(echo "$current_total - $amount" | bc)

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$new_total\"},
        \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

    echo "  Total balance: \$$current_total → \$$new_total"
    echo -e "${GREEN}✓ Removed \$$amount from $month${NC}"
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
    read choice

    case "$choice" in
        1) action_reset_pin ;;
        2) action_clear_sessions ;;
        b|B) return ;;
        *) echo -e "${RED}Invalid option${NC}"; sleep 1 ;;
    esac
}

# Export all data to JSON file
action_export_data() {
    show_header
    echo -e "${BOLD}Export Data${NC}"
    echo "─────────────────────────────────────────────"
    echo ""

    local default_file="passbook-backup-$(date +%Y%m%d-%H%M%S).json"
    prompt "Output file" output_file "$default_file"

    echo ""
    echo -e "${CYAN}Exporting data...${NC}"

    # Scan all items from the table
    local data=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --output json 2>/dev/null)

    if [ -z "$data" ]; then
        echo -e "${RED}Error: Failed to export data${NC}"
        pause
        return
    fi

    # Save to file with metadata
    local export_data=$(cat <<EOF
{
  "export_info": {
    "table_name": "$TABLE_NAME",
    "region": "$REGION",
    "exported_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "item_count": $(echo "$data" | jq '.Count')
  },
  "items": $(echo "$data" | jq '.Items')
}
EOF
)
    echo "$export_data" | jq '.' > "$output_file"

    local count=$(echo "$data" | jq '.Count')
    echo -e "${GREEN}✓ Exported $count items to $output_file${NC}"
    pause
}

# Import data from JSON file
action_import_data() {
    show_header
    echo -e "${BOLD}${YELLOW}Import Data${NC}"
    echo "─────────────────────────────────────────────"
    echo ""
    echo -e "${RED}Warning: This will ADD items to the database.${NC}"
    echo -e "${RED}Existing items with the same keys will be OVERWRITTEN.${NC}"
    echo ""

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

    # Validate JSON structure
    local item_count=$(jq -r '.items | length' "$input_file" 2>/dev/null)
    if [ -z "$item_count" ] || [ "$item_count" = "null" ]; then
        echo -e "${RED}Error: Invalid backup file format${NC}"
        pause
        return
    fi

    echo ""
    echo "File contains $item_count items"
    echo ""
    prompt "Type 'IMPORT' to confirm" confirm ""

    if [ "$confirm" != "IMPORT" ]; then
        echo "Cancelled."
        pause
        return
    fi

    echo ""
    echo -e "${CYAN}Importing data...${NC}"

    local success=0
    local failed=0

    # Import each item
    jq -c '.items[]' "$input_file" | while read -r item; do
        if aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" \
            --item "$item" 2>/dev/null; then
            ((success++))
        else
            ((failed++))
        fi
    done

    echo -e "${GREEN}✓ Import complete${NC}"
    echo "  Note: Check the data to verify import was successful"
    pause
}

# Pause and wait for key
pause() {
    echo ""
    echo -ne "${CYAN}Press Enter to continue...${NC}"
    read
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
        echo "  5) Delete month          0) Reset PIN / Clear sessions"
        echo "  q) Quit"
        echo ""
        echo -ne "${YELLOW}Select option:${NC} "
        read choice

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
            0) action_admin_menu ;;
            q|Q)
                clear
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
