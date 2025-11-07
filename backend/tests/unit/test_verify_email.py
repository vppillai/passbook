"""
Unit tests for email verification handler
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.auth.verify_email_handler import handler
from src.utils.lambda_handler import LambdaError


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({
            'token': 'test-verification-token'
        }),
        'headers': {},
    }


@pytest.fixture
def mock_context():
    """Create a mock Lambda context."""
    context = Mock()
    context.function_name = 'test-function'
    return context


@patch('src.lambdas.auth.verify_email_handler.DynamoDBClient')
def test_verify_email_success(mock_db_client_class, mock_event, mock_context):
    """Test successful email verification."""
    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.auth_table = 'test-auth-table'
    mock_db.families_table = 'test-families-table'

    # Mock verification token lookup
    future_time = datetime.utcnow() + timedelta(hours=1)
    mock_db.get_item.side_effect = [
        {  # First call - verification token
            'token': 'test-verification-token',
            'SK': 'EMAIL_VERIFY',
            'email': 'test@example.com',
            'userId': 'test-user-id',
            'type': 'activation',
            'expiresAt': future_time.isoformat(),
            'createdAt': (future_time - timedelta(hours=1)).isoformat()
        },
    ]

    mock_db.update_item.return_value = None

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert 'verified successfully' in body['message'].lower()
    assert mock_db.update_item.call_count >= 1


@patch('src.lambdas.auth.verify_email_handler.DynamoDBClient')
def test_verify_email_invalid_token(mock_db_client_class, mock_event, mock_context):
    """Test verification with invalid token."""
    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.auth_table = 'test-auth-table'
    mock_db.get_item.return_value = None  # Token not found

    # Execute - wrapper catches exception
    response = handler(mock_event, mock_context)

    # Assertions - check response status code
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'invalid' in body['error'].lower() or 'not found' in body['error'].lower()


@patch('src.lambdas.auth.verify_email_handler.DynamoDBClient')
def test_verify_email_expired_token(mock_db_client_class, mock_event, mock_context):
    """Test verification with expired token."""
    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.auth_table = 'test-auth-table'

    # Mock expired token
    past_time = datetime.utcnow() - timedelta(hours=2)
    mock_db.get_item.return_value = {
        'token': 'test-verification-token',
        'SK': 'EMAIL_VERIFY',
        'email': 'test@example.com',
        'userId': 'test-user-id',
        'type': 'activation',
        'expiresAt': past_time.isoformat(),
        'createdAt': (past_time - timedelta(hours=1)).isoformat()
    }

    # Execute - wrapper catches exception
    response = handler(mock_event, mock_context)

    # Assertions - check response status code
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'expired' in body['error'].lower()
