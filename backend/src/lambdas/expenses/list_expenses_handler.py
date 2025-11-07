"""
Lambda handler for listing expenses for a child.
"""
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_authorization_token, get_query_parameter, LambdaError
from src.utils.db_client import DynamoDBClient
from src.utils.jwt_utils import verify_token
from src.models.expense import Expense


@lambda_handler_wrapper
def handler(event, context):
    """Handle list expenses request."""
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

    # Get optional query parameters
    limit = int(get_query_parameter(event, 'limit', 50))
    start_date = get_query_parameter(event, 'startDate')
    end_date = get_query_parameter(event, 'endDate')

    # Query expenses for the child
    # Note: This queries by childUserId (partition key)
    # For date filtering, we'd need to use a filter expression or LSI
    expenses_items = db.query(
        table_name=db.transactions_table,
        key_condition_expression='childUserId = :childUserId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':childUserId': child_user_id,
            ':skPrefix': 'EXPENSE#'
        }
    )

    # Convert to expense objects
    expenses = []
    for item in expenses_items:
        expense = Expense.from_dict(item)
        expense_dict = expense.to_dict()
        expenses.append(expense_dict)

    # Sort by date (most recent first)
    expenses.sort(key=lambda x: x.get('expenseDate', ''), reverse=True)

    # Apply date filters if provided
    if start_date:
        expenses = [e for e in expenses if e.get('expenseDate', '') >= start_date]
    if end_date:
        expenses = [e for e in expenses if e.get('expenseDate', '') <= end_date]

    # Apply limit
    expenses = expenses[:limit]

    return create_response(
        status_code=200,
        body={
            'expenses': expenses,
            'count': len(expenses),
        }
    )
