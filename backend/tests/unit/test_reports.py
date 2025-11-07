"""
Unit tests for report generation handler
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.analytics.generate_report_handler import handler


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'queryStringParameters': {
            'childUserId': 'child-user-id',
            'type': 'pdf'
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


@patch('src.lambdas.analytics.generate_report_handler.verify_token')
@patch('src.lambdas.analytics.generate_report_handler.DynamoDBClient')
def test_generate_pdf_report(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test PDF report generation."""
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

    # Mock child and family
    mock_db.get_item.side_effect = [
        {
            'userId': 'child-user-id',
            'displayName': 'Alice'
        },
        {
            'familyId': 'test-family-id',
            'SK': 'FAMILY',
            'familyName': 'Test Family',
            'currency': 'CAD'
        }
    ]

    mock_db.query.return_value = []

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['type'] == 'pdf'
    assert body['familyName'] == 'Test Family'
    assert body['childName'] == 'Alice'
    assert 'summary' in body
    assert 'expenses' in body
    assert 'fundAdditions' in body


@patch('src.lambdas.analytics.generate_report_handler.verify_token')
@patch('src.lambdas.analytics.generate_report_handler.DynamoDBClient')
def test_generate_excel_report(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test Excel report generation."""
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

    mock_db.get_item.side_effect = [
        {
            'userId': 'child-user-id',
            'displayName': 'Alice'
        },
        {
            'familyId': 'test-family-id',
            'SK': 'FAMILY',
            'familyName': 'Test Family',
            'currency': 'CAD'
        }
    ]

    mock_db.query.return_value = []

    # Update event for Excel
    mock_event['queryStringParameters'] = {
        'childUserId': 'child-user-id',
        'type': 'excel'
    }

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 200
    body = json.loads(response['body'])
    assert body['type'] == 'excel'
