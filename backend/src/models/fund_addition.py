"""
Fund Addition model for DynamoDB operations.
"""
from typing import Optional
from datetime import datetime
import uuid


class FundAddition:
    """Represents a fund addition transaction."""

    def __init__(
        self,
        child_user_id: str,
        family_id: str,
        amount: float,
        currency: str,
        reason: str,
        added_by: str,
        transaction_id: Optional[str] = None,
        period_id: Optional[str] = None,
        balance_after: Optional[float] = None,
        added_at: Optional[str] = None,
    ):
        self.transaction_id = transaction_id or str(uuid.uuid4())
        self.child_user_id = child_user_id
        self.family_id = family_id
        self.amount = amount
        self.currency = currency
        self.reason = reason
        self.added_by = added_by
        self.period_id = period_id
        self.balance_after = balance_after
        self.added_at = added_at or datetime.utcnow().isoformat()

    def to_dict(self) -> dict:
        """Convert to DynamoDB item format."""
        # Create sort key with timestamp for chronological ordering
        timestamp = datetime.fromisoformat(self.added_at.replace('Z', '+00:00')).timestamp()
        sk = f'FUND#{int(timestamp)}#{self.transaction_id}'

        item = {
            'childUserId': self.child_user_id,
            'SK': sk,
            'transactionId': self.transaction_id,
            'familyId': self.family_id,
            'amount': self.amount,
            'currency': self.currency,
            'reason': self.reason,
            'addedBy': self.added_by,
            'addedAt': self.added_at,
            'balanceAfter': self.balance_after or 0.0,
        }

        if self.period_id:
            item['periodId'] = self.period_id

        return item

    @classmethod
    def from_dict(cls, data: dict) -> 'FundAddition':
        """Create from DynamoDB item format."""
        return cls(
            transaction_id=data['transactionId'],
            child_user_id=data['childUserId'],
            family_id=data['familyId'],
            amount=data['amount'],
            currency=data['currency'],
            reason=data['reason'],
            added_by=data['addedBy'],
            period_id=data.get('periodId'),
            balance_after=data.get('balanceAfter'),
            added_at=data.get('addedAt'),
        )
