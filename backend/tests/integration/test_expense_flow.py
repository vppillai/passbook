"""
Integration tests for expense flow
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.expenses.add_expense_handler import handler as add_expense_handler
from src.lambdas.expenses.list_expenses_handler import handler as list_expenses_handler


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


@patch('src.lambdas.expenses.add_expense_handler.verify_token')
@patch('src.lambdas.expenses.add_expense_handler.DynamoDBClient')
@patch('src.lambdas.expenses.list_expenses_handler.verify_token')
@patch('src.lambdas.expenses.list_expenses_handler.DynamoDBClient')
def test_expense_flow(
    mock_list_db,
    mock_list_token,
    mock_expense_db,
    mock_expense_token,
    mock_event,
    mock_context
):
    """Test complete expense flow: add expense -> verify balance updated -> list expenses."""
    # Setup token mocks
    mock_expense_token.return_value = {
        'userId': 'child-user-id',
        'familyId': 'test-family-id',
        'userType': 'child'
    }
    mock_list_token.return_value = {
        'userId': 'child-user-id',
        'familyId': 'test-family-id',
        'userType': 'child'
    }

    # Setup add expense mocks
    mock_expense_db_instance = Mock()
    mock_expense_db.return_value = mock_expense_db_instance
    mock_expense_db_instance.transactions_table = 'test-transactions-table'
    mock_expense_db_instance.families_table = 'test-families-table'

    # Mock child account with sufficient balance
    mock_expense_db_instance.get_item.return_value = {
        'userId': 'child-user-id',
        'currentBalance': 50.0,
        'overdraftLimit': 10.0
    }
    mock_expense_db_instance.put_item.return_value = None
    mock_expense_db_instance.update_item.return_value = None

    # Step 1: Add expense
    add_expense_event = {
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

    add_expense_response = add_expense_handler(add_expense_event, mock_context)
    assert add_expense_response['statusCode'] == 201
    add_expense_body = json.loads(add_expense_response['body'])
    assert add_expense_body['amount'] == 10.50
    assert add_expense_body['newBalance'] == 39.50  # 50 - 10.50

    # Setup list expenses mocks
    mock_list_db_instance = Mock()
    mock_list_db.return_value = mock_list_db_instance
    mock_list_db_instance.transactions_table = 'test-transactions-table'
    mock_list_db_instance.query.return_value = [{
        'transactionId': 'test-tx-id',
        'childUserId': 'child-user-id',
        'SK': 'EXPENSE#test-tx-id',
        'amount': 10.50,
        'category': 'snacks',
        'description': 'Ice cream',
        'expenseDate': '2024-01-15',
        'balanceAfter': 39.50
    }]

    # Step 2: List expenses
    list_event = {
        'headers': {
            'Authorization': 'Bearer test-token'
        },
        'queryStringParameters': {
            'childUserId': 'child-user-id'
        }
    }

    list_response = list_expenses_handler(list_event, mock_context)
    assert list_response['statusCode'] == 200
    list_body = json.loads(list_response['body'])
    assert len(list_body['expenses']) == 1
    assert list_body['expenses'][0]['amount'] == 10.50
    assert list_body['expenses'][0]['category'] == 'snacks'
