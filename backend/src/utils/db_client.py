"""
DynamoDB client wrapper for consistent database operations.
"""
import os
import json
import boto3
from typing import Dict, Any, List, Optional
from botocore.exceptions import ClientError
from decimal import Decimal


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder for handling Decimal types from DynamoDB."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)


class DynamoDBClient:
    """Wrapper for DynamoDB operations."""

    def __init__(self):
        region = os.environ.get('AWS_REGION', 'us-west-2')
        self.dynamodb = boto3.resource('dynamodb', region_name=region)
        self.client = boto3.client('dynamodb', region_name=region)

        # Table names from environment or defaults
        self.families_table = os.environ.get('FAMILIES_TABLE', 'passbook-families')
        self.transactions_table = os.environ.get('TRANSACTIONS_TABLE', 'passbook-transactions')
        self.auth_table = os.environ.get('AUTH_TABLE', 'passbook-auth')

    def get_item(self, table_name: str, key: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Get a single item from a table.

        Args:
            table_name: Name of the DynamoDB table
            key: Dictionary with partition key and sort key

        Returns:
            Item dictionary or None if not found
        """
        table = self.dynamodb.Table(table_name)
        try:
            response = table.get_item(Key=key)
            return response.get('Item')
        except ClientError as e:
            raise Exception(f"Error getting item: {str(e)}")

    def put_item(self, table_name: str, item: Dict[str, Any], condition_expression: Optional[str] = None) -> None:
        """
        Put an item into a table.

        Args:
            table_name: Name of the DynamoDB table
            item: Dictionary representing the item to put
            condition_expression: Optional condition expression for conditional writes
        """
        table = self.dynamodb.Table(table_name)
        try:
            kwargs = {'Item': item}
            if condition_expression:
                kwargs['ConditionExpression'] = condition_expression
            table.put_item(**kwargs)
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                raise Exception("Condition check failed")
            raise Exception(f"Error putting item: {str(e)}")

    def update_item(
        self,
        table_name: str,
        key: Dict[str, Any],
        update_expression: str,
        expression_attribute_values: Optional[Dict[str, Any]] = None,
        expression_attribute_names: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Update an item in a table.

        Args:
            table_name: Name of the DynamoDB table
            key: Dictionary with partition key and sort key
            update_expression: Update expression string
            expression_attribute_values: Values for the update expression
            expression_attribute_names: Attribute name mappings

        Returns:
            Updated item attributes
        """
        table = self.dynamodb.Table(table_name)
        try:
            kwargs = {
                'Key': key,
                'UpdateExpression': update_expression,
                'ReturnValues': 'ALL_NEW'
            }
            if expression_attribute_values:
                kwargs['ExpressionAttributeValues'] = expression_attribute_values
            if expression_attribute_names:
                kwargs['ExpressionAttributeNames'] = expression_attribute_names

            response = table.update_item(**kwargs)
            return response.get('Attributes', {})
        except ClientError as e:
            raise Exception(f"Error updating item: {str(e)}")

    def query(
        self,
        table_name: str,
        key_condition_expression: str,
        expression_attribute_values: Dict[str, Any],
        index_name: Optional[str] = None,
        filter_expression: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Query items from a table.

        Args:
            table_name: Name of the DynamoDB table
            key_condition_expression: Key condition expression
            expression_attribute_values: Values for the condition expression
            index_name: Optional GSI or LSI name
            filter_expression: Optional filter expression

        Returns:
            List of matching items
        """
        table = self.dynamodb.Table(table_name)
        try:
            kwargs = {
                'KeyConditionExpression': key_condition_expression,
                'ExpressionAttributeValues': expression_attribute_values
            }
            if index_name:
                kwargs['IndexName'] = index_name
            if filter_expression:
                kwargs['FilterExpression'] = filter_expression

            response = table.query(**kwargs)
            return response.get('Items', [])
        except ClientError as e:
            raise Exception(f"Error querying items: {str(e)}")

    def delete_item(self, table_name: str, key: Dict[str, Any]) -> None:
        """
        Delete an item from a table.

        Args:
            table_name: Name of the DynamoDB table
            key: Dictionary with partition key and sort key
        """
        table = self.dynamodb.Table(table_name)
        try:
            table.delete_item(Key=key)
        except ClientError as e:
            raise Exception(f"Error deleting item: {str(e)}")

    def transact_write(self, transact_items: List[Dict[str, Any]]) -> None:
        """
        Execute a DynamoDB transaction.

        Args:
            transact_items: List of transaction items (Put, Update, Delete, ConditionCheck)
        """
        try:
            self.client.transact_write_items(TransactItems=transact_items)
        except ClientError as e:
            raise Exception(f"Error in transaction: {str(e)}")

    def serialize_item(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """
        Serialize an item for JSON response (convert Decimal to float).

        Args:
            item: DynamoDB item dictionary

        Returns:
            Serialized item dictionary
        """
        if not item:
            return {}
        return json.loads(json.dumps(item, cls=DecimalEncoder))
