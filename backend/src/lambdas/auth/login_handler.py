"""
Lambda handler for user login (parent or child).
"""
import bcrypt
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import generate_token
from models.parent_account import ParentAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle user login request."""
    body = get_request_body(event)

    email = body.get('email', '').strip().lower()
    username = body.get('username', '').strip()
    password = body.get('password', '')

    if not password:
        raise LambdaError("Password is required", 400)

    if not email and not username:
        raise LambdaError("Email or username is required", 400)

    db = DynamoDBClient()

    # Find user by email or username
    user_item = None

    if email:
        # Query by email using GSI
        results = db.query(
            table_name=db.families_table,
            key_condition_expression='email = :email',
            expression_attribute_values={':email': email},
            index_name='email-index'
        )

        if results:
            # Find parent account
            for item in results:
                if item.get('SK', '').startswith('PARENT#'):
                    user_item = item
                    break

    elif username:
        # For child accounts, query by username
        # This requires knowing the familyId, which we don't have at login
        # For now, we'll search through families (inefficient but works)
        # TODO: Add username-based login support with proper indexing
        raise LambdaError("Username login not yet implemented", 501)

    if not user_item:
        raise LambdaError("Invalid email or password", 401)

    # Verify password
    stored_hash = user_item.get('passwordHash', '')
    if not stored_hash:
        raise LambdaError("Invalid email or password", 401)

    try:
        if not bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8')):
            raise LambdaError("Invalid email or password", 401)
    except Exception:
        raise LambdaError("Invalid email or password", 401)

    # Check if account is active
    parent = ParentAccount.from_dict(user_item)

    if not parent.can_login():
        raise LambdaError("Account is not active. Please verify your email.", 403)

    # Update last login
    try:
        from datetime import datetime
        db.update_item(
            table_name=db.families_table,
            key={
                'familyId': parent.family_id or 'UNASSIGNED',
                'SK': f'PARENT#{parent.user_id}'
            },
            update_expression='SET lastLoginAt = :loginAt',
            expression_attribute_values={
                ':loginAt': datetime.utcnow().isoformat()
            }
        )
    except Exception:
        # Log but don't fail login
        pass

    # Generate JWT token
    token = generate_token(
        user_id=parent.user_id,
        email=parent.email,
        family_id=parent.family_id,
        user_type='parent'
    )

    return create_response(
        status_code=200,
        body={
            'token': token,
            'user': {
                'userId': parent.user_id,
                'email': parent.email,
                'displayName': parent.display_name,
                'userType': 'parent',
                'familyId': parent.family_id,
            }
        }
    )
