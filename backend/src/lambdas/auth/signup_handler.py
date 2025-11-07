"""
Lambda handler for parent account signup.
"""
import os
import bcrypt
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, LambdaError
from src.utils.db_client import DynamoDBClient
from src.utils.email_service import send_verification_email
from src.models.parent_account import ParentAccount
from src.models.email_verification import EmailVerification


@lambda_handler_wrapper
def handler(event, context):
    """Handle parent account signup request."""
    body = get_request_body(event)

    # Validate input
    email = body.get('email', '').strip().lower()
    password = body.get('password', '')
    display_name = body.get('displayName', '').strip()

    if not email or not password or not display_name:
        raise LambdaError("Email, password, and display name are required", 400)

    if len(password) < 8:
        raise LambdaError("Password must be at least 8 characters", 400)

    # Check if email already exists
    db = DynamoDBClient()

    # Query by email using GSI
    try:
        existing = db.query(
            table_name=db.families_table,
            key_condition_expression='email = :email',
            expression_attribute_values={':email': email},
            index_name='email-index'
        )

        if existing:
            raise LambdaError("Email already registered", 409)
    except Exception as e:
        if "Email already registered" in str(e):
            raise
        # If GSI doesn't exist yet or other error, continue (will fail on put_item if duplicate)

    # Hash password
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    # Create parent account
    parent = ParentAccount(
        email=email,
        display_name=display_name,
        password_hash=password_hash,
        status='pending',
        email_verified=False
    )

    # Save to DynamoDB
    try:
        db.put_item(
            table_name=db.families_table,
            item=parent.to_dict(),
            condition_expression='attribute_not_exists(familyId) OR attribute_not_exists(SK)'
        )
    except Exception as e:
        if "Condition check failed" in str(e):
            raise LambdaError("Email already registered", 409)
        raise LambdaError(f"Failed to create account: {str(e)}", 500)

    # Create email verification token
    verification = EmailVerification(
        email=email,
        user_id=parent.user_id,
        verification_type='activation'
    )

    # Save verification token
    db.put_item(
        table_name=db.auth_table,
        item=verification.to_dict()
    )

    # Send verification email
    email_sent = send_verification_email(email, verification.token, 'activation')

    if not email_sent:
        # Log error but don't fail signup
        print(f"Warning: Failed to send verification email to {email}")

    return create_response(
        status_code=201,
        body={
            'message': 'Account created. Please check your email to verify your account.',
            'userId': parent.user_id,
            'email': email,
        }
    )
