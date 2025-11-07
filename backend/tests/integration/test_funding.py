"""
Integration tests for funding flow
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.expenses.add_funds_handler import handler as add_funds_handler
from src.lambdas.accounts.list_children_handler import handler as list_children_handler


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({}),
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
@patch('src.lambdas.accounts.list_children_handler.verify_token')
@patch('src.lambdas.accounts.list_children_handler.DynamoDBClient')
def test_funding_flow(
    mock_list_db,
    mock_list_token,
    mock_funds_db,
    mock_funds_token,
    mock_event,
    mock_context
):
    """Test complete funding flow: add funds -> verify balance updated."""
    # Setup token mocks
    mock_funds_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }
    mock_list_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    # Setup add funds mocks
    mock_funds_db_instance = Mock()
    mock_funds_db.return_value = mock_funds_db_instance
    mock_funds_db_instance.transactions_table = 'test-transactions-table'
    mock_funds_db_instance.families_table = 'test-families-table'

    # Mock child account with initial balance
    mock_funds_db_instance.get_item.return_value = {
        'userId': 'child-user-id',
        'currentBalance': 50.0
    }
    mock_funds_db_instance.put_item.return_value = None
    mock_funds_db_instance.update_item.return_value = None

    # Step 1: Add funds
    add_funds_event = {
        'body': json.dumps({
            'childUserId': 'child-user-id',
            'amount': 25.0,
            'reason': 'Weekly allowance'
        }),
        'headers': {
            'Authorization': 'Bearer test-token'
        },
    }

    add_funds_response = add_funds_handler(add_funds_event, mock_context)
    assert add_funds_response['statusCode'] == 201
    add_funds_body = json.loads(add_funds_response['body'])
    assert add_funds_body['amount'] == 25.0
    assert add_funds_body['newBalance'] == 75.0  # 50 + 25

    # Setup list children mocks to verify updated balance
    mock_list_db_instance = Mock()
    mock_list_db.return_value = mock_list_db_instance
    mock_list_db_instance.families_table = 'test-families-table'
    mock_list_db_instance.query.return_value = [{
        'userId': 'child-user-id',
        'displayName': 'Alice Smith',
        'currentBalance': 75.0,  # Updated balance
        'status': 'active'
    }]

    # Step 2: List children to verify balance updated
    list_event = {
        'headers': {
            'Authorization': 'Bearer test-token'
        },
    }

    list_response = list_children_handler(list_event, mock_context)
    assert list_response['statusCode'] == 200
    list_body = json.loads(list_response['body'])
    assert len(list_body['children']) == 1
    assert list_body['children'][0]['currentBalance'] == 75.0
