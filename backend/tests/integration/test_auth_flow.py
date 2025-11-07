"""
Integration tests for authentication flow
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch, MagicMock

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.auth.signup_handler import handler as signup_handler
from src.lambdas.auth.verify_email_handler import handler as verify_handler
from src.lambdas.auth.login_handler import handler as login_handler


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({}),
        'headers': {},
    }


@pytest.fixture
def mock_context():
    """Create a mock Lambda context."""
    context = Mock()
    context.function_name = 'test-function'
    return context


@patch('src.lambdas.auth.signup_handler.DynamoDBClient')
@patch('src.lambdas.auth.signup_handler.send_verification_email')
@patch('src.lambdas.auth.verify_email_handler.DynamoDBClient')
@patch('src.lambdas.auth.login_handler.DynamoDBClient')
def test_complete_auth_flow(
    mock_login_db,
    mock_verify_db,
    mock_email,
    mock_signup_db,
    mock_event,
    mock_context
):
    """Test complete authentication flow: signup -> verify -> login."""
    # Setup signup mocks
    mock_signup_db_instance = Mock()
    mock_signup_db.return_value = mock_signup_db_instance
    mock_signup_db_instance.families_table = 'test-families-table'
    mock_signup_db_instance.query.return_value = []
    mock_signup_db_instance.put_item.return_value = None
    mock_email.return_value = True

    # Step 1: Signup
    signup_event = {
        'body': json.dumps({
            'email': 'test@example.com',
            'password': 'password123',
            'displayName': 'Test User'
        }),
        'headers': {},
    }

    signup_response = signup_handler(signup_event, mock_context)
    assert signup_response['statusCode'] == 201
    signup_body = json.loads(signup_response['body'])
    user_id = signup_body['userId']
    verification_token = 'test-verification-token'  # Would be from email in real flow

    # Setup verification mocks
    from datetime import datetime, timedelta
    future_time = datetime.utcnow() + timedelta(hours=1)

    mock_verify_db_instance = Mock()
    mock_verify_db.return_value = mock_verify_db_instance
    mock_verify_db_instance.auth_table = 'test-auth-table'
    mock_verify_db_instance.families_table = 'test-families-table'

    mock_verify_db_instance.get_item.side_effect = [
        {
            'token': verification_token,
            'SK': 'EMAIL_VERIFY',
            'email': 'test@example.com',
            'userId': user_id,
            'type': 'activation',
            'expiresAt': future_time.isoformat(),
            'createdAt': (future_time - timedelta(hours=1)).isoformat()
        }
    ]
    mock_verify_db_instance.update_item.return_value = None

    # Step 2: Verify email
    verify_event = {
        'body': json.dumps({
            'token': verification_token
        }),
        'headers': {},
    }

    verify_response = verify_handler(verify_event, mock_context)
    assert verify_response['statusCode'] == 200

    # Setup login mocks
    import bcrypt
    password_hash = bcrypt.hashpw('password123'.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

    mock_login_db_instance = Mock()
    mock_login_db.return_value = mock_login_db_instance
    mock_login_db_instance.families_table = 'test-families-table'
    mock_login_db_instance.query.return_value = [{
        'familyId': 'test-family-id',
        'SK': f'PARENT#{user_id}',
        'userId': user_id,
        'email': 'test@example.com',
        'passwordHash': password_hash,
        'emailVerified': True,
        'status': 'active',
        'displayName': 'Test User'
    }]

    # Step 3: Login
    login_event = {
        'body': json.dumps({
            'email': 'test@example.com',
            'password': 'password123'
        }),
        'headers': {},
    }

    login_response = login_handler(login_event, mock_context)
    assert login_response['statusCode'] == 200
    login_body = json.loads(login_response['body'])
    assert 'token' in login_body
    assert login_body['user']['email'] == 'test@example.com'
