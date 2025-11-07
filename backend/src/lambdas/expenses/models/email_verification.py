"""
Email Verification model for DynamoDB operations.
"""
from typing import Literal, Optional
from datetime import datetime, timedelta
import secrets


class EmailVerification:
    """Represents an email verification token."""

    VERIFICATION_TYPES = Literal['activation', 'passwordReset', 'invitation']

    def __init__(
        self,
        email: str,
        user_id: str,
        verification_type: VERIFICATION_TYPES,
        token: Optional[str] = None,
        expires_at: Optional[str] = None,
        created_at: Optional[str] = None,
    ):
        self.token = token or self._generate_token()
        self.email = email.lower().strip()
        self.user_id = user_id
        self.type = verification_type
        self.created_at = created_at or datetime.utcnow().isoformat()

        # Set expiration based on type
        if expires_at:
            self.expires_at = expires_at
        else:
            if verification_type == 'activation':
                expiry = datetime.utcnow() + timedelta(hours=24)
            elif verification_type == 'passwordReset':
                expiry = datetime.utcnow() + timedelta(hours=1)
            elif verification_type == 'invitation':
                expiry = datetime.utcnow() + timedelta(days=7)
            else:
                expiry = datetime.utcnow() + timedelta(hours=24)

            self.expires_at = expiry.isoformat()

    @staticmethod
    def _generate_token() -> str:
        """Generate a secure random token."""
        return secrets.token_urlsafe(32)

    def to_dict(self) -> dict:
        """Convert to DynamoDB item format."""
        # Calculate TTL (Unix timestamp)
        expires_dt = datetime.fromisoformat(self.expires_at.replace('Z', '+00:00'))
        ttl = int(expires_dt.timestamp())

        return {
            'token': self.token,
            'SK': 'EMAIL_VERIFY',
            'email': self.email,
            'userId': self.user_id,
            'type': self.type,
            'expiresAt': self.expires_at,
            'createdAt': self.created_at,
            'ttl': ttl,
        }

    @classmethod
    def from_dict(cls, data: dict) -> 'EmailVerification':
        """Create from DynamoDB item format."""
        return cls(
            token=data['token'],
            email=data['email'],
            user_id=data['userId'],
            verification_type=data['type'],
            expires_at=data.get('expiresAt'),
            created_at=data.get('createdAt'),
        )

    def is_expired(self) -> bool:
        """Check if token has expired."""
        expires_dt = datetime.fromisoformat(self.expires_at.replace('Z', '+00:00'))
        return datetime.utcnow() > expires_dt

    def is_valid(self) -> bool:
        """Check if token is valid (not expired)."""
        return not self.is_expired()
