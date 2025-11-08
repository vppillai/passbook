"""
Lambda handler for deleting a child account.
"""
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_authorization_token, get_path_parameter, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import verify_token
from models.child_account import ChildAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle child account deletion request."""
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
        raise LambdaError("Only parents can delete child accounts", 403)

    if not family_id:
        raise LambdaError("Family account required", 400)

    # Get child user ID from path
    child_user_id = get_path_parameter(event, 'childId')
    if not child_user_id:
        raise LambdaError("Child ID is required", 400)

    db = DynamoDBClient()

    # Get existing child account
    child_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        }
    )

    if not child_item:
        raise LambdaError("Child account not found", 404)

    child = ChildAccount.from_dict(child_item)

    # Verify child belongs to parent's family
    if child.family_id != family_id:
        raise LambdaError("Child account not found", 404)

    # Delete the child account from the families table
    db.delete_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        }
    )

    # Also delete any associated transactions (expenses and funds) for this child
    # Query all transactions for this child
    transactions = db.query(
        table_name=db.transactions_table,
        key_condition_expression='childUserId = :childUserId',
        expression_attribute_values={
            ':childUserId': child_user_id
        }
    )

    # Delete each transaction
    for transaction in transactions:
        db.delete_item(
            table_name=db.transactions_table,
            key={
                'childUserId': transaction['childUserId'],
                'SK': transaction['SK']
            }
        )

    return create_response(
        status_code=200,
        body={
            'message': 'Child account deleted successfully',
            'childId': child_user_id,
            'deletedTransactions': len(transactions)
        }
    )
