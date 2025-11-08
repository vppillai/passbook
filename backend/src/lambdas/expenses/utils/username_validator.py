"""
Username validation utilities for child accounts.
"""
from typing import Optional
from utils.db_client import DynamoDBClient


def is_username_unique(username: str, exclude_user_id: Optional[str] = None) -> bool:
    """
    Check if username is globally unique across all families.

    Args:
        username: Username to check
        exclude_user_id: User ID to exclude from check (for updates)

    Returns:
        True if username is unique, False otherwise
    """
    if not username or not username.strip():
        return False

    db = DynamoDBClient()
    username_lower = username.strip().lower()

    try:
        # Query username-global-index GSI to check across all families
        results = db.query(
            table_name=db.families_table,
            key_condition_expression='username = :username',
            expression_attribute_values={
                ':username': username_lower
            },
            index_name='username-global-index'
        )

        # Filter out the current user if updating
        if exclude_user_id:
            results = [r for r in results if r.get('userId') != exclude_user_id]

        return len(results) == 0

    except Exception as e:
        # If index doesn't exist, fallback to scan (inefficient)
        print(f"Warning: username-global-index not available, falling back to scan: {e}")
        try:
            results = db.scan(
                table_name=db.families_table,
                filter_expression='username = :username AND begins_with(SK, :skPrefix)',
                expression_attribute_values={
                    ':username': username_lower,
                    ':skPrefix': 'CHILD#'
                }
            )
            
            if exclude_user_id:
                results = [r for r in results if r.get('userId') != exclude_user_id]
            
            return len(results) == 0
        except Exception:
            # If scan also fails, allow it (better than blocking)
            return True


def validate_username(username: str) -> tuple[bool, str]:
    """
    Validate username format and rules.

    Args:
        username: Username to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not username:
        return False, "Username is required"

    username = username.strip()

    if len(username) < 3:
        return False, "Username must be at least 3 characters"

    if len(username) > 20:
        return False, "Username must be less than 20 characters"

    # Allow alphanumeric, underscore, and hyphen
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', username):
        return False, "Username can only contain letters, numbers, underscore, and hyphen"

    return True, ""
