"""
Integration tests for child management flow
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.accounts.create_child_handler import handler as create_child_handler
from src.lambdas.accounts.list_children_handler import handler as list_children_handler
from src.lambdas.accounts.update_child_handler import handler as update_child_handler


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


@patch('src.lambdas.accounts.create_child_handler.verify_token')
@patch('src.lambdas.accounts.create_child_handler.DynamoDBClient')
@patch('src.lambdas.accounts.list_children_handler.verify_token')
@patch('src.lambdas.accounts.list_children_handler.DynamoDBClient')
def test_child_management_flow(
    mock_list_db,
    mock_list_token,
    mock_create_db,
    mock_create_token,
    mock_event,
    mock_context
):
    """Test complete child management flow: create -> list -> update."""
    # Setup token mocks
    mock_create_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }
    mock_list_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    # Setup create child mocks
    mock_create_db_instance = Mock()
    mock_create_db.return_value = mock_create_db_instance
    mock_create_db_instance.families_table = 'test-families-table'
    mock_create_db_instance.transactions_table = 'test-transactions-table'
    mock_create_db_instance.query.return_value = []  # No duplicate username
    mock_create_db_instance.put_item.return_value = None

    # Step 1: Create child
    create_event = {
        'body': json.dumps({
            'displayName': 'Alice Smith',
            'username': 'alice',
            'password': 'password123'
        }),
        'headers': {
            'Authorization': 'Bearer test-token'
        },
    }

    create_response = create_child_handler(create_event, mock_context)
    assert create_response['statusCode'] == 201
    create_body = json.loads(create_response['body'])
    child_id = create_body['child']['userId']

    # Setup list children mocks
    mock_list_db_instance = Mock()
    mock_list_db.return_value = mock_list_db_instance
    mock_list_db_instance.families_table = 'test-families-table'
    mock_list_db_instance.query.return_value = [{
        'familyId': 'test-family-id',
        'SK': f'CHILD#{child_id}',
        'userId': child_id,
        'displayName': 'Alice Smith',
        'username': 'alice',
        'currentBalance': 0.0,
        'status': 'active',
        'passwordHash': 'hashed-password',
        'createdBy': 'parent-user-id'
    }]

    # Step 2: List children
    list_event = {
        'headers': {
            'Authorization': 'Bearer test-token'
        },
    }

    list_response = list_children_handler(list_event, mock_context)
    assert list_response['statusCode'] == 200
    list_body = json.loads(list_response['body'])
    assert len(list_body['children']) == 1
    assert list_body['children'][0]['username'] == 'alice'
