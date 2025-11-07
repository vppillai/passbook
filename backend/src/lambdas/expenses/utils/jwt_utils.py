"""
JWT token management utilities for authentication.
"""
import os
import jwt
import time
import boto3
import json
from typing import Dict, Optional, Any
from datetime import datetime, timedelta
from botocore.exceptions import ClientError

# JWT configuration
JWT_ALGORITHM = 'HS256'
DEFAULT_EXPIRATION_MINUTES = 15


def get_jwt_secret() -> str:
    """
    Retrieve JWT secret from AWS Secrets Manager.

    Returns:
        JWT secret string

    Raises:
        Exception: If secret cannot be retrieved
    """
    secret_name = os.environ.get('JWT_SECRET_NAME', 'passbook/development/jwt-secret')
    region = os.environ.get('PASSBOOK_AWS_REGION', os.environ.get('AWS_DEFAULT_REGION', 'us-west-2'))

    session = boto3.session.Session()
    client = session.client(
        service_name='secretsmanager',
        region_name=region
    )

    try:
        response = client.get_secret_value(SecretId=secret_name)
        secret_data = json.loads(response['SecretString'])

        # Handle both generated and manual secrets
        if 'secret' in secret_data:
            return secret_data['secret']
        elif isinstance(secret_data, str):
            return secret_data
        else:
            raise ValueError("Invalid JWT secret format")

    except ClientError as e:
        raise Exception(f"Failed to retrieve JWT secret: {str(e)}")


def generate_token(
    user_id: str,
    email: str,
    family_id: Optional[str] = None,
    user_type: str = 'parent',
    expiration_minutes: int = DEFAULT_EXPIRATION_MINUTES
) -> str:
    """
    Generate a JWT token for a user.

    Args:
        user_id: User's unique identifier
        email: User's email address
        family_id: Family account ID (optional)
        user_type: Type of user ('parent' or 'child')
        expiration_minutes: Token expiration time in minutes

    Returns:
        Encoded JWT token string
    """
    secret = get_jwt_secret()

    payload = {
        'userId': user_id,
        'email': email,
        'userType': user_type,
        'iat': int(time.time()),
        'exp': int(time.time()) + (expiration_minutes * 60),
    }

    if family_id:
        payload['familyId'] = family_id

    token = jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)
    return token


def verify_token(token: str) -> Dict[str, Any]:
    """
    Verify and decode a JWT token.

    Args:
        token: JWT token string

    Returns:
        Decoded token payload

    Raises:
        jwt.ExpiredSignatureError: If token has expired
        jwt.InvalidTokenError: If token is invalid
    """
    secret = get_jwt_secret()

    try:
        payload = jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise Exception("Token has expired")
    except jwt.InvalidTokenError as e:
        raise Exception(f"Invalid token: {str(e)}")


def decode_token_without_verification(token: str) -> Dict[str, Any]:
    """
    Decode a JWT token without verification (for debugging/logging only).

    Args:
        token: JWT token string

    Returns:
        Decoded token payload (unverified)
    """
    return jwt.decode(token, options={"verify_signature": False})


def is_token_expired(token: str) -> bool:
    """
    Check if a token is expired without full verification.

    Args:
        token: JWT token string

    Returns:
        True if token is expired, False otherwise
    """
    try:
        payload = decode_token_without_verification(token)
        exp = payload.get('exp', 0)
        return int(time.time()) >= exp
    except Exception:
        return True


def refresh_token(token: str, expiration_minutes: int = DEFAULT_EXPIRATION_MINUTES) -> str:
    """
    Refresh an existing token by creating a new one with extended expiration.

    Args:
        token: Existing JWT token
        expiration_minutes: New expiration time in minutes

    Returns:
        New JWT token

    Raises:
        Exception: If original token is invalid or expired
    """
    payload = verify_token(token)

    return generate_token(
        user_id=payload['userId'],
        email=payload['email'],
        family_id=payload.get('familyId'),
        user_type=payload.get('userType', 'parent'),
        expiration_minutes=expiration_minutes
    )
