"""
Lambda handler for adding an expense.
"""
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, get_authorization_token, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import verify_token
from utils.balance_manager import update_child_balance
from utils.overdraft_checker import check_overdraft
from models.expense import Expense
from datetime import datetime


@lambda_handler_wrapper
def handler(event, context):
    """Handle add expense request."""
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

    body = get_request_body(event)

    child_user_id = body.get('childUserId', '').strip()
    amount = body.get('amount')
    category = body.get('category', '').strip()
    description = body.get('description', '').strip()
    expense_date = body.get('expenseDate', '').strip()

    # If child is adding expense, use their own user ID
    if user_type == 'child':
        child_user_id = user_id

    if not child_user_id:
        raise LambdaError("Child user ID is required", 400)

    if amount is None or amount <= 0:
        raise LambdaError("Amount must be greater than 0", 400)

    if not category:
        raise LambdaError("Category is required", 400)

    if not description:
        raise LambdaError("Description is required", 400)

    # Validate category
    valid_categories = [
        'snacks', 'food', 'games', 'sports', 'school', 'crafts',
        'toys', 'books', 'clothes', 'entertainment', 'other'
    ]
    if category not in valid_categories:
        raise LambdaError(f"Invalid category. Must be one of: {', '.join(valid_categories)}", 400)

    # Parse expense date or use today
    if not expense_date:
        expense_date = datetime.utcnow().date().isoformat()
    else:
        # Validate date format
        try:
            datetime.fromisoformat(expense_date.replace('Z', '+00:00'))
        except ValueError:
            raise LambdaError("Invalid date format. Use YYYY-MM-DD", 400)

    if not family_id:
        raise LambdaError("Family account required", 400)

    db = DynamoDBClient()

    # Verify child belongs to family
    child_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        }
    )

    if not child_item:
        raise LambdaError("Child account not found", 404)

    # Check overdraft
    would_overdraft, new_balance = check_overdraft(
        db=db,
        child_user_id=child_user_id,
        family_id=family_id,
        expense_amount=amount
    )

    # Get family currency
    family_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': 'FAMILY'
        }
    )

    if not family_item:
        raise LambdaError("Family account not found", 404)

    currency = family_item.get('currency', 'CAD')

    # Update child balance atomically
    try:
        final_balance = update_child_balance(
            db=db,
            child_user_id=child_user_id,
            family_id=family_id,
            amount=amount,
            operation='subtract'
        )
    except Exception as e:
        raise LambdaError(f"Failed to update balance: {str(e)}", 500)

    # Create expense record
    expense = Expense(
        child_user_id=child_user_id,
        family_id=family_id,
        amount=amount,
        currency=currency,
        category=category,
        description=description,
        expense_date=expense_date,
        recorded_by=user_id,
        is_parent_recorded=(user_type == 'parent'),
        balance_after=final_balance,
        was_overdraft=would_overdraft or final_balance < 0
    )

    # Save transaction
    try:
        db.put_item(
            table_name=db.transactions_table,
            item=expense.to_dict()
        )
    except Exception as e:
        # Log error but don't fail - balance already updated
        print(f"Warning: Failed to save expense record: {str(e)}")

    return create_response(
        status_code=201,
        body={
            'message': 'Expense added successfully',
            'transactionId': expense.transaction_id,
            'amount': amount,
            'currency': currency,
            'newBalance': final_balance,
            'wasOverdraft': expense.was_overdraft,
            'overdraftWarning': expense.was_overdraft,
        }
    )
