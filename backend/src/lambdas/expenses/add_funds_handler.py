"""
Lambda handler for adding funds to a child account.
"""
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, get_authorization_token, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import verify_token
from utils.balance_manager import update_child_balance
from models.fund_addition import FundAddition


@lambda_handler_wrapper
def handler(event, context):
    """Handle add funds request."""
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

    if user_type != 'parent':
        raise LambdaError("Only parents can add funds", 403)

    if not family_id:
        raise LambdaError("Family account required", 400)

    body = get_request_body(event)

    child_user_id = body.get('childUserId', '').strip()
    amount = body.get('amount')
    reason = body.get('reason', '').strip()

    if not child_user_id:
        raise LambdaError("Child user ID is required", 400)

    if amount is None or amount <= 0:
        raise LambdaError("Amount must be greater than 0", 400)

    if not reason:
        raise LambdaError("Reason is required", 400)

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
        new_balance = update_child_balance(
            db=db,
            child_user_id=child_user_id,
            family_id=family_id,
            amount=amount,
            operation='add'
        )
    except Exception as e:
        raise LambdaError(f"Failed to update balance: {str(e)}", 500)

    # Create fund addition record
    fund_addition = FundAddition(
        child_user_id=child_user_id,
        family_id=family_id,
        amount=amount,
        currency=currency,
        reason=reason,
        added_by=user_id,
        balance_after=new_balance
    )

    # Save transaction
    try:
        db.put_item(
            table_name=db.transactions_table,
            item=fund_addition.to_dict()
        )
    except Exception as e:
        # Log error but don't fail - balance already updated
        print(f"Warning: Failed to save fund addition record: {str(e)}")

    return create_response(
        status_code=201,
        body={
            'message': 'Funds added successfully',
            'transactionId': fund_addition.transaction_id,
            'amount': amount,
            'currency': currency,
            'newBalance': new_balance,
        }
    )
