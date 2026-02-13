#!/bin/bash
# Helper script to add data to the passbook app

set -e

show_help() {
    cat << 'EOF'
Passbook CLI - Data management for passbook app

Usage: ./scripts/add-data.sh <command> [args...]

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
  ./scripts/add-data.sh month 2026-01 100 30    # January: allowance $100, spent $30
  ./scripts/add-data.sh expense 2026-01 15 "Book purchase"
  ./scripts/add-data.sh balance 170
  ./scripts/add-data.sh funds 2026-02 50
  ./scripts/add-data.sh rmfunds 2026-02 20
  ./scripts/add-data.sh rmmonth 2026-01
  ./scripts/add-data.sh export mybackup.json
  ./scripts/add-data.sh import mybackup.json
  ./scripts/add-data.sh show

Prerequisites:
  - AWS CLI v2 configured with credentials
  - jq (JSON processor)
  - bc (calculator)
EOF
}

# Show help if requested
if [[ "$1" == "help" || "$1" == "--help" || "$1" == "-h" || -z "$1" ]]; then
    show_help
    exit 0
fi

TABLE_NAME="passbook-prod"
REGION="us-west-2"

# Recalculate total balance from all months
recalc_balance() {
    echo "Recalculating total balance from all months..."

    local months_data=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --filter-expression "begins_with(PK, :pk) AND SK = :sk" \
        --expression-attribute-values '{":pk": {"S": "MONTH#"}, ":sk": {"S": "SUMMARY"}}' \
        --output json 2>/dev/null)

    # Sum up (allowance_added - total_expenses) for all months
    local total=$(echo "$months_data" | jq -r '[.Items[] | ((.allowance_added.N // "0") | tonumber) - ((.total_expenses.N // "0") | tonumber)] | add // 0')

    echo "  Calculated total balance: $total"

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$total\"},
        \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

    echo "  Total balance updated to: $total"
}

# Add or update a month summary
add_month() {
    local month="$1"
    local allowance="$2"
    local expenses="$3"

    # Auto-calculate starting balance from previous month
    # Calculate previous month (works on both Linux and macOS)
    local year=${month%-*}
    local mon=${month#*-}
    mon=$((10#$mon - 1))  # Remove leading zero and subtract 1
    if [ "$mon" -eq 0 ]; then
        mon=12
        year=$((year - 1))
    fi
    local prev_month=$(printf "%04d-%02d" "$year" "$mon")

    local prev_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$prev_month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)
    local starting_balance=$(echo "$prev_data" | jq -r '.Item.ending_balance.N // "0"')

    # Ensure starting_balance is a number
    if [ -z "$starting_balance" ] || [ "$starting_balance" = "null" ]; then
        starting_balance="0"
    fi

    local ending_balance=$(echo "$starting_balance + $allowance - $expenses" | bc)

    echo "Adding month $month: starting=$starting_balance (from $prev_month), allowance=$allowance, expenses=$expenses, ending=$ending_balance"

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

    # If expenses > 0, create an expense record so it shows in the frontend
    if [ "$(echo "$expenses > 0" | bc)" -eq 1 ]; then
        local expense_id="EXP#$(date +%s)000000000#$(head -c 4 /dev/urandom | xxd -p)"
        echo "  Creating expense record for \$$expenses..."
        aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
            \"PK\": {\"S\": \"MONTH#$month\"},
            \"SK\": {\"S\": \"$expense_id\"},
            \"amount\": {\"N\": \"$expenses\"},
            \"description\": {\"S\": \"Total Expenses\"},
            \"created_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"
    fi

    # Recalculate total balance
    recalc_balance
}

# Add an expense to a month
add_expense() {
    local month="$1"
    local amount="$2"
    local description="$3"

    echo "Adding expense to $month: amount=$amount, description=$description"

    # Check if month exists, create if not
    local month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    local month_exists=$(echo "$month_data" | jq -r '.Item.month.S // empty')

    if [ -z "$month_exists" ]; then
        echo "  Month $month doesn't exist, creating with \$0 allowance..."
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

    echo "  Month expenses: $current_expenses -> $new_expenses"
    echo "  Total balance: $current_total -> $new_total"
    echo "  Created expense ID: $expense_id"
}

# Set total balance
set_balance() {
    local balance="$1"
    echo "Setting total balance to $balance"

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"BALANCE\"},
        \"SK\": {\"S\": \"BALANCE\"},
        \"total_balance\": {\"N\": \"$balance\"},
        \"updated_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"
}

# Add funds to a month (updates allowance_added and ending_balance)
add_funds() {
    local month="$1"
    local amount="$2"

    echo "Adding $amount funds to month $month"

    # Get current month data
    local current=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    if [ -z "$current" ] || [ "$current" = "{}" ]; then
        echo "Month $month not found. Creating it with funds=$amount"
        add_month "$month" "0" "$amount" "0"
        return
    fi

    local current_allowance=$(echo "$current" | jq -r '.Item.allowance_added.N // "0"')
    local current_ending=$(echo "$current" | jq -r '.Item.ending_balance.N // "0"')
    local new_allowance=$(echo "$current_allowance + $amount" | bc)
    local new_ending=$(echo "$current_ending + $amount" | bc)

    echo "  Current allowance: $current_allowance -> $new_allowance"
    echo "  Current ending balance: $current_ending -> $new_ending"

    aws dynamodb update-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --update-expression "SET allowance_added = :a, ending_balance = :e, updated_at = :u" \
        --expression-attribute-values "{
            \":a\": {\"N\": \"$new_allowance\"},
            \":e\": {\"N\": \"$new_ending\"},
            \":u\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"

    # Also update total balance
    local balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"BALANCE\"}, \"SK\": {\"S\": \"BALANCE\"}}" \
        --output json 2>/dev/null)

    local current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')
    local new_total=$(echo "$current_total + $amount" | bc)
    echo "  Total balance: $current_total -> $new_total"
    set_balance "$new_total"
}

# Remove funds from a month
remove_funds() {
    local month="$1"
    local amount="$2"

    echo "Removing $amount from month $month"

    # Get current month data
    local current=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    if [ -z "$current" ] || [ "$current" = "{}" ] || [ "$(echo "$current" | jq -r '.Item // empty')" = "" ]; then
        echo "Error: Month $month not found"
        exit 1
    fi

    local current_allowance=$(echo "$current" | jq -r '.Item.allowance_added.N // "0"')
    local current_ending=$(echo "$current" | jq -r '.Item.ending_balance.N // "0"')
    local new_allowance=$(echo "$current_allowance - $amount" | bc)
    local new_ending=$(echo "$current_ending - $amount" | bc)

    echo "  Allowance: $current_allowance -> $new_allowance"
    echo "  Ending balance: $current_ending -> $new_ending"

    aws dynamodb update-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --update-expression "SET allowance_added = :a, ending_balance = :e, updated_at = :u" \
        --expression-attribute-values "{
            \":a\": {\"N\": \"$new_allowance\"},
            \":e\": {\"N\": \"$new_ending\"},
            \":u\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
        }"

    # Update total balance
    local balance_item=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key '{"PK": {"S": "BALANCE"}, "SK": {"S": "BALANCE"}}' \
        --output json 2>/dev/null)

    local current_total=$(echo "$balance_item" | jq -r '.Item.total_balance.N // "0"')
    local new_total=$(echo "$current_total - $amount" | bc)
    echo "  Total balance: $current_total -> $new_total"
    set_balance "$new_total"
}

# Delete a month and all its data
delete_month() {
    local month="$1"

    echo "Deleting month $month and all its expenses"

    # Get month data first to know the ending balance
    local month_data=$(aws dynamodb get-item --table-name "$TABLE_NAME" --region "$REGION" \
        --key "{\"PK\": {\"S\": \"MONTH#$month\"}, \"SK\": {\"S\": \"SUMMARY\"}}" \
        --output json 2>/dev/null)

    if [ -z "$month_data" ] || [ "$(echo "$month_data" | jq -r '.Item // empty')" = "" ]; then
        echo "Error: Month $month not found"
        exit 1
    fi

    local ending_balance=$(echo "$month_data" | jq -r '.Item.ending_balance.N // "0"')

    # Delete all items for this month (summary + expenses)
    local items=$(aws dynamodb query --table-name "$TABLE_NAME" --region "$REGION" \
        --key-condition-expression "PK = :pk" \
        --expression-attribute-values "{\":pk\": {\"S\": \"MONTH#$month\"}}" \
        --projection-expression "PK, SK" \
        --output json 2>/dev/null)

    local count=$(echo "$items" | jq -r '.Items | length')
    echo "  Deleting $count item(s)..."

    echo "$items" | jq -c '.Items[]' | while read item; do
        local pk=$(echo "$item" | jq -r '.PK.S')
        local sk=$(echo "$item" | jq -r '.SK.S')
        aws dynamodb delete-item --table-name "$TABLE_NAME" --region "$REGION" \
            --key "{\"PK\": {\"S\": \"$pk\"}, \"SK\": {\"S\": \"$sk\"}}"
    done

    # Recalculate total balance
    recalc_balance

    echo "Month $month deleted"
}

# Show all data
show_data() {
    echo "=== All Data in $TABLE_NAME ==="
    aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --output json | jq -r '.Items[] | "\(.PK.S)/\(.SK.S): \(del(.PK, .SK) | to_entries | map("\(.key)=\(.value.N // .value.S)") | join(", "))"' | sort
}

# Export all data to JSON file
export_data() {
    local output_file="$1"

    if [ -z "$output_file" ]; then
        output_file="passbook-backup-$(date +%Y%m%d-%H%M%S).json"
    fi

    echo "Exporting data to $output_file..."

    local data=$(aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --output json 2>/dev/null)

    if [ -z "$data" ]; then
        echo "Error: Failed to export data"
        exit 1
    fi

    # Save with metadata
    cat <<EOF | jq '.' > "$output_file"
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

    local count=$(echo "$data" | jq '.Count')
    echo "Exported $count items to $output_file"
}

# Import data from JSON file
import_data() {
    local input_file="$1"

    if [ -z "$input_file" ]; then
        echo "Error: Input file required"
        exit 1
    fi

    if [ ! -f "$input_file" ]; then
        echo "Error: File not found: $input_file"
        exit 1
    fi

    local item_count=$(jq -r '.items | length' "$input_file" 2>/dev/null)
    if [ -z "$item_count" ] || [ "$item_count" = "null" ]; then
        echo "Error: Invalid backup file format"
        exit 1
    fi

    echo "Importing $item_count items from $input_file..."

    local success=0
    local failed=0

    jq -c '.items[]' "$input_file" | while read -r item; do
        if aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" \
            --item "$item" 2>/dev/null; then
            ((success++))
        else
            ((failed++))
            echo "  Failed to import: $(echo "$item" | jq -r '.PK.S + "/" + .SK.S')"
        fi
    done

    echo "Import complete"
}

# Main command dispatch
case "$1" in
    month)
        if [ $# -ne 4 ]; then
            echo "Usage: $0 month YYYY-MM allowance expenses"
            echo "  Starting balance is auto-calculated from previous month"
            exit 1
        fi
        add_month "$2" "$3" "$4"
        ;;
    expense)
        if [ $# -lt 4 ]; then
            echo "Usage: $0 expense YYYY-MM amount description"
            exit 1
        fi
        add_expense "$2" "$3" "${*:4}"
        ;;
    balance)
        if [ $# -ne 2 ]; then
            echo "Usage: $0 balance amount"
            exit 1
        fi
        set_balance "$2"
        ;;
    funds)
        if [ $# -ne 3 ]; then
            echo "Usage: $0 funds YYYY-MM amount"
            exit 1
        fi
        add_funds "$2" "$3"
        ;;
    rmfunds)
        if [ $# -ne 3 ]; then
            echo "Usage: $0 rmfunds YYYY-MM amount"
            exit 1
        fi
        remove_funds "$2" "$3"
        ;;
    rmmonth)
        if [ $# -ne 2 ]; then
            echo "Usage: $0 rmmonth YYYY-MM"
            exit 1
        fi
        delete_month "$2"
        ;;
    show)
        show_data
        ;;
    export)
        export_data "$2"
        ;;
    import)
        if [ $# -ne 2 ]; then
            echo "Usage: $0 import <file.json>"
            exit 1
        fi
        import_data "$2"
        ;;
    recalc)
        recalc_balance
        ;;
    *)
        echo "Passbook Data Helper"
        echo ""
        echo "Usage: $0 <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  month YYYY-MM allowance exp    - Add/update a month (starting balance auto-calculated)"
        echo "  expense YYYY-MM amount desc    - Add an expense to a month"
        echo "  balance amount                 - Set total balance directly"
        echo "  funds YYYY-MM amount           - Add funds to a month"
        echo "  rmfunds YYYY-MM amount         - Remove funds from a month"
        echo "  rmmonth YYYY-MM                - Delete a month and all its expenses"
        echo "  recalc                         - Recalculate total balance from all months"
        echo "  show                           - Show all data in the table"
        echo "  export [file]                  - Export all data to JSON (default: timestamped file)"
        echo "  import <file>                  - Import data from JSON backup"
        echo ""
        echo "Examples:"
        echo "  $0 month 2026-01 100 30         # January: allowance 100, spent 30"
        echo "  $0 expense 2026-01 15 Book      # Add \$15 expense for 'Book' in January"
        echo "  $0 funds 2026-02 50             # Add \$50 extra funds to February"
        echo "  $0 rmfunds 2026-02 20           # Remove \$20 from February"
        echo "  $0 rmmonth 2026-01              # Delete January and all its data"
        echo "  $0 balance 170                  # Set total balance to \$170"
        echo "  $0 export                       # Export to passbook-backup-YYYYMMDD-HHMMSS.json"
        echo "  $0 export backup.json           # Export to backup.json"
        echo "  $0 import backup.json           # Import from backup.json"
        echo "  $0 show                         # Display all data"
        ;;
esac
