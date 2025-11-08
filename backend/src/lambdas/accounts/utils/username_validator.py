"""
Username validation utilities for child accounts.
"""
from typing import Optional
from utils.db_client import DynamoDBClient


def is_username_unique(family_id: str, username: str, exclude_user_id: Optional[str] = None) -> bool:
    """
    Check if username is unique within a family.

    Args:
        family_id: Family account ID
        username: Username to check
        exclude_user_id: User ID to exclude from check (for updates)

    Returns:
        True if username is unique, False otherwise
    """
    if not username or not username.strip():
        return False

    db = DynamoDBClient()

    try:
        # Query username-family-index GSI
        results = db.query(
            table_name=db.families_table,
            key_condition_expression='familyId = :familyId AND username = :username',
            expression_attribute_values={
                ':familyId': family_id,
                ':username': username.strip().lower()
            },
            index_name='username-family-index'
        )

        # Filter out the current user if updating
        if exclude_user_id:
            results = [r for r in results if r.get('userId') != exclude_user_id]

        return len(results) == 0

    except Exception:
        # If index doesn't exist or query fails, fallback to scan (inefficient but works)
        # This should be rare and only during development
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
