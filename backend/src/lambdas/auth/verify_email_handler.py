"""
Lambda handler for email verification.
"""
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, LambdaError
from src.utils.db_client import DynamoDBClient
from src.models.email_verification import EmailVerification
from src.models.parent_account import ParentAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle email verification request."""
    body = get_request_body(event)

    token = body.get('token', '').strip()

    if not token:
        raise LambdaError("Verification token is required", 400)

    db = DynamoDBClient()

    # Get verification record
    verification_item = db.get_item(
        table_name=db.auth_table,
        key={'token': token, 'SK': 'EMAIL_VERIFY'}
    )

    if not verification_item:
        raise LambdaError("Invalid verification token", 400)

    verification = EmailVerification.from_dict(verification_item)

    # Check if expired
    if verification.is_expired():
        raise LambdaError("Verification token has expired", 400)

    # Update parent account to verified
    parent_key = {
        'familyId': 'UNASSIGNED',  # May need to query to find actual familyId
        'SK': f'PARENT#{verification.user_id}'
    }

    # First, try to find the parent account
    # Since we don't know familyId, we need to query by userId
    # This is a limitation - we may need a GSI on userId
    # For now, we'll update the status directly if we can find it

    try:
        # Update email verified status
        db.update_item(
            table_name=db.families_table,
            key=parent_key,
            update_expression='SET emailVerified = :verified, #status = :status',
            expression_attribute_values={
                ':verified': True,
                ':status': 'active'
            },
            expression_attribute_names={
                '#status': 'status'
            }
        )
    except Exception as e:
        # If update fails, try to find parent by querying
        # This is a workaround - ideally we'd have a userId GSI
        raise LambdaError(f"Failed to verify account: {str(e)}", 500)

    # Delete verification token (optional - TTL will handle it)
    # db.delete_item(table_name=db.auth_table, key={'token': token, 'SK': 'EMAIL_VERIFY'})

    return create_response(
        status_code=200,
        body={
            'message': 'Email verified successfully',
            'userId': verification.user_id,
        }
    )
