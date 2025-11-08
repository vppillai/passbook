"""
Base Lambda handler utilities for consistent error handling and response formatting.
"""
import json
import logging
import traceback
from typing import Any, Dict, Optional, Callable
from functools import wraps
from decimal import Decimal

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)


class LambdaError(Exception):
    """Base exception for Lambda errors."""
    def __init__(self, message: str, status_code: int = 400):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


def create_response(
    status_code: int = 200,
    body: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Create a standardized API Gateway response.

    Args:
        status_code: HTTP status code
        body: Response body (will be JSON serialized)
        headers: Additional headers (CORS headers are added automatically)

    Returns:
        API Gateway response dictionary
    """
    default_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    }

    if headers:
        default_headers.update(headers)

    return {
        'statusCode': status_code,
        'headers': default_headers,
        'body': json.dumps(body, cls=DecimalEncoder) if body else json.dumps({}),
    }


def error_response(error: Exception, status_code: int = 500) -> Dict[str, Any]:
    """
    Create an error response from an exception.

    Args:
        error: Exception instance
        status_code: HTTP status code

    Returns:
        API Gateway error response
    """
    error_message = str(error)
    if isinstance(error, LambdaError):
        status_code = error.status_code

    logger.error(f"Lambda error: {error_message}\n{traceback.format_exc()}")

    return create_response(
        status_code=status_code,
        body={
            'error': error_message,
            'type': type(error).__name__,
        }
    )


def lambda_handler_wrapper(handler_func: Callable) -> Callable:
    """
    Decorator to wrap Lambda handlers with consistent error handling.

    Usage:
        @lambda_handler_wrapper
        def handler(event, context):
        # handler logic
        return create_response(...)
    """
    @wraps(handler_func)
    def wrapper(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
        try:
            # Log incoming request
            logger.info(f"Received event: {json.dumps(event)}")

            # Handle OPTIONS preflight
            if event.get('httpMethod') == 'OPTIONS':
                return create_response(status_code=200)

            # Call the actual handler
            result = handler_func(event, context)

            # Ensure result is a proper response
            if isinstance(result, dict) and 'statusCode' in result:
                return result
            else:
                return create_response(body=result if result else {})

        except Exception as e:
            return error_response(e)

    return wrapper


def get_path_parameter(event: Dict[str, Any], param_name: str) -> Optional[str]:
    """Extract path parameter from API Gateway event."""
    return event.get('pathParameters', {}).get(param_name)


def get_query_parameter(event: Dict[str, Any], param_name: str, default: Any = None) -> Any:
    """Extract query parameter from API Gateway event."""
    query_params = event.get('queryStringParameters') or {}
    return query_params.get(param_name, default)


def get_request_body(event: Dict[str, Any]) -> Dict[str, Any]:
    """Parse and return request body from API Gateway event."""
    body = event.get('body', '{}')
    if isinstance(body, str):
        return json.loads(body)
    return body


def get_authorization_token(event: Dict[str, Any]) -> Optional[str]:
    """Extract authorization token from API Gateway event."""
    headers = event.get('headers', {})
    auth_header = headers.get('Authorization') or headers.get('authorization', '')

    if auth_header.startswith('Bearer '):
        return auth_header[7:]
    return None


def get_api_key(event: Dict[str, Any]) -> Optional[str]:
    """Extract API key from API Gateway event."""
    headers = event.get('headers', {})
    return headers.get('X-Api-Key') or headers.get('x-api-key')
