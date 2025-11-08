"""
Family Account model for DynamoDB operations.
"""
from typing import Optional
from datetime import datetime
from decimal import Decimal
import uuid


class FamilyAccount:
    """Represents a family account in the system."""

    def __init__(
        self,
        family_name: str,
        created_by: str,
        currency: str = 'CAD',
        timezone: str = 'America/Toronto',
        description: Optional[str] = None,
        family_id: Optional[str] = None,
        reminder_time: str = '09:00',
        reminder_threshold: Optional[Decimal] = None,
        created_at: Optional[str] = None,
        updated_at: Optional[str] = None,
        updated_by: Optional[str] = None,
    ):
        self.family_id = family_id or str(uuid.uuid4())
        self.family_name = family_name
        self.description = description
        self.currency = currency
        self.timezone = timezone
        self.reminder_time = reminder_time
        self.reminder_threshold = reminder_threshold if reminder_threshold is not None else Decimal('1.0')
        if isinstance(self.reminder_threshold, (int, float)):
            self.reminder_threshold = Decimal(str(self.reminder_threshold))
        self.created_by = created_by
        self.created_at = created_at or datetime.utcnow().isoformat()
        self.updated_at = updated_at or datetime.utcnow().isoformat()
        self.updated_by = updated_by or created_by

    def to_dict(self) -> dict:
        """Convert to DynamoDB item format."""
        item = {
            'familyId': self.family_id,
            'SK': 'FAMILY',
            'familyName': self.family_name,
            'currency': self.currency,
            'timezone': self.timezone,
            'reminderTime': self.reminder_time,
            'reminderThreshold': self.reminder_threshold,
            'createdAt': self.created_at,
            'createdBy': self.created_by,
            'updatedAt': self.updated_at,
            'updatedBy': self.updated_by,
        }

        if self.description:
            item['description'] = self.description

        return item

    @classmethod
    def from_dict(cls, data: dict) -> 'FamilyAccount':
        """Create from DynamoDB item format."""
        reminder_threshold = data.get('reminderThreshold', Decimal('1.0'))
        if isinstance(reminder_threshold, (int, float)):
            reminder_threshold = Decimal(str(reminder_threshold))
        
        return cls(
            family_id=data['familyId'],
            family_name=data['familyName'],
            created_by=data['createdBy'],
            currency=data.get('currency', 'CAD'),
            timezone=data.get('timezone', 'America/Toronto'),
            description=data.get('description'),
            reminder_time=data.get('reminderTime', '09:00'),
            reminder_threshold=reminder_threshold,
            created_at=data.get('createdAt'),
            updated_at=data.get('updatedAt'),
            updated_by=data.get('updatedBy'),
        )

    def update(
        self,
        family_name: Optional[str] = None,
        description: Optional[str] = None,
        currency: Optional[str] = None,
        timezone: Optional[str] = None,
        reminder_time: Optional[str] = None,
        reminder_threshold: Optional[Decimal] = None,
        updated_by: Optional[str] = None,
    ):
        """Update family account fields."""
        if family_name is not None:
            self.family_name = family_name
        if description is not None:
            self.description = description
        if currency is not None:
            self.currency = currency
        if timezone is not None:
            self.timezone = timezone
        if reminder_time is not None:
            self.reminder_time = reminder_time
        if reminder_threshold is not None:
            if isinstance(reminder_threshold, (int, float)):
                reminder_threshold = Decimal(str(reminder_threshold))
            self.reminder_threshold = reminder_threshold

        self.updated_at = datetime.utcnow().isoformat()
        self.updated_by = updated_by or self.updated_by
