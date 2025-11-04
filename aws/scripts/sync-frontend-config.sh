#!/bin/bash
# Script to sync CloudFormation stack outputs to frontend .env.production
# This can be run manually after deploying backend changes
# Usage: ./sync-frontend-config.sh <environment> [region]

set -e

ENVIRONMENT=${1:-production}
REGION=${2:-us-west-2}
PROJECT_NAME="allowance-passbook"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"

echo "🔄 Syncing backend configuration to frontend..."
echo "   Environment: ${ENVIRONMENT}"
echo "   Region: ${REGION}"
echo "   Stack: ${STACK_NAME}"
echo ""

# Get CloudFormation stack outputs
echo "📋 Fetching CloudFormation stack outputs..."
OUTPUTS=$(aws cloudformation describe-stacks \
  --stack-name "${STACK_NAME}" \
  --region "${REGION}" \
  --query 'Stacks[0].Outputs' \
  --output json)

if [ -z "$OUTPUTS" ] || [ "$OUTPUTS" == "null" ]; then
  echo "❌ Error: Stack ${STACK_NAME} not found or has no outputs"
  exit 1
fi

# Extract values
API_BASE_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiGatewayBaseUrl") | .OutputValue // empty')
EMAIL_API_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="EmailServiceEndpoint") | .OutputValue // empty')
AUTH_LOGIN_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AuthLoginEndpoint") | .OutputValue // empty')
AUTH_VALIDATE_URL=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="AuthValidateEndpoint") | .OutputValue // empty')

if [ -z "$EMAIL_API_URL" ]; then
  echo "⚠️  Warning: EmailServiceEndpoint not found, using fallback"
  EMAIL_API_URL="https://$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiGatewayId") | .OutputValue').execute-api.${REGION}.amazonaws.com/v1/api/email/send"
fi

# Extract base auth URL from login endpoint
if [ -n "$AUTH_LOGIN_URL" ]; then
  AUTH_API_URL=$(echo "$AUTH_LOGIN_URL" | sed 's|/auth/login$|/auth|')
elif [ -n "$API_BASE_URL" ]; then
  AUTH_API_URL="${API_BASE_URL}/auth"
else
  echo "⚠️  Warning: Auth endpoints not found, using fallback"
  API_ID=$(echo "$OUTPUTS" | jq -r '.[] | select(.OutputKey=="ApiGatewayId") | .OutputValue')
  AUTH_API_URL="https://${API_ID}.execute-api.${REGION}.amazonaws.com/v1/api"
fi

echo "✅ Retrieved endpoints:"
echo "   API Base: ${API_BASE_URL:-N/A}"
echo "   Email: ${EMAIL_API_URL}"
echo "   Auth: ${AUTH_API_URL}"
echo ""

# Update .env.production
ENV_FILE="frontend/.env.production"
echo "📝 Updating ${ENV_FILE}..."

cat > "$ENV_FILE" << EOF
# Production environment variables for Allowance Passbook
# Auto-generated from CloudFormation stack: ${STACK_NAME}
# Region: ${REGION}
# Last updated: $(date -u +"%Y-%m-%d %H:%M:%S UTC")

# Email service API endpoint (AWS API Gateway)
VITE_EMAIL_API_URL=${EMAIL_API_URL}

# Auth service API endpoint (AWS API Gateway)
VITE_AUTH_API_URL=${AUTH_API_URL}

# Alternative: Use base URL for all services
VITE_API_URL=${API_BASE_URL:-${AUTH_API_URL%/auth}}
EOF

echo "✅ Updated ${ENV_FILE}:"
cat "$ENV_FILE"
echo ""
echo "💡 Next steps:"
echo "   1. Review the changes: git diff ${ENV_FILE}"
echo "   2. Commit and push: git commit -am 'chore: update API endpoints from backend' && git push"
echo "   3. Frontend will rebuild automatically on push to main"

