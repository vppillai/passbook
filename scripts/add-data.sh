#!/bin/bash
# Helper script to add data to the passbook app
# Usage: ./scripts/add-data.sh [command] [args...]
#
# Commands:
#   month YYYY-MM starting_balance allowance expenses  - Add/update a month summary
#   expense YYYY-MM amount description                 - Add an expense to a month
#   balance amount                                     - Set total balance
#   funds YYYY-MM amount                               - Add funds to a month (updates allowance_added)
#   show                                               - Show all data in the table
#
# Examples:
#   ./scripts/add-data.sh month 2026-01 0 100 30
#   ./scripts/add-data.sh expense 2026-01 15 "Book purchase"
#   ./scripts/add-data.sh balance 170
#   ./scripts/add-data.sh funds 2026-02 50
#   ./scripts/add-data.sh show

set -e

TABLE_NAME="passbook-prod"
REGION="us-west-2"

# Add or update a month summary
add_month() {
    local month="$1"
    local starting_balance="$2"
    local allowance="$3"
    local expenses="$4"
    local ending_balance=$(echo "$starting_balance + $allowance - $expenses" | bc)

    echo "Adding month $month: starting=$starting_balance, allowance=$allowance, expenses=$expenses, ending=$ending_balance"

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
}

# Add an expense to a month
add_expense() {
    local month="$1"
    local amount="$2"
    local description="$3"
    local timestamp=$(date +%s%N | cut -b1-13)
    local random_id=$(head -c 8 /dev/urandom | xxd -p)
    local expense_id="EXP#${timestamp}#${random_id}"

    echo "Adding expense to $month: amount=$amount, description=$description"

    aws dynamodb put-item --table-name "$TABLE_NAME" --region "$REGION" --item "{
        \"PK\": {\"S\": \"MONTH#$month\"},
        \"SK\": {\"S\": \"$expense_id\"},
        \"amount\": {\"N\": \"$amount\"},
        \"description\": {\"S\": \"$description\"},
        \"created_at\": {\"S\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}
    }"

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

# Show all data
show_data() {
    echo "=== All Data in $TABLE_NAME ==="
    aws dynamodb scan --table-name "$TABLE_NAME" --region "$REGION" \
        --output json | jq -r '.Items[] | "\(.PK.S)/\(.SK.S): \(del(.PK, .SK) | to_entries | map("\(.key)=\(.value.N // .value.S)") | join(", "))"' | sort
}

# Main command dispatch
case "$1" in
    month)
        if [ $# -ne 5 ]; then
            echo "Usage: $0 month YYYY-MM starting_balance allowance expenses"
            exit 1
        fi
        add_month "$2" "$3" "$4" "$5"
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
    show)
        show_data
        ;;
    *)
        echo "Passbook Data Helper"
        echo ""
        echo "Usage: $0 <command> [args...]"
        echo ""
        echo "Commands:"
        echo "  month YYYY-MM start allow exp  - Add/update a month (calculates ending balance)"
        echo "  expense YYYY-MM amount desc    - Add an expense to a month"
        echo "  balance amount                 - Set total balance directly"
        echo "  funds YYYY-MM amount           - Add funds to a month (updates allowance & balances)"
        echo "  show                           - Show all data in the table"
        echo ""
        echo "Examples:"
        echo "  $0 month 2026-01 0 100 30       # January: started 0, got 100, spent 30 = 70"
        echo "  $0 month 2026-02 70 100 0       # February: started 70, got 100, spent 0 = 170"
        echo "  $0 expense 2026-01 15 Book      # Add \$15 expense for 'Book' in January"
        echo "  $0 funds 2026-02 50             # Add \$50 extra funds to February"
        echo "  $0 balance 170                  # Set total balance to \$170"
        echo "  $0 show                         # Display all data"
        ;;
esac
