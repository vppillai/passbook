"""
Balance management utilities for updating child account balances.
"""
from src.utils.db_client import DynamoDBClient
from src.models.child_account import ChildAccount
from datetime import datetime


def update_child_balance(
    db: DynamoDBClient,
    child_user_id: str,
    family_id: str,
    amount: float,
    operation: str = 'add'
) -> float:
    """
    Update a child's balance atomically.

    Args:
        db: DynamoDB client instance
        child_user_id: Child account user ID
        family_id: Family account ID
        amount: Amount to add or subtract
        operation: 'add' or 'subtract'

    Returns:
        New balance after update
    """
    # Get current child account
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

    # Calculate new balance
    if operation == 'add':
        new_balance = current_balance + amount
    elif operation == 'subtract':
        new_balance = current_balance - amount
    else:
        raise ValueError(f"Invalid operation: {operation}")

    # Update balance atomically
    try:
        db.update_item(
            table_name=db.families_table,
            key={
                'familyId': family_id,
                'SK': f'CHILD#{child_user_id}'
            },
            update_expression='SET currentBalance = :balance, lastActivityAt = :activityAt',
            expression_attribute_values={
                ':balance': new_balance,
                ':activityAt': datetime.utcnow().isoformat()
            }
        )
    except Exception as e:
        raise Exception(f"Failed to update balance: {str(e)}")

    return new_balance


def get_child_balance(
    db: DynamoDBClient,
    child_user_id: str,
    family_id: str
) -> float:
    """
    Get current balance for a child account.

    Args:
        db: DynamoDB client instance
        child_user_id: Child account user ID
        family_id: Family account ID

    Returns:
        Current balance
    """
    child_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': f'CHILD#{child_user_id}'
        }
    )

    if not child_item:
        raise Exception("Child account not found")

    return child_item.get('currentBalance', 0.0)
