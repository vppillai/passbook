"""
Expense model for DynamoDB operations.
"""
from typing import Optional, List, Dict
from datetime import datetime
import uuid


class Expense:
    """Represents an expense transaction."""

    def __init__(
        self,
        child_user_id: str,
        family_id: str,
        amount: float,
        currency: str,
        category: str,
        description: str,
        expense_date: str,
        recorded_by: str,
        transaction_id: Optional[str] = None,
        is_parent_recorded: bool = False,
        period_id: Optional[str] = None,
        balance_after: Optional[float] = None,
        was_overdraft: bool = False,
        recorded_at: Optional[str] = None,
        last_edited_by: Optional[str] = None,
        last_edited_at: Optional[str] = None,
        edit_history: Optional[List[Dict]] = None,
    ):
        self.transaction_id = transaction_id or str(uuid.uuid4())
        self.child_user_id = child_user_id
        self.family_id = family_id
        self.amount = amount
        self.currency = currency
        self.category = category
        self.description = description
        self.expense_date = expense_date
        self.recorded_by = recorded_by
        self.is_parent_recorded = is_parent_recorded
        self.period_id = period_id
        self.balance_after = balance_after
        self.was_overdraft = was_overdraft
        self.recorded_at = recorded_at or datetime.utcnow().isoformat()
        self.last_edited_by = last_edited_by
        self.last_edited_at = last_edited_at
        self.edit_history = edit_history or []

    def to_dict(self) -> dict:
        """Convert to DynamoDB item format."""
        # Create sort key with date for chronological ordering
        # Format: EXPENSE#{YYYY-MM-DD}#{transactionId}
        sk = f'EXPENSE#{self.expense_date}#{self.transaction_id}'

        item = {
            'childUserId': self.child_user_id,
            'SK': sk,
            'transactionId': self.transaction_id,
            'familyId': self.family_id,
            'amount': self.amount,
            'currency': self.currency,
            'category': self.category,
            'description': self.description,
            'expenseDate': self.expense_date,
            'recordedBy': self.recorded_by,
            'isParentRecorded': self.is_parent_recorded,
            'recordedAt': self.recorded_at,
            'balanceAfter': self.balance_after or 0.0,
            'wasOverdraft': self.was_overdraft,
        }

        if self.period_id:
            item['periodId'] = self.period_id
        if self.last_edited_by:
            item['lastEditedBy'] = self.last_edited_by
        if self.last_edited_at:
            item['lastEditedAt'] = self.last_edited_at
        if self.edit_history:
            item['editHistory'] = self.edit_history

        return item

    @classmethod
    def from_dict(cls, data: dict) -> 'Expense':
        """Create from DynamoDB item format."""
        return cls(
            transaction_id=data['transactionId'],
            child_user_id=data['childUserId'],
            family_id=data['familyId'],
            amount=data['amount'],
            currency=data['currency'],
            category=data['category'],
            description=data['description'],
            expense_date=data['expenseDate'],
            recorded_by=data['recordedBy'],
            is_parent_recorded=data.get('isParentRecorded', False),
            period_id=data.get('periodId'),
            balance_after=data.get('balanceAfter'),
            was_overdraft=data.get('wasOverdraft', False),
            recorded_at=data.get('recordedAt'),
            last_edited_by=data.get('lastEditedBy'),
            last_edited_at=data.get('lastEditedAt'),
            edit_history=data.get('editHistory', []),
        )

    def add_edit_record(self, edited_by: str, previous_values: dict) -> None:
        """Add an edit record to the edit history."""
        edit_record = {
            'editedBy': edited_by,
            'editedAt': datetime.utcnow().isoformat(),
            'previousValues': previous_values,
        }
        self.edit_history.append(edit_record)
        self.last_edited_by = edited_by
        self.last_edited_at = edit_record['editedAt']
