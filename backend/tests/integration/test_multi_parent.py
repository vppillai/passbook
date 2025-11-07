"""
Integration tests for multi-parent family management
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch
from datetime import datetime, timedelta

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.accounts.invite_parent_handler import handler as invite_handler
from src.lambdas.accounts.list_parents_handler import handler as list_parents_handler
from src.lambdas.accounts.create_child_handler import handler as create_child_handler


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


@patch('src.lambdas.accounts.invite_parent_handler.verify_token')
@patch('src.lambdas.accounts.invite_parent_handler.DynamoDBClient')
@patch('src.lambdas.accounts.invite_parent_handler.send_verification_email')
@patch('src.lambdas.accounts.list_parents_handler.verify_token')
@patch('src.lambdas.accounts.list_parents_handler.DynamoDBClient')
@patch('src.lambdas.accounts.create_child_handler.verify_token')
@patch('src.lambdas.accounts.create_child_handler.DynamoDBClient')
def test_multi_parent_flow(
    mock_create_db,
    mock_create_token,
    mock_list_db,
    mock_list_token,
    mock_email,
    mock_invite_db,
    mock_invite_token,
    mock_event,
    mock_context
):
    """Test multi-parent flow: invite -> list -> both can manage children."""
    # Setup token mocks
    mock_invite_token.return_value = {
        'userId': 'parent1-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }
    mock_list_token.return_value = {
        'userId': 'parent1-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }
    mock_create_token.return_value = {
        'userId': 'parent2-id',  # Second parent
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    # Setup invite parent mocks
    mock_invite_db_instance = Mock()
    mock_invite_db.return_value = mock_invite_db_instance
    mock_invite_db_instance.families_table = 'test-families-table'
    mock_invite_db_instance.auth_table = 'test-auth-table'
    mock_invite_db_instance.query.return_value = []
    mock_invite_db_instance.get_item.return_value = {
        'familyId': 'test-family-id',
        'SK': 'FAMILY',
        'familyName': 'Test Family'
    }
    mock_invite_db_instance.put_item.return_value = None
    mock_email.return_value = True

    # Step 1: Invite second parent
    invite_event = {
        'body': json.dumps({
            'email': 'parent2@example.com'
        }),
        'headers': {
            'Authorization': 'Bearer test-token'
        },
    }

    invite_response = invite_handler(invite_event, mock_context)
    assert invite_response['statusCode'] == 201

    # Setup list parents mocks
    mock_list_db_instance = Mock()
    mock_list_db.return_value = mock_list_db_instance
    mock_list_db_instance.families_table = 'test-families-table'
    mock_list_db_instance.query.return_value = [
        {
            'familyId': 'test-family-id',
            'SK': 'PARENT#parent1-id',
            'email': 'parent1@example.com',
            'status': 'active'
        },
        {
            'familyId': 'test-family-id',
            'SK': 'PARENT#parent2-id',
            'email': 'parent2@example.com',
            'status': 'pending'
        }
    ]

    # Step 2: List parents
    list_event = {
        'headers': {
            'Authorization': 'Bearer test-token'
        },
    }

    list_response = list_parents_handler(list_event, mock_context)
    assert list_response['statusCode'] == 200
    list_body = json.loads(list_response['body'])
    assert len(list_body['parents']) == 2

    # Step 3: Second parent can create child (after accepting invitation)
    mock_create_db_instance = Mock()
    mock_create_db.return_value = mock_create_db_instance
    mock_create_db_instance.families_table = 'test-families-table'
    mock_create_db_instance.transactions_table = 'test-transactions-table'
    mock_create_db_instance.query.return_value = []
    mock_create_db_instance.put_item.return_value = None

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
