"""
Unit tests for balance manager
"""
import pytest
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.utils.balance_manager import update_child_balance


@patch('src.utils.balance_manager.DynamoDBClient')
def test_update_balance_add_funds(mock_db_client_class):
    """Test updating balance when adding funds."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account
    mock_db.get_item.return_value = {
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

    mock_db.update_item.return_value = None

    # Execute
    new_balance = update_child_balance(mock_db, 'child-user-id', 'test-family-id', 25.0, 'add')

    # Assertions
    assert new_balance == 75.0
    mock_db.update_item.assert_called_once()


@patch('src.utils.balance_manager.DynamoDBClient')
def test_update_balance_subtract_expense(mock_db_client_class):
    """Test updating balance when subtracting expense."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account
    mock_db.get_item.return_value = {
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

    mock_db.update_item.return_value = None

    # Execute
    new_balance = update_child_balance(mock_db, 'child-user-id', 'test-family-id', 10.0, 'subtract')

    # Assertions
    assert new_balance == 40.0
    mock_db.update_item.assert_called_once()


@patch('src.utils.balance_manager.DynamoDBClient')
def test_update_balance_child_not_found(mock_db_client_class):
    """Test updating balance when child not found."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account not found
    mock_db.get_item.return_value = None

    # Execute and assert
    with pytest.raises(Exception) as exc_info:
        update_child_balance(mock_db, 'child-user-id', 'test-family-id', 25.0, 'add')

    assert 'not found' in str(exc_info.value).lower()


@patch('src.utils.balance_manager.DynamoDBClient')
def test_update_balance_invalid_operation(mock_db_client_class):
    """Test updating balance with invalid operation."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account
    mock_db.get_item.return_value = {
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

    # Execute and assert
    with pytest.raises(ValueError) as exc_info:
        update_child_balance(mock_db, 'child-user-id', 'test-family-id', 25.0, 'invalid')

    assert 'invalid operation' in str(exc_info.value).lower()
