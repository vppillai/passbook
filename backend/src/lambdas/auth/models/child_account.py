"""
Child Account model for DynamoDB operations.
"""
from typing import Optional, Literal
from datetime import datetime
from decimal import Decimal
import uuid


class ChildAccount:
    """Represents a child account in the system."""

    PERIOD_TYPES = Literal['weekly', 'biweekly', 'monthly', 'custom']

    def __init__(
        self,
        family_id: str,
        display_name: str,
        password_hash: str,
        created_by: str,
        user_id: Optional[str] = None,
        username: Optional[str] = None,
        email: Optional[str] = None,
        current_balance: Optional[Decimal] = None,
        overdraft_limit: Optional[Decimal] = None,
        funding_period: Optional[dict] = None,
        notifications_enabled: bool = True,
        device_tokens: Optional[list] = None,
        status: str = 'active',
        created_at: Optional[str] = None,
        last_activity_at: Optional[str] = None,
    ):
        self.user_id = user_id or str(uuid.uuid4())
        self.family_id = family_id
        self.username = username
        self.email = email.lower().strip() if email else None
        self.display_name = display_name
        self.password_hash = password_hash
        self.current_balance = current_balance if current_balance is not None else Decimal('0.0')
        self.overdraft_limit = overdraft_limit if overdraft_limit is not None else Decimal('0.0')
        self.funding_period = funding_period
        self.notifications_enabled = notifications_enabled
        self.device_tokens = device_tokens or []
        self.status = status
        self.created_by = created_by
        self.created_at = created_at or datetime.utcnow().isoformat()
        self.last_activity_at = last_activity_at

    def to_dict(self) -> dict:
        """Convert to DynamoDB item format."""
        item = {
            'familyId': self.family_id,
            'SK': f'CHILD#{self.user_id}',
            'userId': self.user_id,
            'displayName': self.display_name,
            'passwordHash': self.password_hash,
            'currentBalance': self.current_balance,
            'overdraftLimit': self.overdraft_limit,
            'notificationsEnabled': self.notifications_enabled,
            'status': self.status,
            'createdAt': self.created_at,
            'createdBy': self.created_by,
        }

        if self.username:
            item['username'] = self.username
        if self.email:
            item['email'] = self.email
        if self.funding_period:
            item['fundingPeriod'] = self.funding_period
        if self.device_tokens:
            item['deviceTokens'] = self.device_tokens
        if self.last_activity_at:
            item['lastActivityAt'] = self.last_activity_at

        return item

    @classmethod
    def from_dict(cls, data: dict) -> 'ChildAccount':
        """Create from DynamoDB item format."""
        current_balance = data.get('currentBalance', Decimal('0.0'))
        if isinstance(current_balance, (int, float)):
            current_balance = Decimal(str(current_balance))
        
        overdraft_limit = data.get('overdraftLimit', Decimal('0.0'))
        if isinstance(overdraft_limit, (int, float)):
            overdraft_limit = Decimal(str(overdraft_limit))
        
        return cls(
            user_id=data['userId'],
            family_id=data['familyId'],
            username=data.get('username'),
            email=data.get('email'),
            display_name=data['displayName'],
            password_hash=data['passwordHash'],
            current_balance=current_balance,
            overdraft_limit=overdraft_limit,
            funding_period=data.get('fundingPeriod'),
            notifications_enabled=data.get('notificationsEnabled', True),
            device_tokens=data.get('deviceTokens', []),
            status=data.get('status', 'active'),
            created_by=data['createdBy'],
            created_at=data.get('createdAt'),
            last_activity_at=data.get('lastActivityAt'),
        )

    def is_active(self) -> bool:
        """Check if account is active."""
        return self.status == 'active'

    def can_spend(self, amount: Decimal) -> bool:
        """Check if child can spend the given amount."""
        if isinstance(amount, (int, float)):
            amount = Decimal(str(amount))
        new_balance = self.current_balance - amount
        return new_balance >= -self.overdraft_limit

    def update_balance(self, amount: Decimal) -> None:
        """Update the child's balance."""
        if isinstance(amount, (int, float)):
            amount = Decimal(str(amount))
        self.current_balance += amount
