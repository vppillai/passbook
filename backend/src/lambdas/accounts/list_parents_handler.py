"""
Lambda handler for listing parents in a family.
"""
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_authorization_token, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import verify_token
from models.parent_account import ParentAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle list parents request."""
    # Verify authentication
    token = get_authorization_token(event)
    if not token:
        raise LambdaError("Authentication required", 401)

    try:
        payload = verify_token(token)
        family_id = payload.get('familyId')
    except Exception as e:
        raise LambdaError(f"Invalid token: {str(e)}", 401)

    if not family_id:
        raise LambdaError("Family account required", 400)

    db = DynamoDBClient()

    # Query all parents in the family
    parents_items = db.query(
        table_name=db.families_table,
        key_condition_expression='familyId = :familyId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':familyId': family_id,
            ':skPrefix': 'PARENT#'
        }
    )

    # Convert to parent account objects and serialize
    parents = []
    for item in parents_items:
        parent = ParentAccount.from_dict(item)
        parent_dict = parent.to_dict()
        # Remove sensitive data
        parent_dict.pop('passwordHash', None)
        parent_dict.pop('invitationToken', None)
        parents.append(parent_dict)

    return create_response(
        status_code=200,
        body={
            'parents': parents,
            'count': len(parents)
        }
    )
