"""
Lambda handler for creating a child account.
"""
import bcrypt
from decimal import Decimal
from utils.lambda_handler import lambda_handler_wrapper, create_response, get_request_body, get_authorization_token, LambdaError
from utils.db_client import DynamoDBClient
from utils.jwt_utils import verify_token
from utils.username_validator import is_username_unique, validate_username
from models.child_account import ChildAccount


@lambda_handler_wrapper
def handler(event, context):
    """Handle child account creation request."""
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
        raise LambdaError("Only parents can create child accounts", 403)

    if not family_id:
        raise LambdaError("Parent must have a family account to create children", 400)

    body = get_request_body(event)

    display_name = body.get('displayName', '').strip()
    username = body.get('username', '').strip()
    email = body.get('email', '').strip()
    password = body.get('password', '')
    weekly_allowance = body.get('weeklyAllowance', 0)
    funding_period_type = body.get('fundingPeriodType', 'weekly')  # weekly, biweekly, monthly
    funding_start_date = body.get('fundingStartDate')  # ISO date string

    # Convert to Decimal for DynamoDB
    if isinstance(weekly_allowance, (int, float)):
        weekly_allowance = Decimal(str(weekly_allowance))
    elif isinstance(weekly_allowance, str):
        weekly_allowance = Decimal(weekly_allowance)
    
    # Validate funding period type
    valid_periods = ['weekly', 'biweekly', 'monthly']
    if funding_period_type not in valid_periods:
        raise LambdaError(f"Invalid funding period type. Must be one of: {', '.join(valid_periods)}", 400)

    if not display_name:
        raise LambdaError("Display name is required", 400)

    if not username and not email:
        raise LambdaError("Either username or email is required", 400)

    if not password:
        raise LambdaError("Password is required", 400)

    if len(password) < 6:
        raise LambdaError("Password must be at least 6 characters", 400)

    db = DynamoDBClient()

    # Validate username if provided
    if username:
        is_valid, error_msg = validate_username(username)
        if not is_valid:
            raise LambdaError(error_msg, 400)

        # Check uniqueness globally
        if not is_username_unique(username):
            raise LambdaError("Username already exists", 409)

    # Check email uniqueness if provided
    if email:
        # Query by email (would need email GSI for children, or check manually)
        # For now, we'll allow email-based child accounts but uniqueness check is limited
        pass

    # Hash password
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    # Create funding period configuration
    funding_period = {
        'type': funding_period_type,
        'amount': str(weekly_allowance)
    }
    if funding_start_date:
        funding_period['startDate'] = funding_start_date

    # Create child account
    child = ChildAccount(
        family_id=family_id,
        display_name=display_name,
        password_hash=password_hash,
        created_by=user_id,
        username=username if username else None,
        email=email if email else None,
        funding_period=funding_period
    )

    # Save to DynamoDB
    try:
        db.put_item(
            table_name=db.families_table,
            item=child.to_dict()
        )

        # If username provided, ensure it's indexed (GSI will handle this automatically)
        # But we may need to create a separate index entry for username lookup
    except Exception as e:
        raise LambdaError(f"Failed to create child account: {str(e)}", 500)

    return create_response(
        status_code=201,
        body={
            'message': 'Child account created successfully',
            'child': {
                'userId': child.user_id,
                'displayName': child.display_name,
                'username': child.username,
                'email': child.email,
                'fundingPeriod': child.funding_period
            }
        }
    )
