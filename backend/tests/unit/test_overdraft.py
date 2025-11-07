"""
Unit tests for overdraft checker
"""
import pytest
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.utils.overdraft_checker import check_overdraft


@patch('src.utils.overdraft_checker.DynamoDBClient')
def test_check_overdraft_sufficient_balance(mock_db_client_class):
    """Test overdraft check with sufficient balance."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
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

    # Execute
    would_overdraft, new_balance = check_overdraft(mock_db, 'child-user-id', 'test-family-id', 30.0)

    # Assertions
    assert would_overdraft is False
    assert new_balance == 20.0


@patch('src.utils.overdraft_checker.DynamoDBClient')
def test_check_overdraft_within_limit(mock_db_client_class):
    """Test overdraft check within overdraft limit."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account with balance but within overdraft limit
    mock_db.get_item.return_value = {
        'familyId': 'test-family-id',
        'SK': 'CHILD#child-user-id',
        'userId': 'child-user-id',
        'displayName': 'Test Child',
        'currentBalance': 5.0,
        'overdraftLimit': 10.0,
        'username': 'testchild',
        'status': 'active',
        'passwordHash': 'hashed-password',
        'createdBy': 'parent-id'
    }

    # Execute - spending 10.0 would result in -5.0, which is within overdraft limit
    would_overdraft, new_balance = check_overdraft(mock_db, 'child-user-id', 'test-family-id', 10.0)

    # Assertions
    assert would_overdraft is False
    assert new_balance == -5.0


@patch('src.utils.overdraft_checker.DynamoDBClient')
def test_check_overdraft_exceeds_limit(mock_db_client_class):
    """Test overdraft check that exceeds overdraft limit."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account that would exceed overdraft limit
    mock_db.get_item.return_value = {
        'familyId': 'test-family-id',
        'SK': 'CHILD#child-user-id',
        'userId': 'child-user-id',
        'displayName': 'Test Child',
        'currentBalance': 5.0,
        'overdraftLimit': 10.0,
        'username': 'testchild',
        'status': 'active',
        'passwordHash': 'hashed-password',
        'createdBy': 'parent-id'
    }

    # Execute - spending 20.0 would result in -15.0, exceeding limit of -10.0
    would_overdraft, new_balance = check_overdraft(mock_db, 'child-user-id', 'test-family-id', 20.0)

    # Assertions
    assert would_overdraft is True
    assert new_balance == -15.0


@patch('src.utils.overdraft_checker.DynamoDBClient')
def test_check_overdraft_no_overdraft_allowed(mock_db_client_class):
    """Test overdraft check when overdraft is not allowed."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account with no overdraft allowed
    mock_db.get_item.return_value = {
        'familyId': 'test-family-id',
        'SK': 'CHILD#child-user-id',
        'userId': 'child-user-id',
        'displayName': 'Test Child',
        'currentBalance': 5.0,
        'overdraftLimit': 0.0,
        'username': 'testchild',
        'status': 'active',
        'passwordHash': 'hashed-password',
        'createdBy': 'parent-id'
    }

    # Execute - spending more than balance
    would_overdraft, new_balance = check_overdraft(mock_db, 'child-user-id', 'test-family-id', 10.0)

    # Assertions
    assert would_overdraft is True
    assert new_balance == -5.0


@patch('src.utils.overdraft_checker.DynamoDBClient')
def test_check_overdraft_child_not_found(mock_db_client_class):
    """Test overdraft check when child not found."""
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'

    # Mock child account not found
    mock_db.get_item.return_value = None

    # Execute and assert
    with pytest.raises(Exception) as exc_info:
        check_overdraft(mock_db, 'child-user-id', 'test-family-id', 10.0)

    assert 'not found' in str(exc_info.value).lower()
