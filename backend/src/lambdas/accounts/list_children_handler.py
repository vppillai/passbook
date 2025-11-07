"""
Lambda handler for listing children in a family.
"""
from src.utils.lambda_handler import lambda_handler_wrapper, create_response, get_authorization_token, LambdaError
from src.utils.db_client import DynamoDBClient
from src.utils.jwt_utils import verify_token
from src.models.child_account import ChildAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle list children request."""
    # Verify authentication
    token = get_authorization_token(event)
    if not token:
        raise LambdaError("Authentication required", 401)

    try:
        payload = verify_token(token)
        family_id = payload.get('familyId')
        user_type = payload.get('userType', 'parent')
    except Exception as e:
        raise LambdaError(f"Invalid token: {str(e)}", 401)

    if not family_id:
        raise LambdaError("Family account required", 400)

    db = DynamoDBClient()

    # Query all children in the family
    children_items = db.query(
        table_name=db.families_table,
        key_condition_expression='familyId = :familyId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':familyId': family_id,
            ':skPrefix': 'CHILD#'
        }
    )

    # Convert to child account objects and serialize
    children = []
    for item in children_items:
        child = ChildAccount.from_dict(item)
        child_dict = child.to_dict()
        # Remove sensitive data
        child_dict.pop('passwordHash', None)
        children.append(child_dict)

    return create_response(
        status_code=200,
        body={
            'children': children,
            'count': len(children)
        }
    )
