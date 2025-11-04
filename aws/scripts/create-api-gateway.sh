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

# Get or create /api resource
API_RESOURCE=$(aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --region ${REGION} \
  --query 'items[?path==`/api`].id' \
  --output text)

if [ -z "$API_RESOURCE" ] || [ "$API_RESOURCE" = "None" ]; then
  API_RESOURCE=$(aws apigateway create-resource \
    --rest-api-id ${API_ID} \
    --parent-id ${ROOT_ID} \
    --path-part api \
    --region ${REGION} \
    --query 'id' \
    --output text)
  echo "Created /api resource: ${API_RESOURCE}"
else
  echo "Using existing /api resource: ${API_RESOURCE}"
fi

# Get or create /api/email resource
EMAIL_RESOURCE=$(aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --region ${REGION} \
  --query 'items[?path==`/api/email`].id' \
  --output text)

if [ -z "$EMAIL_RESOURCE" ] || [ "$EMAIL_RESOURCE" = "None" ]; then
  EMAIL_RESOURCE=$(aws apigateway create-resource \
    --rest-api-id ${API_ID} \
    --parent-id ${API_RESOURCE} \
    --path-part email \
    --region ${REGION} \
    --query 'id' \
    --output text)
  echo "Created /api/email resource: ${EMAIL_RESOURCE}"
else
  echo "Using existing /api/email resource: ${EMAIL_RESOURCE}"
fi

# Get or create /api/email/send resource
SEND_RESOURCE=$(aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --region ${REGION} \
  --query 'items[?path==`/api/email/send`].id' \
  --output text)

if [ -z "$SEND_RESOURCE" ] || [ "$SEND_RESOURCE" = "None" ]; then
  SEND_RESOURCE=$(aws apigateway create-resource \
    --rest-api-id ${API_ID} \
    --parent-id ${EMAIL_RESOURCE} \
    --path-part send \
    --region ${REGION} \
    --query 'id' \
    --output text)
  echo "Created /api/email/send resource: ${SEND_RESOURCE}"
else
  echo "Using existing /api/email/send resource: ${SEND_RESOURCE}"
fi

# Get Lambda function ARN
LAMBDA_ARN=$(aws lambda get-function \
  --function-name ${PROJECT_NAME}-${ENVIRONMENT}-email-service \
  --region ${REGION} \
  --query 'Configuration.FunctionArn' \
  --output text)

echo "Lambda ARN: ${LAMBDA_ARN}"

# Create POST method (ignore if already exists)
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method POST \
  --authorization-type NONE \
  --region ${REGION} 2>/dev/null || echo "POST method already exists"

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

# Create OPTIONS method for CORS (ignore if already exists)
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method OPTIONS \
  --authorization-type NONE \
  --region ${REGION} 2>/dev/null || echo "OPTIONS method already exists"

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

aws apigateway put-integration-response \
  --rest-api-id ${API_ID} \
  --resource-id ${SEND_RESOURCE} \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Origin":"'"'"'"*"'"'"'","method.response.header.Access-Control-Allow-Headers":"'"'"'"Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'"POST,OPTIONS"'"'"'"}' \
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

# Create /api/auth resource
AUTH_RESOURCE=$(aws apigateway create-resource \
  --rest-api-id ${API_ID} \
  --parent-id ${API_RESOURCE} \
  --path-part auth \
  --region ${REGION} \
  --query 'id' \
  --output text 2>/dev/null || aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --region ${REGION} \
  --query 'items[?path==`/api/auth`].id' \
  --output text)

if [ -z "$AUTH_RESOURCE" ] || [ "$AUTH_RESOURCE" = "None" ]; then
  AUTH_RESOURCE=$(aws apigateway create-resource \
    --rest-api-id ${API_ID} \
    --parent-id ${API_RESOURCE} \
    --path-part auth \
    --region ${REGION} \
    --query 'id' \
    --output text)
  echo "Created /api/auth resource: ${AUTH_RESOURCE}"
else
  echo "Using existing /api/auth resource: ${AUTH_RESOURCE}"
fi

# Get or create /api/auth/login resource
LOGIN_RESOURCE=$(aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --region ${REGION} \
  --query 'items[?path==`/api/auth/login`].id' \
  --output text)

if [ -z "$LOGIN_RESOURCE" ] || [ "$LOGIN_RESOURCE" = "None" ]; then
  LOGIN_RESOURCE=$(aws apigateway create-resource \
    --rest-api-id ${API_ID} \
    --parent-id ${AUTH_RESOURCE} \
    --path-part login \
    --region ${REGION} \
    --query 'id' \
    --output text)
  echo "Created /api/auth/login resource: ${LOGIN_RESOURCE}"
else
  echo "Using existing /api/auth/login resource: ${LOGIN_RESOURCE}"
fi

# Get Auth Service Lambda function ARN
AUTH_LAMBDA_ARN=$(aws lambda get-function \
  --function-name ${PROJECT_NAME}-${ENVIRONMENT}-auth-service \
  --region ${REGION} \
  --query 'Configuration.FunctionArn' \
  --output text)

echo "Auth Lambda ARN: ${AUTH_LAMBDA_ARN}"

# Create POST method for /api/auth/login
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${LOGIN_RESOURCE} \
  --http-method POST \
  --authorization-type NONE \
  --region ${REGION} 2>/dev/null || echo "POST method already exists"

echo "Created POST method for /api/auth/login"

# Setup Lambda integration for /api/auth/login
aws apigateway put-integration \
  --rest-api-id ${API_ID} \
  --resource-id ${LOGIN_RESOURCE} \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${AUTH_LAMBDA_ARN}/invocations" \
  --region ${REGION}

echo "Setup Lambda integration for /api/auth/login"

# Create OPTIONS method for CORS on /api/auth/login (ignore if already exists)
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${LOGIN_RESOURCE} \
  --http-method OPTIONS \
  --authorization-type NONE \
  --region ${REGION} 2>/dev/null || echo "OPTIONS method already exists for /api/auth/login"

aws apigateway put-integration \
  --rest-api-id ${API_ID} \
  --resource-id ${LOGIN_RESOURCE} \
  --http-method OPTIONS \
  --type MOCK \
  --integration-http-method OPTIONS \
  --request-templates '{"application/json":"{\"statusCode\":200}"}' \
  --region ${REGION}

aws apigateway put-method-response \
  --rest-api-id ${API_ID} \
  --resource-id ${LOGIN_RESOURCE} \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters 'method.response.header.Access-Control-Allow-Origin=true,method.response.header.Access-Control-Allow-Headers=true,method.response.header.Access-Control-Allow-Methods=true' \
  --region ${REGION}

aws apigateway put-integration-response \
  --rest-api-id ${API_ID} \
  --resource-id ${LOGIN_RESOURCE} \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Origin":"'"'"'"*"'"'"'","method.response.header.Access-Control-Allow-Headers":"'"'"'"Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'"POST,OPTIONS"'"'"'"}' \
  --region ${REGION}

echo "Created OPTIONS method for CORS on /api/auth/login"

# Get or create /api/auth/validate resource
VALIDATE_RESOURCE=$(aws apigateway get-resources \
  --rest-api-id ${API_ID} \
  --region ${REGION} \
  --query 'items[?path==`/api/auth/validate`].id' \
  --output text)

if [ -z "$VALIDATE_RESOURCE" ] || [ "$VALIDATE_RESOURCE" = "None" ]; then
  VALIDATE_RESOURCE=$(aws apigateway create-resource \
    --rest-api-id ${API_ID} \
    --parent-id ${AUTH_RESOURCE} \
    --path-part validate \
    --region ${REGION} \
    --query 'id' \
    --output text)
  echo "Created /api/auth/validate resource: ${VALIDATE_RESOURCE}"
else
  echo "Using existing /api/auth/validate resource: ${VALIDATE_RESOURCE}"
fi

# Create POST method for /api/auth/validate (ignore if already exists)
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${VALIDATE_RESOURCE} \
  --http-method POST \
  --authorization-type NONE \
  --region ${REGION} 2>/dev/null || echo "POST method already exists"

# Setup Lambda integration for /api/auth/validate
aws apigateway put-integration \
  --rest-api-id ${API_ID} \
  --resource-id ${VALIDATE_RESOURCE} \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri "arn:aws:apigateway:${REGION}:lambda:path/2015-03-31/functions/${AUTH_LAMBDA_ARN}/invocations" \
  --region ${REGION}

# Create OPTIONS method for CORS on /api/auth/validate (ignore if already exists)
aws apigateway put-method \
  --rest-api-id ${API_ID} \
  --resource-id ${VALIDATE_RESOURCE} \
  --http-method OPTIONS \
  --authorization-type NONE \
  --region ${REGION} 2>/dev/null || echo "OPTIONS method already exists for /api/auth/validate"

aws apigateway put-integration \
  --rest-api-id ${API_ID} \
  --resource-id ${VALIDATE_RESOURCE} \
  --http-method OPTIONS \
  --type MOCK \
  --integration-http-method OPTIONS \
  --request-templates '{"application/json":"{\"statusCode\":200}"}' \
  --region ${REGION}

aws apigateway put-method-response \
  --rest-api-id ${API_ID} \
  --resource-id ${VALIDATE_RESOURCE} \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters 'method.response.header.Access-Control-Allow-Origin=true,method.response.header.Access-Control-Allow-Headers=true,method.response.header.Access-Control-Allow-Methods=true' \
  --region ${REGION}

aws apigateway put-integration-response \
  --rest-api-id ${API_ID} \
  --resource-id ${VALIDATE_RESOURCE} \
  --http-method OPTIONS \
  --status-code 200 \
  --response-parameters '{"method.response.header.Access-Control-Allow-Origin":"'"'"'"*"'"'"'","method.response.header.Access-Control-Allow-Headers":"'"'"'"Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token"'"'"'","method.response.header.Access-Control-Allow-Methods":"'"'"'"POST,OPTIONS"'"'"'"}' \
  --region ${REGION}

echo "Created OPTIONS method for CORS on /api/auth/validate"

# Re-deploy API to include new routes
aws apigateway create-deployment \
  --rest-api-id ${API_ID} \
  --stage-name ${STAGE} \
  --region ${REGION} \
  --description "Deploy auth service routes" 2>/dev/null || echo "Deployment may already exist"

echo "✅ API Gateway configured!"
echo ""
echo "API Endpoints:"
echo "  Email: https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}/api/email/send"
echo "  Auth Login: https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}/api/auth/login"
echo "  Auth Validate: https://${API_ID}.execute-api.${REGION}.amazonaws.com/${STAGE}/api/auth/validate"

