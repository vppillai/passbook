"""
Lambda handler for generating financial reports (PDF/Excel).
"""
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_authorization_token, get_query_parameter, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import verify_token
from models.expense import Expense
from models.fund_addition import FundAddition
from datetime import datetime
import json
import base64


@lambda_handler_wrapper
def handler(event, context):
    """Handle generate report request."""
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

    # Get parameters
    child_user_id = get_query_parameter(event, 'childUserId')
    report_type = get_query_parameter(event, 'type', 'pdf')  # 'pdf' or 'excel'
    start_date = get_query_parameter(event, 'startDate')
    end_date = get_query_parameter(event, 'endDate')

    # If child is viewing, use their own user ID
    if user_type == 'child':
        child_user_id = user_id

    if not child_user_id:
        raise LambdaError("Child user ID is required", 400)

    if not family_id:
        raise LambdaError("Family account required", 400)

    # Default to current month if not specified
    if not start_date or not end_date:
        today = datetime.utcnow().date()
        start_date = today.replace(day=1).isoformat()
        end_date = today.isoformat()

    db = DynamoDBClient()

    # Verify child belongs to family (if parent is viewing)
    if user_type == 'parent':
        child_item = db.get_item(
            table_name=db.families_table,
            key={
                'familyId': family_id,
                'SK': f'CHILD#{child_user_id}'
            }
        )

        if not child_item:
            raise LambdaError("Child account not found", 404)

        child_name = child_item.get('displayName', 'Child')
    else:
        child_name = 'Your Account'

    # Get family info
    family_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': 'FAMILY'
        }
    )

    family_name = family_item.get('familyName', 'Family') if family_item else 'Family'
    currency = family_item.get('currency', 'CAD') if family_item else 'CAD'

    # Get expenses
    expenses_items = db.query(
        table_name=db.transactions_table,
        key_condition_expression='childUserId = :childUserId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':childUserId': child_user_id,
            ':skPrefix': 'EXPENSE#'
        }
    )

    expenses = []
    for item in expenses_items:
        expense_date = item.get('expenseDate', '')
        if expense_date >= start_date and expense_date <= end_date:
            expenses.append(Expense.from_dict(item))

    # Get fund additions
    funds_items = db.query(
        table_name=db.transactions_table,
        key_condition_expression='childUserId = :childUserId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':childUserId': child_user_id,
            ':skPrefix': 'FUND#'
        }
    )

    fund_additions = []
    for item in funds_items:
        added_at = item.get('addedAt', '')
        if added_at >= start_date and added_at <= end_date:
            fund_additions.append(FundAddition.from_dict(item))

    # Calculate totals
    total_expenses = sum(e.amount for e in expenses)
    total_funded = sum(f.amount for f in fund_additions)
    net_balance = total_funded - total_expenses

    # Category breakdown
    category_totals = {}
    for expense in expenses:
        category = expense.category
        if category not in category_totals:
            category_totals[category] = 0.0
        category_totals[category] += expense.amount

    # Generate report based on type
    if report_type == 'pdf':
        # For PDF, return data that frontend can use to generate PDF
        # In production, you might generate PDF server-side
        report_data = {
            'type': 'pdf',
            'familyName': family_name,
            'childName': child_name,
            'period': {
                'startDate': start_date,
                'endDate': end_date
            },
            'summary': {
                'totalExpenses': total_expenses,
                'totalFunded': total_funded,
                'netBalance': net_balance,
                'currency': currency
            },
            'expenses': [e.to_dict() for e in expenses],
            'fundAdditions': [f.to_dict() for f in fund_additions],
            'categoryBreakdown': category_totals
        }

        return create_response(
            status_code=200,
            body=report_data
        )

    elif report_type == 'excel':
        # For Excel, return data that frontend can use to generate Excel
        report_data = {
            'type': 'excel',
            'familyName': family_name,
            'childName': child_name,
            'period': {
                'startDate': start_date,
                'endDate': end_date
            },
            'summary': {
                'totalExpenses': total_expenses,
                'totalFunded': total_funded,
                'netBalance': net_balance,
                'currency': currency
            },
            'expenses': [e.to_dict() for e in expenses],
            'fundAdditions': [f.to_dict() for f in fund_additions],
            'categoryBreakdown': category_totals
        }

        return create_response(
            status_code=200,
            body=report_data
        )

    else:
        raise LambdaError("Invalid report type. Must be 'pdf' or 'excel'", 400)
