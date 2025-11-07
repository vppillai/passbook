"""
Unit tests for expense handler
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.expenses.add_expense_handler import handler
from src.utils.lambda_handler import LambdaError


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({
            'amount': 10.50,
            'category': 'snacks',
            'description': 'Ice cream',
            'expenseDate': '2024-01-15'
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


@patch('src.lambdas.expenses.add_expense_handler.verify_token')
@patch('src.lambdas.expenses.add_expense_handler.DynamoDBClient')
def test_add_expense_success(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test successful expense addition."""
    # Setup mocks
    mock_verify_token.return_value = {
        'userId': 'child-user-id',
        'familyId': 'test-family-id',
        'userType': 'child'
    }

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.transactions_table = 'test-transactions-table'
    mock_db.families_table = 'test-families-table'

    # Mock child account with sufficient balance
    mock_db.get_item.return_value = {
        'familyId': 'test-family-id',
        'SK': 'CHILD#child-user-id',
        'userId': 'child-user-id',
        'displayName': 'Test Child',
        'currentBalance': 50.0,
        'overdraftLimit': 10.0,
        'username': 'testchild',
        'status': 'active',
        'passwordHash': 'hashed-password',
        'createdBy': 'parent-id'
    }

    mock_db.put_item.return_value = None
    mock_db.update_item.return_value = None

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 201
    body = json.loads(response['body'])
    assert 'transactionId' in body
    assert body['amount'] == 10.50
    assert 'newBalance' in body


@patch('src.lambdas.expenses.add_expense_handler.verify_token')
@patch('src.lambdas.expenses.add_expense_handler.DynamoDBClient')
@patch('src.lambdas.expenses.add_expense_handler.check_overdraft')
def test_add_expense_overdraft(mock_overdraft, mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test expense that would cause overdraft."""
    # Setup mocks
    mock_verify_token.return_value = {
        'userId': 'child-user-id',
        'familyId': 'test-family-id',
        'userType': 'child'
    }

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.transactions_table = 'test-transactions-table'
    mock_db.families_table = 'test-families-table'

    # Mock child account with insufficient balance
    mock_db.get_item.side_effect = [
        {  # First call: verify child belongs to family
            'familyId': 'test-family-id',
            'SK': 'CHILD#child-user-id',
            'userId': 'child-user-id',
            'displayName': 'Test Child',
            'currentBalance': 5.0,
            'overdraftLimit': 0.0,  # No overdraft allowed
            'username': 'testchild',
            'status': 'active',
            'passwordHash': 'hashed-password',
            'createdBy': 'parent-id'
        },
        {  # Second call: get family (for currency) - but this happens AFTER overdraft check
            'familyId': 'test-family-id',
            'SK': 'FAMILY',
            'familyName': 'Test Family',
            'currency': 'CAD'
        }
    ]

    # Mock overdraft check to return True (would overdraft)
    # The handler calls check_overdraft BEFORE getting family
    # check_overdraft internally calls db.get_item, so we need to handle that
    # But since we're mocking check_overdraft directly, it won't call db.get_item
    # Note: The handler allows overdrafts but records them - it doesn't reject them
    mock_overdraft.return_value = (True, -5.0)  # Would overdraft, new balance would be -5.0

    # Also need to mock update_child_balance since it's called after overdraft check
    with patch('src.lambdas.expenses.add_expense_handler.update_child_balance') as mock_update_balance:
        mock_update_balance.return_value = -5.0  # New balance after expense

        # Execute - handler allows overdrafts but records them
        response = handler(mock_event, mock_context)

        # Assertions - handler returns 201 with overdraft warning
        assert response['statusCode'] == 201
        body = json.loads(response['body'])
        assert body['wasOverdraft'] is True or body.get('overdraftWarning') is True
