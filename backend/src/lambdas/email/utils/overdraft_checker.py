"""
Overdraft checking utilities for expense validation.
"""
from utils.db_client import DynamoDBClient
from models.child_account import ChildAccount


def check_overdraft(
    db: DynamoDBClient,
    child_user_id: str,
    family_id: str,
    expense_amount: float
) -> tuple[bool, float]:
    """
    Check if an expense would result in overdraft.

    Args:
        db: DynamoDB client instance
        child_user_id: Child account user ID
        family_id: Family account ID
        expense_amount: Amount of the expense

    Returns:
        Tuple of (would_overdraft, new_balance)
    """
    # Get child account
    child_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        }
    )

    if not child_item:
        raise Exception("Child account not found")

    child = ChildAccount.from_dict(child_item)
    current_balance = child.current_balance
    overdraft_limit = child.overdraft_limit

    # Calculate new balance
    new_balance = current_balance - expense_amount

    # Check if it would exceed overdraft limit
    would_overdraft = new_balance < -overdraft_limit

    return would_overdraft, new_balance


def can_make_expense(
    db: DynamoDBClient,
    child_user_id: str,
    family_id: str,
    expense_amount: float
) -> bool:
    """
    Check if child can make an expense (within overdraft limit).

    Args:
        db: DynamoDB client instance
        child_user_id: Child account user ID
        family_id: Family account ID
        expense_amount: Amount of the expense

    Returns:
        True if expense is allowed, False otherwise
    """
    would_overdraft, _ = check_overdraft(db, child_user_id, family_id, expense_amount)
    return not would_overdraft
