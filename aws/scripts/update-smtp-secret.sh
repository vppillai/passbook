#!/bin/bash

# Script to update Zoho SMTP password in AWS Secrets Manager
# Usage: ./update-smtp-secret.sh <environment> [password]
# Example: ./update-smtp-secret.sh production pcP3p67YeZgu

set -e

ENVIRONMENT=${1:-development}
PASSWORD=${2:-pcP3p67YeZgu}
PROJECT_NAME="allowance-passbook"
SECRET_NAME="${PROJECT_NAME}/${ENVIRONMENT}/zoho-smtp-password"

echo "🔐 Updating Zoho SMTP password in AWS Secrets Manager..."
echo "   Environment: ${ENVIRONMENT}"
echo "   Secret Name: ${SECRET_NAME}"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is not installed"
    echo "   Install it from: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ Error: AWS credentials not configured"
    echo "   Run: aws configure"
    exit 1
fi

# Create or update secret
SECRET_JSON=$(cat <<EOF
{
  "password": "${PASSWORD}",
  "host": "smtp.zoho.in",
  "port": "587",
  "secure": "false",
  "user": "support@embeddedinn.com"
}
EOF
)

if aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" &> /dev/null; then
    echo "📝 Secret exists, updating..."
    aws secretsmanager update-secret \
        --secret-id "${SECRET_NAME}" \
        --secret-string "${SECRET_JSON}" \
        --description "Zoho SMTP password for sending password reset emails"
    echo "✅ Secret updated successfully!"
else
    echo "📝 Secret does not exist, creating..."
    aws secretsmanager create-secret \
        --name "${SECRET_NAME}" \
        --secret-string "${SECRET_JSON}" \
        --description "Zoho SMTP password for sending password reset emails" \
        --tags Key=Project,Value=${PROJECT_NAME} Key=Environment,Value=${ENVIRONMENT} Key=Purpose,Value=email-smtp-credentials
    echo "✅ Secret created successfully!"
fi

echo ""
echo "🔍 Verifying secret..."
SECRET_VALUE=$(aws secretsmanager get-secret-value --secret-id "${SECRET_NAME}" --query SecretString --output text)
echo "   Secret ARN: $(aws secretsmanager describe-secret --secret-id "${SECRET_NAME}" --query ARN --output text)"
echo "   ✅ Secret verified"
echo ""
echo "💡 To use this secret in Lambda:"
echo "   const secret = await secretsManager.getSecretValue({ SecretId: '${SECRET_NAME}' }).promise();"
echo "   const config = JSON.parse(secret.SecretString);"

