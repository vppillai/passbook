"""
Lambda handler for getting analytics data.
"""
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_authorization_token, get_query_parameter, LambdaError
from src.utils.db_client import DynamoDBClient
from src.utils.jwt_utils import verify_token
from src.models.expense import Expense
from src.models.fund_addition import FundAddition
from datetime import datetime, timedelta
from collections import defaultdict


@lambda_handler_wrapper
def handler(event, context):
    """Handle get analytics request."""
    # Verify authentication
    token = get_authorization_token(event)
    if not token:
        raise LambdaError("Authentication required", 401)

    try:
        payload = verify_token(token)
        user_id = payload['userId']
        family_id = payload.get('familyId')
        user_type = payload.get('userType', 'parent')
    except Exception as e:
        raise LambdaError(f"Invalid token: {str(e)}", 401)

    # Get child user ID from query params
    child_user_id = get_query_parameter(event, 'childUserId')

    # If child is viewing, use their own user ID
    if user_type == 'child':
        child_user_id = user_id

    if not child_user_id:
        raise LambdaError("Child user ID is required", 400)

    if not family_id:
        raise LambdaError("Family account required", 400)

    # Verify child belongs to family (if parent is viewing)
    if user_type == 'parent':
        db = DynamoDBClient()
        child_item = db.get_item(
            table_name=db.families_table,
            key={
                'familyId': family_id,
                'SK': f'CHILD#{child_user_id}'
            }
        )

        if not child_item:
            raise LambdaError("Child account not found", 404)

    # Get date range
    start_date = get_query_parameter(event, 'startDate')
    end_date = get_query_parameter(event, 'endDate')

    # Default to current month if not specified
    if not start_date or not end_date:
        today = datetime.utcnow().date()
        start_date = today.replace(day=1).isoformat()
        end_date = today.isoformat()

    db = DynamoDBClient()

    # Get all expenses for the child in date range
    expenses_items = db.query(
        table_name=db.transactions_table,
        key_condition_expression='childUserId = :childUserId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':childUserId': child_user_id,
            ':skPrefix': 'EXPENSE#'
        }
    )

    # Filter by date range
    expenses = []
    for item in expenses_items:
        expense_date = item.get('expenseDate', '')
        if expense_date >= start_date and expense_date <= end_date:
            expenses.append(Expense.from_dict(item))

    # Get all fund additions in date range
    funds_items = db.query(
        table_name=db.transactions_table,
        key_condition_expression='childUserId = :childUserId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':childUserId': child_user_id,
            ':skPrefix': 'FUND#'
        }
    )

    # Filter by date range
    fund_additions = []
    for item in funds_items:
        added_at = item.get('addedAt', '')
        if added_at >= start_date and added_at <= end_date:
            fund_additions.append(FundAddition.from_dict(item))

    # Calculate analytics
    total_expenses = sum(e.amount for e in expenses)
    total_funded = sum(f.amount for f in fund_additions)
    net_balance = total_funded - total_expenses

    # Category breakdown
    category_totals = defaultdict(float)
    for expense in expenses:
        category_totals[expense.category] += expense.amount

    category_breakdown = []
    for category, amount in category_totals.items():
        percentage = (amount / total_expenses * 100) if total_expenses > 0 else 0
        category_breakdown.append({
            'category': category,
            'amount': amount,
            'percentage': round(percentage, 2)
        })

    # Sort by amount descending
    category_breakdown.sort(key=lambda x: x['amount'], reverse=True)

    # Spending trends (daily)
    daily_totals = defaultdict(float)
    for expense in expenses:
        daily_totals[expense.expense_date] += expense.amount

    spending_trends = []
    current_date = datetime.fromisoformat(start_date).date()
    end_date_obj = datetime.fromisoformat(end_date).date()

    while current_date <= end_date_obj:
        date_str = current_date.isoformat()
        spending_trends.append({
            'date': date_str,
            'amount': daily_totals.get(date_str, 0.0)
        })
        current_date += timedelta(days=1)

    return create_response(
        status_code=200,
        body={
            'categoryBreakdown': category_breakdown,
            'spendingTrends': spending_trends,
            'totalExpenses': total_expenses,
            'totalFunded': total_funded,
            'netBalance': net_balance,
            'period': {
                'startDate': start_date,
                'endDate': end_date
            }
        }
    )
