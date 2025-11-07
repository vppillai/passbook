"""
Email service using Zoho SMTP for sending verification and notification emails.
"""
import os
import json
import smtplib
import boto3
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional
from botocore.exceptions import ClientError


def get_smtp_credentials() -> dict:
    """
    Retrieve SMTP credentials from AWS Secrets Manager.

    Returns:
        Dictionary with SMTP configuration
    """
    secret_name = os.environ.get('SMTP_SECRET_NAME', 'passbook/development/smtp-credentials')
    region = os.environ.get('PASSBOOK_AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'))

    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region
    )

    try:
        response = client.get_secret_value(SecretId=secret_name)
        return json.loads(response['SecretString'])
    except ClientError as e:
        raise Exception(f"Failed to retrieve SMTP credentials: {str(e)}")


def send_email(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: Optional[str] = None
) -> bool:
    """
    Send an email using Zoho SMTP.

    Args:
        to_email: Recipient email address
        subject: Email subject
        html_body: HTML email body
        text_body: Plain text email body (optional)

    Returns:
        True if email sent successfully, False otherwise
    """
    try:
        credentials = get_smtp_credentials()

        # Create message
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = credentials['from']
        msg['To'] = to_email

        # Add text and HTML parts
        if text_body:
            text_part = MIMEText(text_body, 'plain')
            msg.attach(text_part)

        html_part = MIMEText(html_body, 'html')
        msg.attach(html_part)

        # Connect to SMTP server
        smtp_host = credentials['host']
        smtp_port = int(credentials['port'])
        use_tls = credentials.get('secure', 'false').lower() == 'true'

        with smtplib.SMTP(smtp_host, smtp_port) as server:
            if use_tls:
                server.starttls()

            server.login(credentials['user'], credentials['password'])
            server.send_message(msg)

        return True

    except Exception as e:
        print(f"Error sending email: {str(e)}")
        return False


def send_verification_email(email: str, token: str, verification_type: str = 'activation') -> bool:
    """
    Send email verification email.

    Args:
        email: Recipient email address
        token: Verification token
        verification_type: Type of verification (activation, passwordReset, invitation)

    Returns:
        True if email sent successfully
    """
    # Get base URL from environment
    base_url = os.environ.get('APP_BASE_URL', 'https://passbook.app')
    verification_url = f"{base_url}/verify-email?token={token}"

    if verification_type == 'activation':
        subject = "Verify your Passbook account"
        html_body = f"""
        <html>
        <body>
            <h2>Welcome to Passbook!</h2>
            <p>Please verify your email address by clicking the link below:</p>
            <p><a href="{verification_url}">Verify Email Address</a></p>
            <p>This link will expire in 24 hours.</p>
            <p>If you didn't create this account, you can safely ignore this email.</p>
        </body>
        </html>
        """
        text_body = f"""
        Welcome to Passbook!

        Please verify your email address by visiting:
        {verification_url}

        This link will expire in 24 hours.

        If you didn't create this account, you can safely ignore this email.
        """

    elif verification_type == 'passwordReset':
        subject = "Reset your Passbook password"
        html_body = f"""
        <html>
        <body>
            <h2>Password Reset Request</h2>
            <p>You requested to reset your password. Click the link below to continue:</p>
            <p><a href="{verification_url}">Reset Password</a></p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, you can safely ignore this email.</p>
        </body>
        </html>
        """
        text_body = f"""
        Password Reset Request

        You requested to reset your password. Visit:
        {verification_url}

        This link will expire in 1 hour.

        If you didn't request this, you can safely ignore this email.
        """

    elif verification_type == 'invitation':
        subject = "You've been invited to join a Passbook family"
        html_body = f"""
        <html>
        <body>
            <h2>Family Invitation</h2>
            <p>You've been invited to join a Passbook family account.</p>
            <p>Click the link below to accept the invitation:</p>
            <p><a href="{verification_url}">Accept Invitation</a></p>
            <p>This link will expire in 7 days.</p>
        </body>
        </html>
        """
        text_body = f"""
        Family Invitation

        You've been invited to join a Passbook family account.
        Visit: {verification_url}

        This link will expire in 7 days.
        """

    else:
        subject = "Verify your email"
        html_body = f"<p>Please verify your email: <a href='{verification_url}'>Click here</a></p>"
        text_body = f"Please verify your email: {verification_url}"

    return send_email(email, subject, html_body, text_body)
