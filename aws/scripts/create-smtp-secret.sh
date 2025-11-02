#!/bin/bash

# Quick script to create/update the Zoho SMTP secret via AWS CLI
# This can be used before deploying CloudFormation or to update the password

set -e

ENVIRONMENT=${1:-development}
PASSWORD="${SMTP_PASSWORD:-}"
PROJECT_NAME="allowance-passbook"
SECRET_NAME="${PROJECT_NAME}/${ENVIRONMENT}/zoho-smtp-password"

echo "🔐 Creating/updating Zoho SMTP password in AWS Secrets Manager..."
echo "   Environment: ${ENVIRONMENT}"
echo "   Secret Name: ${SECRET_NAME}"
echo ""

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
    echo "📝 Updating existing secret..."
    aws secretsmanager update-secret \
        --secret-id "${SECRET_NAME}" \
        --secret-string "${SECRET_JSON}" \
        --description "Zoho SMTP password for sending password reset emails"
    echo "✅ Secret updated!"
else
    echo "📝 Creating new secret..."
    aws secretsmanager create-secret \
        --name "${SECRET_NAME}" \
        --secret-string "${SECRET_JSON}" \
        --description "Zoho SMTP password for sending password reset emails" \
        --tags Key=Project,Value=${PROJECT_NAME} Key=Environment,Value=${ENVIRONMENT} Key=Purpose,Value=email-smtp-credentials
    echo "✅ Secret created!"
fi

echo ""
echo "💡 Secret is ready for use in Lambda functions"

