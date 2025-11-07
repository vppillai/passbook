"""
Lambda handler for resetting a child account password.
"""
import bcrypt
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, get_authorization_token, get_path_parameter, LambdaError
from src.utils.db_client import DynamoDBClient
from src.utils.jwt_utils import verify_token
from datetime import datetime


@lambda_handler_wrapper
def handler(event, context):
    """Handle child password reset request."""
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

    # Get child user ID from path
    child_user_id = get_path_parameter(event, 'childId')
    if not child_user_id:
        raise LambdaError("Child ID is required", 400)

    body = get_request_body(event)
    new_password = body.get('password', '')

    if not new_password:
        raise LambdaError("New password is required", 400)

    if len(new_password) < 6:
        raise LambdaError("Password must be at least 6 characters", 400)

    db = DynamoDBClient()

    # Get child account
    child_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        }
    )

    if not child_item:
        raise LambdaError("Child account not found", 404)

    # Verify permissions
    # Parents can reset any child in their family
    # Children can reset their own password (if email-based)
    if user_type == 'child' and child_user_id != user_id:
        raise LambdaError("You can only reset your own password", 403)

    if user_type == 'parent' and child_item.get('familyId') != family_id:
        raise LambdaError("Child account not found", 404)

    # Hash new password
    password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    # Update password
    db.update_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        },
        update_expression='SET passwordHash = :passwordHash, passwordChangedAt = :changedAt',
        expression_attribute_values={
            ':passwordHash': password_hash,
            ':changedAt': datetime.utcnow().isoformat()
        }
    )

    return create_response(
        status_code=200,
        body={
            'message': 'Password reset successfully',
            'childId': child_user_id
        }
    )
