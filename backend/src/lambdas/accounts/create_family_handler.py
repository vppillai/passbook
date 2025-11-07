"""
Lambda handler for creating a family account.
"""
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, get_authorization_token, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import verify_token
from models.family_account import FamilyAccount
from models.parent_account import ParentAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle family account creation request."""
    # Verify authentication
    token = get_authorization_token(event)
    if not token:
        raise LambdaError("Authentication required", 401)

    try:
        payload = verify_token(token)
        user_id = payload['userId']
        user_type = payload.get('userType', 'parent')
    except Exception as e:
        raise LambdaError(f"Invalid token: {str(e)}", 401)

    if user_type != 'parent':
        raise LambdaError("Only parents can create family accounts", 403)

    body = get_request_body(event)

    family_name = body.get('familyName', '').strip()
    currency = body.get('currency', 'CAD')
    timezone = body.get('timezone', 'America/Toronto')
    description = body.get('description', '').strip()

    if not family_name:
        raise LambdaError("Family name is required", 400)

    db = DynamoDBClient()

    # Check if user already has a family
    existing_parent = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': 'UNASSIGNED',
            'SK': f'PARENT#{user_id}'
        }
    )

    if existing_parent:
        parent = ParentAccount.from_dict(existing_parent)
        if parent.family_id and parent.family_id != 'UNASSIGNED':
            # Check if family already exists
            family_item = db.get_item(
                table_name=db.families_table,
                key={
                    'familyId': parent.family_id,
                    'SK': 'FAMILY'
                }
            )
            if family_item:
                raise LambdaError("User already has a family account", 409)

    # Create family account
    family = FamilyAccount(
        family_name=family_name,
        created_by=user_id,
        currency=currency,
        timezone=timezone,
        description=description if description else None
    )

    # Save family account
    db.put_item(
        table_name=db.families_table,
        item=family.to_dict()
    )

    # Update parent account with family ID
    parent_key = {
        'familyId': 'UNASSIGNED',
        'SK': f'PARENT#{user_id}'
    }

    # First, get the parent to update
    parent_item = db.get_item(
        table_name=db.families_table,
        key=parent_key
    )

    if not parent_item:
        raise LambdaError("Parent account not found", 404)

    # Delete old parent record and create new one with familyId
    db.delete_item(
        table_name=db.families_table,
        key=parent_key
    )

    parent = ParentAccount.from_dict(parent_item)
    parent.family_id = family.family_id

    # Save parent with new familyId
    db.put_item(
        table_name=db.families_table,
        item=parent.to_dict()
    )

    return create_response(
        status_code=201,
        body={
            'message': 'Family account created successfully',
            'family': {
                'familyId': family.family_id,
                'familyName': family.family_name,
                'currency': family.currency,
                'timezone': family.timezone,
            }
        }
    )
