"""
Lambda handler for child login.
"""
import bcrypt
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import generate_token
from models.child_account import ChildAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle child login request."""
    body = get_request_body(event)

    identifier = body.get('identifier', '').strip()
    password = body.get('password', '')

    if not password:
        raise LambdaError("Password is required", 400)

    if not identifier:
        raise LambdaError("Username or email is required", 400)

    db = DynamoDBClient()
    child_item = None

    # Check if identifier is an email (contains @)
    if '@' in identifier:
        email = identifier.lower()
        # Query by email using GSI
        results = db.query(
            table_name=db.families_table,
            key_condition_expression='email = :email',
            expression_attribute_values={':email': email},
            index_name='email-index'
        )

        if results:
            # Find child account
            for item in results:
                if item.get('SK', '').startswith('CHILD#'):
                    child_item = item
                    break
    else:
        # Username login - query username-global-index
        username = identifier.lower()
        try:
            results = db.query(
                table_name=db.families_table,
                key_condition_expression='username = :username',
                expression_attribute_values={':username': username},
                index_name='username-global-index'
            )

            if results:
                # Should only be one result since usernames are globally unique
                for item in results:
                    if item.get('SK', '').startswith('CHILD#'):
                        child_item = item
                        break
        except Exception as e:
            # If index doesn't exist yet, fall back to scan
            print(f"Warning: username-global-index not available: {e}")
            results = db.scan(
                table_name=db.families_table,
                filter_expression='username = :username AND begins_with(SK, :skPrefix)',
                expression_attribute_values={
                    ':username': username,
                    ':skPrefix': 'CHILD#'
                }
            )
            if results:
                child_item = results[0]

    if not child_item:
        raise LambdaError("Invalid username or password", 401)

    # Verify password
    stored_hash = child_item.get('passwordHash', '')
    if not stored_hash:
        raise LambdaError("Invalid username or password", 401)

    try:
        if not bcrypt.checkpw(password.encode('utf-8'), stored_hash.encode('utf-8')):
            raise LambdaError("Invalid username or password", 401)
    except Exception:
        raise LambdaError("Invalid username or password", 401)

    # Check if account is active
    child = ChildAccount.from_dict(child_item)

    if not child.is_active():
        raise LambdaError("Account is not active", 403)

    # Update last activity
    try:
        from datetime import datetime
        db.update_item(
            table_name=db.families_table,
            key={
                'familyId': child.family_id,
                'SK': f'CHILD#{child.user_id}'
            },
            update_expression='SET lastActivityAt = :activityAt',
            expression_attribute_values={
                ':activityAt': datetime.utcnow().isoformat()
            }
        )
    except Exception:
        # Log but don't fail login
        pass

    # Generate JWT token
    token = generate_token(
        user_id=child.user_id,
        email=child.email,
        family_id=child.family_id,
        user_type='child'
    )

    return create_response(
        status_code=200,
        body={
            'token': token,
            'user': {
                'userId': child.user_id,
                'username': child.username,
                'email': child.email,
                'displayName': child.display_name,
                'userType': 'child',
                'familyId': child.family_id,
            }
        }
    )

