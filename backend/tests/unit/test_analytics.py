"""
Unit tests for analytics handler
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.analytics.get_analytics_handler import handler


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'queryStringParameters': {
            'childUserId': 'child-user-id',
            'startDate': '2024-01-01',  # Add date range to match test data
            'endDate': '2024-01-31'
        },
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


@patch('src.lambdas.analytics.get_analytics_handler.verify_token')
@patch('src.lambdas.analytics.get_analytics_handler.DynamoDBClient')
def test_get_analytics_success(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test successful analytics retrieval."""
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

    # Mock child account - handler checks if child belongs to family when user_type is 'parent'
    mock_db.get_item.side_effect = [
        {  # First call: verify child belongs to family
            'familyId': 'test-family-id',
            'SK': 'CHILD#child-user-id',
            'userId': 'child-user-id',
            'displayName': 'Alice'
        }
    ]

    # Mock expenses - filter by date range
    mock_db.query.side_effect = [
        [  # Expenses - filtered by date
            {
                'transactionId': 'tx-1',
                'SK': 'EXPENSE#tx-1',
                'childUserId': 'child-user-id',
                'familyId': 'test-family-id',
                'amount': 10.50,
                'category': 'snacks',
                'expenseDate': '2024-01-15',
                'currency': 'CAD',
                'description': 'Test expense 1',
                'recordedBy': 'child-user-id'
            },
            {
                'transactionId': 'tx-2',
                'SK': 'EXPENSE#tx-2',
                'childUserId': 'child-user-id',
                'familyId': 'test-family-id',
                'amount': 15.0,
                'category': 'toys',
                'expenseDate': '2024-01-16',
                'currency': 'CAD',
                'description': 'Test expense 2',
                'recordedBy': 'child-user-id'
            }
        ],
        [  # Funds - filtered by date
            {
                'transactionId': 'tx-fund-1',
                'SK': 'FUND#tx-fund-1',
                'childUserId': 'child-user-id',
                'familyId': 'test-family-id',
                'amount': 50.0,
                'addedAt': '2024-01-01',
                'currency': 'CAD',
                'reason': 'Test fund',
                'addedBy': 'parent-user-id'
            }
        ]
    ]

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert 'categoryBreakdown' in body
    assert 'spendingTrends' in body
    assert body['totalExpenses'] == 25.50
    assert body['totalFunded'] == 50.0
    assert body['netBalance'] == 24.50


@patch('src.lambdas.analytics.get_analytics_handler.verify_token')
@patch('src.lambdas.analytics.get_analytics_handler.DynamoDBClient')
def test_get_analytics_with_date_range(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test analytics with date range filter."""
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

    mock_db.get_item.return_value = {
        'userId': 'child-user-id',
        'displayName': 'Alice'
    }

    mock_db.query.return_value = []

    # Update event with date range
    mock_event['queryStringParameters'] = {
        'childUserId': 'child-user-id',
        'startDate': '2024-01-01',
        'endDate': '2024-01-31'
    }

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['period']['startDate'] == '2024-01-01'
    assert body['period']['endDate'] == '2024-01-31'
