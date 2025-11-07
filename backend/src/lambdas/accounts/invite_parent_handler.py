"""
Lambda handler for inviting a parent to join a family.
"""
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, get_authorization_token, LambdaError
from src.utils.db_client import DynamoDBClient
from src.utils.jwt_utils import verify_token
from src.utils.email_service import send_verification_email
from src.models.parent_account import ParentAccount
from src.models.email_verification import EmailVerification


@lambda_handler_wrapper
def handler(event, context):
    """Handle invite parent request."""
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
        raise LambdaError("Only parents can invite other parents", 403)

    if not family_id:
        raise LambdaError("Family account required", 400)

    body = get_request_body(event)

    email = body.get('email', '').strip().lower()

    if not email:
        raise LambdaError("Email is required", 400)

    # Basic email validation
    if '@' not in email or '.' not in email.split('@')[1]:
        raise LambdaError("Invalid email format", 400)

    db = DynamoDBClient()

    # Check if email already exists
    existing = db.query(
        table_name=db.families_table,
        key_condition_expression='email = :email',
        expression_attribute_values={':email': email},
        index_name='email-index'
    )

    if existing:
        # Check if already a parent in this family
        for item in existing:
            if item.get('SK', '').startswith('PARENT#') and item.get('familyId') == family_id:
                raise LambdaError("This email is already a parent in this family", 409)
            elif item.get('SK', '').startswith('PARENT#'):
                raise LambdaError("This email is already registered as a parent in another family", 409)

    # Get family account
    family_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': 'FAMILY'
        }
    )

    if not family_item:
        raise LambdaError("Family account not found", 404)

    # Create pending parent account
    parent = ParentAccount(
        email=email,
        display_name=email.split('@')[0],  # Default display name
        password_hash='',  # Will be set when they accept invitation
        family_id=family_id,
        status='pending',
        email_verified=False,
        invited_by=user_id
    )

    # Create invitation token
    verification = EmailVerification(
        email=email,
        user_id=parent.user_id,
        verification_type='invitation'
    )

    parent.invitation_token = verification.token
    parent.invitation_expiry = verification.expires_at

    # Save parent account
    try:
        db.put_item(
            table_name=db.families_table,
            item=parent.to_dict()
        )
    except Exception as e:
        raise LambdaError(f"Failed to create invitation: {str(e)}", 500)

    # Save verification token
    db.put_item(
        table_name=db.auth_table,
        item=verification.to_dict()
    )

    # Send invitation email
    email_sent = send_verification_email(email, verification.token, 'invitation')

    if not email_sent:
        print(f"Warning: Failed to send invitation email to {email}")

    return create_response(
        status_code=201,
        body={
            'message': 'Invitation sent successfully',
            'email': email,
            'expiresAt': verification.expires_at,
        }
    )
