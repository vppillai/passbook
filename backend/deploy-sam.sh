#!/bin/bash

# Passbook SAM Deployment Script
# Usage: ./deploy-sam.sh [environment] [region]
# Example: ./deploy-sam.sh development us-west-2

set -e

# Disable SAM telemetry
export SAM_CLI_TELEMETRY=0

ENVIRONMENT=${1:-development}
REGION=${2:-us-west-2}
STACK_NAME="passbook-${ENVIRONMENT}"

echo "============================================"
echo "Passbook SAM Deployment"
echo "Environment: ${ENVIRONMENT}"
echo "Region: ${REGION}"
echo "Stack: ${STACK_NAME}"
echo "============================================"

# Check for required tools
if ! command -v sam &> /dev/null; then
    echo "❌ AWS SAM CLI not found. Please install it:"
    echo "   pip install aws-sam-cli"
    echo "   or"
    echo "   brew install aws-sam-cli"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install it."
    exit 1
fi

# Check AWS credentials
echo "Checking AWS credentials..."
if ! aws sts get-caller-identity --region ${REGION} > /dev/null 2>&1; then
    echo "❌ AWS credentials not configured or invalid"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "✅ AWS Account: ${ACCOUNT_ID}"

# Prompt for SMTP credentials if not in environment and not in CI
if [ -z "$CI" ] && [ -z "$GITHUB_ACTIONS" ]; then
  if [ -z "$SMTP_USER" ]; then
    read -p "Enter SMTP username (email): " SMTP_USER
  fi
  if [ -z "$SMTP_PASSWORD" ]; then
    read -sp "Enter SMTP password: " SMTP_PASSWORD
    echo
  fi
  if [ -z "$SMTP_FROM" ]; then
    SMTP_FROM="${SMTP_USER}"
  fi
else
  # In CI, use defaults if not provided
  SMTP_USER=${SMTP_USER:-"noreply@passbook.local"}
  SMTP_PASSWORD=${SMTP_PASSWORD:-"placeholder"}
  SMTP_FROM=${SMTP_FROM:-"noreply@passbook.local"}
  echo "ℹ️  Using default SMTP credentials for CI (emails will not send)"
fi

echo ""
echo "📦 Building Lambda functions..."

# Navigate to backend directory
cd infrastructure

# Build SAM application with optimizations
sam build --template complete-stack.yaml \
  --region ${REGION} \
  --use-container \
  --parallel \
  --cached

echo ""
echo "📤 Packaging application..."

# Create S3 bucket for deployment artifacts if it doesn't exist
S3_BUCKET="passbook-sam-deployments-${ACCOUNT_ID}-${REGION}"
if ! aws s3 ls "s3://${S3_BUCKET}" 2>&1 > /dev/null; then
    echo "Creating S3 bucket: ${S3_BUCKET}"
    aws s3 mb "s3://${S3_BUCKET}" --region ${REGION}
    aws s3api put-public-access-block \
        --bucket ${S3_BUCKET} \
        --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
fi

echo ""
echo "🚀 Deploying SAM stack..."

# Deploy using SAM
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name ${STACK_NAME} \
  --s3-bucket ${S3_BUCKET} \
  --s3-prefix ${STACK_NAME} \
  --region ${REGION} \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    Environment=${ENVIRONMENT} \
    SMTPUser=${SMTP_USER} \
    SMTPPassword=${SMTP_PASSWORD} \
    SMTPFrom=${SMTP_FROM} \
  --tags \
    Project=passbook \
    Environment=${ENVIRONMENT} \
  --no-fail-on-empty-changeset

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Stack Outputs:"
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs' \
  --output table

# Get API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

echo ""
echo "============================================"
echo "✅ Deployment Successful!"
echo "============================================"
echo "API Endpoint: ${API_URL}"
echo ""
echo "Next steps:"
echo "1. Update frontend .env with API_URL:"
echo "   EXPO_PUBLIC_API_URL=${API_URL}"
echo "2. Test the API:"
echo "   curl ${API_URL}/auth/signup -X POST -H 'Content-Type: application/json' -d '{\"email\":\"test@example.com\",\"password\":\"password123\",\"displayName\":\"Test User\"}'"
echo ""
echo "To tear down the stack:"
echo "   aws cloudformation delete-stack --stack-name ${STACK_NAME} --region ${REGION}"
echo "============================================"
