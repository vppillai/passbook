"""
Unit tests for parent invitation handler
"""
import pytest
import json
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.lambdas.accounts.invite_parent_handler import handler
from src.utils.lambda_handler import LambdaError


@pytest.fixture
def mock_event():
    """Create a mock API Gateway event."""
    return {
        'body': json.dumps({
            'email': 'parent2@example.com'
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


@patch('src.lambdas.accounts.invite_parent_handler.verify_token')
@patch('src.lambdas.accounts.invite_parent_handler.DynamoDBClient')
@patch('src.lambdas.accounts.invite_parent_handler.send_verification_email')
def test_invite_parent_success(mock_email, mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test successful parent invitation."""
    # Setup mocks
    mock_verify_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    mock_db.auth_table = 'test-auth-table'

    # Mock no existing parent
    mock_db.query.return_value = []
    mock_db.get_item.return_value = {
        'familyId': 'test-family-id',
        'SK': 'FAMILY',
        'familyName': 'Test Family'
    }
    mock_db.put_item.return_value = None
    mock_email.return_value = True

    # Execute
    response = handler(mock_event, mock_context)

    # Assertions
    assert response['statusCode'] == 201
    body = json.loads(response['body'])
    assert 'email' in body
    assert body['email'] == 'parent2@example.com'
    assert 'expiresAt' in body


@patch('src.lambdas.accounts.invite_parent_handler.verify_token')
@patch('src.lambdas.accounts.invite_parent_handler.DynamoDBClient')
def test_invite_parent_already_exists(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test invitation when parent already exists."""
    # Setup mocks
    mock_verify_token.return_value = {
        'userId': 'parent-user-id',
        'familyId': 'test-family-id',
        'userType': 'parent'
    }

    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock existing parent - query returns results
    mock_db.query.return_value = [{
        'email': 'parent2@example.com',
        'SK': 'PARENT#existing-id',
        'familyId': 'test-family-id'
    }]

    # Execute - wrapper catches exception
    response = handler(mock_event, mock_context)

    # Assertions - check response status code
    assert response['statusCode'] == 409
    body = json.loads(response['body'])
    assert 'already' in body['error'].lower()


@patch('src.lambdas.accounts.invite_parent_handler.verify_token')
@patch('src.lambdas.accounts.invite_parent_handler.DynamoDBClient')
def test_invite_parent_unauthorized(mock_db_client_class, mock_verify_token, mock_event, mock_context):
    """Test invitation without parent authentication."""
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
