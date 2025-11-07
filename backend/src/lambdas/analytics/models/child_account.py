"""
Child Account model for DynamoDB operations.
"""
from typing import Optional, Literal
from datetime import datetime
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
        current_balance: float = 0.0,
        overdraft_limit: float = 0.0,
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
        self.current_balance = current_balance
        self.overdraft_limit = overdraft_limit
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
        return cls(
            user_id=data['userId'],
            family_id=data['familyId'],
            username=data.get('username'),
            email=data.get('email'),
            display_name=data['displayName'],
            password_hash=data['passwordHash'],
            current_balance=data.get('currentBalance', 0.0),
            overdraft_limit=data.get('overdraftLimit', 0.0),
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

    def can_spend(self, amount: float) -> bool:
        """Check if child can spend the given amount."""
        new_balance = self.current_balance - amount
        return new_balance >= -self.overdraft_limit

    def update_balance(self, amount: float) -> None:
        """Update the child's balance."""
        self.current_balance += amount
