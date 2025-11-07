"""
Unit tests for child account creation
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.accounts.create_child_handler import handler
from src.utils.lambda_handler import LambdaError


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({
            'displayName': 'Alice Smith',
            'username': 'alice',
            'password': 'password123'
        }),
        'headers': {
            'Authorization': 'Bearer test-token'
        },
    }


@pytest.fixture
def mock_context():
    """Create a mock Lambda context."""
    context = Mock()
    context.function_name = 'test-function'
    return context


@patch('src.lambdas.accounts.create_child_handler.verify_token')
@patch('src.lambdas.accounts.create_child_handler.DynamoDBClient')
def test_create_child_success(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test successful child account creation."""
    # Setup mocks
    mock_verify_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    mock_db.transactions_table = 'test-transactions-table'

    # Mock username uniqueness check
    mock_db.query.return_value = []
    mock_db.put_item.return_value = None

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 201
    body = json.loads(response['body'])
    assert 'child' in body
    assert body['child']['username'] == 'alice'
    assert body['child']['displayName'] == 'Alice Smith'


@patch('src.lambdas.accounts.create_child_handler.verify_token')
@patch('src.lambdas.accounts.create_child_handler.DynamoDBClient')
def test_create_child_duplicate_username(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test child creation with duplicate username."""
    # Setup mocks
    mock_verify_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    mock_db.transactions_table = 'test-transactions-table'

    # Mock existing username - is_username_unique returns False
    # We need to patch the username validator
    with patch('src.lambdas.accounts.create_child_handler.is_username_unique') as mock_unique:
        mock_unique.return_value = False  # Username not unique

        # Execute - wrapper catches exception
        response = handler(mock_event, mock_context)

        # Assertions - check response status code
        assert response['statusCode'] == 409
        body = json.loads(response['body'])
        assert 'username' in body['error'].lower()


@patch('src.lambdas.accounts.create_child_handler.verify_token')
@patch('src.lambdas.accounts.create_child_handler.DynamoDBClient')
def test_create_child_unauthorized(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test child creation without parent authentication."""
    # Setup mocks - verify_token raises exception
    mock_verify_token.side_effect = Exception("Invalid token")

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db

    # Execute - wrapper catches exception
    response = handler(mock_event, mock_context)

    # Assertions - check response status code
    assert response['statusCode'] == 401
    body = json.loads(response['body'])
    assert 'invalid token' in body['error'].lower() or 'authentication' in body['error'].lower()
