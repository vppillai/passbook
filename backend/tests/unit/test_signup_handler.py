"""
Unit tests for signup handler
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch, MagicMock

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.auth.signup_handler import handler
from src.utils.lambda_handler import LambdaError


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({
            'email': 'test@example.com',
            'password': 'password123',
            'displayName': 'Test User'
        }),
        'headers': {},
        'requestContext': {
            'requestId': 'test-request-id'
        }
    }


@pytest.fixture
def mock_context():
    """Create a mock Lambda context."""
    context = Mock()
    context.function_name = 'test-function'
    context.memory_limit_in_mb = 128
    context.invoked_function_arn = 'arn:aws:lambda:us-west-2:123456789012:function:test'
    return context


@patch('src.lambdas.auth.signup_handler.DynamoDBClient')
@patch('src.lambdas.auth.signup_handler.send_verification_email')
def test_signup_success(mock_email, mock_db_client_class, mock_event, mock_context):
    """Test successful signup."""
    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    mock_db.query.return_value = []  # No existing user
    mock_db.put_item.return_value = None
    mock_email.return_value = True

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 201
    body = json.loads(response['body'])
    assert 'userId' in body
    assert body['email'] == 'test@example.com'
    assert mock_db.put_item.call_count == 2  # Parent account + email verification


@patch('src.lambdas.auth.signup_handler.DynamoDBClient')
def test_signup_duplicate_email(mock_db_client_class, mock_event, mock_context):
    """Test signup with duplicate email."""
    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    # Mock existing user - query returns results
    mock_db.query.return_value = [{'email': 'test@example.com'}]  # Existing user

    # Execute - wrapper catches exception and returns error response
    response = handler(mock_event, mock_context)

    # Assertions - check response status code
    assert response['statusCode'] == 409
    body = json.loads(response['body'])
    assert 'already registered' in body['error'].lower()


@patch('src.lambdas.auth.signup_handler.DynamoDBClient')
@patch('src.lambdas.auth.signup_handler.send_verification_email')
def test_signup_invalid_password(mock_email, mock_db_client_class, mock_event, mock_context):
    """Test signup with invalid password."""
    # Setup
    mock_event['body'] = json.dumps({
        'email': 'test@example.com',
        'password': 'short',  # Too short
        'displayName': 'Test User'
    })

    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    mock_db.query.return_value = []  # No existing user

    # Execute - wrapper catches exception
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'password' in body['error'].lower()


@patch('src.lambdas.auth.signup_handler.DynamoDBClient')
def test_signup_missing_fields(mock_db_client_class, mock_event, mock_context):
    """Test signup with missing required fields."""
    # Setup
    mock_event['body'] = json.dumps({
        'email': 'test@example.com'
        # Missing password and displayName
    })

    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Execute - wrapper catches exception
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 400
    body = json.loads(response['body'])
    assert 'required' in body['error'].lower()
