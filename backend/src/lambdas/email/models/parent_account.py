"""
Parent Account model for DynamoDB operations.
"""
from typing import Optional
from datetime import datetime
import uuid


class ParentAccount:
    """Represents a parent account in the system."""

    def __init__(
        self,
        email: str,
        display_name: str,
        password_hash: str,
        family_id: Optional[str] = None,
        user_id: Optional[str] = None,
        status: str = 'pending',
        email_verified: bool = False,
        invited_by: Optional[str] = None,
        invitation_token: Optional[str] = None,
        invitation_expiry: Optional[str] = None,
        created_at: Optional[str] = None,
        last_login_at: Optional[str] = None,
        password_changed_at: Optional[str] = None,
    ):
        self.user_id = user_id or str(uuid.uuid4())
        self.family_id = family_id
        self.email = email.lower().strip()
        self.display_name = display_name
        self.password_hash = password_hash
        self.status = status
        self.email_verified = email_verified
        self.invited_by = invited_by
        self.invitation_token = invitation_token
        self.invitation_expiry = invitation_expiry
        self.created_at = created_at or datetime.utcnow().isoformat()
        self.last_login_at = last_login_at
        self.password_changed_at = password_changed_at or datetime.utcnow().isoformat()

    def to_dict(self) -> dict:
        """Convert to DynamoDB item format."""
        item = {
            'familyId': self.family_id or 'UNASSIGNED',
            'SK': f'PARENT#{self.user_id}',
            'userId': self.user_id,
            'email': self.email,
            'displayName': self.display_name,
            'passwordHash': self.password_hash,
            'status': self.status,
            'emailVerified': self.email_verified,
            'createdAt': self.created_at,
            'passwordChangedAt': self.password_changed_at,
        }

        if self.invited_by:
            item['invitedBy'] = self.invited_by
        if self.invitation_token:
            item['invitationToken'] = self.invitation_token
        if self.invitation_expiry:
            item['invitationExpiry'] = self.invitation_expiry
        if self.last_login_at:
            item['lastLoginAt'] = self.last_login_at

        return item

    @classmethod
    def from_dict(cls, data: dict) -> 'ParentAccount':
        """Create from DynamoDB item format."""
        return cls(
            user_id=data['userId'],
            family_id=data.get('familyId'),
            email=data['email'],
            display_name=data['displayName'],
            password_hash=data['passwordHash'],
            status=data.get('status', 'pending'),
            email_verified=data.get('emailVerified', False),
            invited_by=data.get('invitedBy'),
            invitation_token=data.get('invitationToken'),
            invitation_expiry=data.get('invitationExpiry'),
            created_at=data.get('createdAt'),
            last_login_at=data.get('lastLoginAt'),
            password_changed_at=data.get('passwordChangedAt'),
        )

    def is_active(self) -> bool:
        """Check if account is active."""
        return self.status == 'active' and self.email_verified

    def can_login(self) -> bool:
        """Check if account can login."""
        return self.is_active()
