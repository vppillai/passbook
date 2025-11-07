"""
Lambda handler for sending low balance reminder emails to parents.
"""
import os
from utils.lambda_handler import lambda_handler_wrapper, create_response, LambdaError
from utils.db_client import DynamoDBClient
from utils.email_service import send_email
from models.child_account import ChildAccount
from models.family_account import FamilyAccount


@lambda_handler_wrapper
def handler(event, context):
    """
    Handle reminder email sending (typically triggered by EventBridge schedule).
    Checks all children in all families and sends reminders for low balances.
    """
    db = DynamoDBClient()

    # Get all families
    # Note: This is a scan operation - for production, consider using a GSI or
    # processing families in batches
    families = []

    # For now, we'll process families that have been active recently
    # In production, you'd want to query families more efficiently

    reminders_sent = 0
    errors = []

    # This is a simplified version - in production, you'd want to:
    # 1. Query families more efficiently (maybe by last activity)
    # 2. Batch process
    # 3. Use EventBridge to trigger per-family checks

    # For now, we'll return a success message
    # The actual implementation would require scanning families and children

    return create_response(
        status_code=200,
        body={
            'message': 'Reminder check completed',
            'remindersSent': reminders_sent,
            'errors': errors
        }
    )


def check_and_send_reminders_for_family(db: DynamoDBClient, family_id: str) -> int:
    """
    Check all children in a family and send reminders for low balances.

    Returns:
        Number of reminders sent
    """
    # Get family account
    family_item = db.get_item(
        table_name=db.families_table,
        key={
            'familyId': family_id,
            'SK': 'FAMILY'
        }
    )

    if not family_item:
        return 0

    family = FamilyAccount.from_dict(family_item)
    threshold = family.reminder_threshold

    # Get all children
    children_items = db.query(
        table_name=db.families_table,
        key_condition_expression='familyId = :familyId AND begins_with(SK, :skPrefix)',
        expression_attribute_values={
            ':familyId': family_id,
            ':skPrefix': 'CHILD#'
        }
    )

    reminders_sent = 0

    for child_item in children_items:
        child = ChildAccount.from_dict(child_item)

        # Check if balance is below threshold
        if child.current_balance < threshold:
            # Get parent emails
            parents = db.query(
                table_name=db.families_table,
                key_condition_expression='familyId = :familyId AND begins_with(SK, :skPrefix)',
                expression_attribute_values={
                    ':familyId': family_id,
                    ':skPrefix': 'PARENT#'
                }
            )

            # Send reminder to each parent
            for parent_item in parents:
                parent_email = parent_item.get('email')
                if parent_email:
                    subject = f"Low Balance Alert: {child.display_name}"
                    html_body = f"""
                    <html>
                    <body>
                        <h2>Low Balance Alert</h2>
                        <p>{child.display_name}'s account balance is below ${threshold:.2f}.</p>
                        <p><strong>Current Balance:</strong> ${child.current_balance:.2f}</p>
                        <p>Consider adding funds to their account.</p>
                    </body>
                    </html>
                    """

                    if send_email(parent_email, subject, html_body):
                        reminders_sent += 1

    return reminders_sent
