"""
Unit tests for fund addition handler
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.expenses.add_funds_handler import handler
from src.utils.lambda_handler import LambdaError


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({
            'childUserId': 'child-user-id',
            'amount': 25.0,
            'reason': 'Weekly allowance'
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


@patch('src.lambdas.expenses.add_funds_handler.verify_token')
@patch('src.lambdas.expenses.add_funds_handler.DynamoDBClient')
def test_add_funds_success(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test successful fund addition."""
    # Setup mocks
    mock_verify_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.transactions_table = 'test-transactions-table'
    mock_db.families_table = 'test-families-table'

    # Mock child account - get_item will be called multiple times
    # First call: verify child (in handler)
    # Second call: get family (in handler)
    # Third call: get child again (in update_child_balance)
    mock_db.get_item.side_effect = [
        {
            'familyId': 'test-family-id',
            'SK': 'CHILD#child-user-id',
            'userId': 'child-user-id',
            'displayName': 'Test Child',
            'currentBalance': 50.0,
            'username': 'testchild',
            'status': 'active',
            'passwordHash': 'hashed-password',
            'createdBy': 'parent-id'
        },
        {
            'familyId': 'test-family-id',
            'SK': 'FAMILY',
            'familyName': 'Test Family',
            'currency': 'CAD'
        },
        {
            'familyId': 'test-family-id',
            'SK': 'CHILD#child-user-id',
            'userId': 'child-user-id',
            'displayName': 'Test Child',
            'currentBalance': 50.0,
            'username': 'testchild',
            'status': 'active',
            'passwordHash': 'hashed-password',
            'createdBy': 'parent-id'
        }
    ]

    mock_db.put_item.return_value = None
    mock_db.update_item.return_value = None  # Make sure this is set properly

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 201
    body = json.loads(response['body'])
    assert 'transactionId' in body
    assert body['amount'] == 25.0
    assert 'newBalance' in body


@patch('src.lambdas.expenses.add_funds_handler.verify_token')
@patch('src.lambdas.expenses.add_funds_handler.DynamoDBClient')
def test_add_funds_unauthorized(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test fund addition without parent authentication."""
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
