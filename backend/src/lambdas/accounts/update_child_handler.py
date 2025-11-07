"""
Lambda handler for updating a child account.
"""
import bcrypt
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, get_authorization_token, get_path_parameter, LambdaError
from src.utils.db_client import DynamoDBClient
from src.utils.jwt_utils import verify_token
from src.utils.username_validator import is_username_unique, validate_username
from src.models.child_account import ChildAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle child account update request."""
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
        raise LambdaError("Only parents can update child accounts", 403)

    if not family_id:
        raise LambdaError("Family account required", 400)

    # Get child user ID from path
    child_user_id = get_path_parameter(event, 'childId')
    if not child_user_id:
        raise LambdaError("Child ID is required", 400)

    body = get_request_body(event)

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

    # Update fields
    update_expressions = []
    expression_attribute_values = {}
    expression_attribute_names = {}

    if 'displayName' in body:
        display_name = body['displayName'].strip()
        if display_name:
            update_expressions.append('#displayName = :displayName')
            expression_attribute_names['#displayName'] = 'displayName'
            expression_attribute_values[':displayName'] = display_name

    if 'username' in body:
        username = body['username'].strip() if body['username'] else None
        if username:
            # Validate username
            is_valid, error_msg = validate_username(username)
            if not is_valid:
                raise LambdaError(error_msg, 400)

            # Check uniqueness (excluding current user)
            if not is_username_unique(family_id, username, exclude_user_id=child_user_id):
                raise LambdaError("Username already exists in this family", 409)

            update_expressions.append('username = :username')
            expression_attribute_values[':username'] = username
        else:
            # Remove username
            update_expressions.append('remove username')

    if 'password' in body:
        password = body['password']
        if password:
            if len(password) < 6:
                raise LambdaError("Password must be at least 6 characters", 400)
            password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            update_expressions.append('passwordHash = :passwordHash')
            expression_attribute_values[':passwordHash'] = password_hash

    if 'overdraftLimit' in body:
        overdraft_limit = float(body['overdraftLimit'])
        update_expressions.append('overdraftLimit = :overdraftLimit')
        expression_attribute_values[':overdraftLimit'] = overdraft_limit

    if 'notificationsEnabled' in body:
        notifications_enabled = bool(body['notificationsEnabled'])
        update_expressions.append('notificationsEnabled = :notificationsEnabled')
        expression_attribute_values[':notificationsEnabled'] = notifications_enabled

    if not update_expressions:
        raise LambdaError("No fields to update", 400)

    # Add updated timestamp
    from datetime import datetime
    update_expressions.append('updatedAt = :updatedAt')
    expression_attribute_values[':updatedAt'] = datetime.utcnow().isoformat()

    # Perform update
    update_expression = 'SET ' + ', '.join(update_expressions)

    db.update_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        },
        update_expression=update_expression,
        expression_attribute_values=expression_attribute_values,
        expression_attribute_names=expression_attribute_names if expression_attribute_names else None
    )

    return create_response(
        status_code=200,
        body={
            'message': 'Child account updated successfully',
            'childId': child_user_id
        }
    )
