"""
Unit tests for username uniqueness validator
"""
import pytest
import sys
import os
from unittest.mock import Mock, patch

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))

from src.utils.username_validator import is_username_unique


@patch('src.utils.username_validator.DynamoDBClient')
def test_username_unique(mock_db_client_class):
    """Test checking unique username."""
    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    mock_db.query.return_value = []  # No existing username

    # Execute
    result = is_username_unique('alice', 'test-family-id')

    # Assertions
    assert result is True
    mock_db.query.assert_called_once()


@patch('src.utils.username_validator.DynamoDBClient')
def test_username_not_unique(mock_db_client_class):
    """Test checking duplicate username."""
    # Setup mocks
    mock_db = Mock()
    mock_db_client_class.return_value = mock_db
    mock_db.families_table = 'test-families-table'
    mock_db.query.return_value = [{
        'username': 'alice',
        'familyId': 'test-family-id'
    }]  # Existing username

    # Execute
    result = is_username_unique('alice', 'test-family-id')

    # Assertions
    assert result is False
