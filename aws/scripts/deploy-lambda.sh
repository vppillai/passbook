#!/bin/bash

# Deploy Lambda function code after CloudFormation stack is deployed
# Usage: ./deploy-lambda.sh <environment> [region]
# Example: ./deploy-lambda.sh production us-east-1

set -e

ENVIRONMENT=${1:-development}
REGION=${2:-us-east-1}
PROJECT_NAME="allowance-passbook"
FUNCTION_NAME="${PROJECT_NAME}-${ENVIRONMENT}-email-service"
LAMBDA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../lambda/email-service" && pwd)"

echo "🚀 Deploying Lambda function: ${FUNCTION_NAME}"
echo "   Environment: ${ENVIRONMENT}"
echo "   Region: ${REGION}"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ Error: AWS CLI is not installed"
    exit 1
fi

# Check if function exists
if ! aws lambda get-function --function-name "${FUNCTION_NAME}" --region "${REGION}" &> /dev/null; then
    echo "❌ Error: Lambda function ${FUNCTION_NAME} does not exist"
    echo "   Deploy CloudFormation stack first: ./deploy.sh -e ${ENVIRONMENT} -r ${REGION}"
    exit 1
fi

# Package Lambda function
echo "📦 Packaging Lambda function..."
cd "${LAMBDA_DIR}"

if [ ! -f "package-lambda.sh" ]; then
    echo "❌ Error: package-lambda.sh not found in ${LAMBDA_DIR}"
    exit 1
fi

./package-lambda.sh

if [ ! -f "function.zip" ]; then
    echo "❌ Error: Failed to create function.zip"
    exit 1
fi

# Deploy to Lambda
echo ""
echo "📤 Uploading to Lambda..."
aws lambda update-function-code \
    --function-name "${FUNCTION_NAME}" \
    --zip-file fileb://function.zip \
    --region "${REGION}" \
    --output json > /tmp/lambda-update.json

echo "✅ Lambda function code deployed successfully!"
echo ""
echo "📋 Function details:"
cat /tmp/lambda-update.json | grep -E "(FunctionName|LastModified|CodeSize)" | head -3
echo ""
echo "🧪 Test the function:"
echo "   aws lambda invoke \\"
echo "     --function-name ${FUNCTION_NAME} \\"
echo "     --payload '{\"body\":\"{\\\"to\\\":\\\"test@example.com\\\",\\\"resetToken\\\":\\\"test\\\",\\\"accountType\\\":\\\"parent\\\",\\\"baseUrl\\\":\\\"https://vppillai.github.io/passbook\\\"}\"}' \\"
echo "     --region ${REGION} \\"
echo "     response.json"

