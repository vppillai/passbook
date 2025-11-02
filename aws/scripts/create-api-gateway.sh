#!/bin/bash
# Script to create API Gateway resources after CloudFormation stack is deployed
# This is needed because CloudFormation has issues with RootResourceId

set -e

ENVIRONMENT=${1:-development}
REGION=${2:-us-east-1}
PROJECT_NAME="allowance-passbook"

echo "🔧 Creating API Gateway resources for ${ENVIRONMENT}..."

# Get API Gateway ID
API_ID=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayId`].OutputValue' \
  --output text)

if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
    echo "❌ API Gateway not found in stack"
    exit 1
fi

echo "API Gateway ID: ${API_ID}"

# Get Root Resource ID
ROOT_ID=$(aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --region ${REGION} \
  --query 'items[?path==`/`].id' \
  --output text)

echo "Root Resource ID: ${ROOT_ID}"

# Create /api resource
API_RESOURCE=$(aws apigateway create-resource \
  --rest-api-id ${API_ID} \
  --parent-id ${ROOT_ID} \
  --path-part api \
  --region ${REGION} \
  --query 'id' \
  --output text)

echo "Created /api resource: ${API_RESOURCE}"

# Create /api/email resource
EMAIL_RESOURCE=$(aws apigateway create-resource \
  --rest-api-id ${API_ID} \
  --parent-id ${API_RESOURCE} \
  --path-part email \
  --region ${REGION} \
  --query 'id' \
  --output text)

echo "Created /api/email resource: ${EMAIL_RESOURCE}"

# Create /api/email/send resource
SEND_RESOURCE=$(aws apigateway create-resource \
  --rest-api-id ${API_ID} \
  --parent-id ${EMAIL_RESOURCE} \
  --path-part send \
  --region ${REGION} \
  --query 'id' \
  --output text)

echo "Created /api/email/send resource: ${SEND_RESOURCE}"

# Get Lambda function ARN
LAMBDA_ARN=$(aws lambda get-function \
  --function-name ${PROJECT_NAME}-${ENVIRONMENT}-email-service \
  --region ${REGION} \
  --query 'Configuration.FunctionArn' \
  --output text)

echo "Lambda ARN: ${LAMBDA_ARN}"

# Create POST method
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method POST \
  --authorization-type NONE \
  --region ${REGION}

echo "Created POST method"

# Setup Lambda integration
aws apigateway put-integration \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${LAMBDA_ARN}/invocations" \
  --region ${REGION}

echo "Setup Lambda integration"

# Create OPTIONS method for CORS
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method OPTIONS \
  --authorization-type NONE \
  --region ${REGION}

aws apigateway put-integration \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method OPTIONS \
  --type MOCK \
  --integration-http-method OPTIONS \
  --request-templates '{"application/json":"{\"statusCode\":200}"}' \
  --region ${REGION}

aws apigateway put-method-response \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters 'method.response.header.Access-Control-Allow-Origin=true,method.response.header.Access-Control-Allow-Headers=true,method.response.header.Access-Control-Allow-Methods=true' \
  --region ${REGION}

echo "Created OPTIONS method for CORS"

# Deploy API
STAGE=$(aws cloudformation describe-stacks \
  --stack-name ${PROJECT_NAME}-${ENVIRONMENT} \
  --region ${REGION} \
  --query 'Stacks[0].Parameters[?ParameterKey==`ApiStage`].ParameterValue' \
  --output text || echo "dev")

aws apigateway create-deployment \
  --rest-api-id ${API_ID} \
  --stage-name ${STAGE} \
  --region ${REGION}

echo "✅ API Gateway configured!"
echo ""
echo "API Endpoint: https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}/api/email/send"

