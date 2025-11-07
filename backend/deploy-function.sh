#!/bin/bash

# Deploy individual Lambda function for Passbook
# Usage: ./deploy-function.sh [function-path] [environment] [region]
# Examples:
#   ./deploy-function.sh auth/signup_handler development us-west-2
#   ./deploy-function.sh auth/verify_email_handler development
#   ./deploy-function.sh accounts/create_family_handler production

set -e

FUNCTION_PATH=${1:-}
ENVIRONMENT=${2:-development}
REGION=${3:-us-west-2}

if [ -z "$FUNCTION_PATH" ]; then
  echo "Usage: ./deploy-function.sh [function-path] [environment] [region]"
  echo ""
  echo "Examples:"
  echo "  ./deploy-function.sh auth/signup_handler development us-west-2"
  echo "  ./deploy-function.sh auth/verify_email_handler development"
  echo "  ./deploy-function.sh auth/login_handler development"
  echo "  ./deploy-function.sh accounts/create_family_handler development"
  echo ""
  echo "Function paths (User Story 1):"
  echo "  - auth/signup_handler"
  echo "  - auth/verify_email_handler"
  echo "  - auth/login_handler"
  echo "  - accounts/create_family_handler"
  exit 1
fi

# Extract function name from path (e.g., auth/signup_handler -> signup-handler)
FUNCTION_NAME=$(echo "$FUNCTION_PATH" | sed 's/\//-/g' | sed 's/_handler$//')
FUNCTION_DIR="src/lambdas/${FUNCTION_PATH}"
HANDLER_FILE="${FUNCTION_PATH}.py"
ZIP_FILE="/tmp/passbook-${FUNCTION_NAME}-${ENVIRONMENT}.zip"
BUILD_DIR="/tmp/passbook-lambda-build-$$"

# Validate function exists
if [ ! -f "${FUNCTION_DIR}.py" ]; then
  echo "Error: Function file not found: ${FUNCTION_DIR}.py"
  exit 1
fi

echo "=========================================="
echo "Deploying Lambda function: ${FUNCTION_NAME}"
echo "Function path: ${FUNCTION_PATH}"
echo "Environment: ${ENVIRONMENT}"
echo "Region: ${REGION}"
echo "=========================================="

# Clean build directory
rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

# Copy Lambda function
echo "📦 Copying Lambda function..."
cp "${FUNCTION_DIR}.py" "${BUILD_DIR}/"

# Copy shared dependencies (utils and models)
echo "📦 Copying shared dependencies..."
cp -r src/utils "${BUILD_DIR}/"
cp -r src/models "${BUILD_DIR}/"
cp src/__init__.py "${BUILD_DIR}/" 2>/dev/null || true

# Create __init__.py files if missing
touch "${BUILD_DIR}/utils/__init__.py"
touch "${BUILD_DIR}/models/__init__.py"

# Install Python dependencies
echo "📦 Installing Python dependencies..."
if [ -f "requirements.txt" ]; then
  pip install -r requirements.txt -t "${BUILD_DIR}" --quiet --disable-pip-version-check 2>&1 | grep -v "already satisfied" || true
else
  echo "Warning: requirements.txt not found, skipping dependency installation"
fi

# Create deployment package
echo "📦 Creating deployment package..."
cd "${BUILD_DIR}"
zip -r "${ZIP_FILE}" . -q -x "*.pyc" "__pycache__/*" "*.test.py" "*.pyo" "*.dist-info/*" "*.egg-info/*"
cd - > /dev/null

# Get package size
PACKAGE_SIZE=$(du -h "${ZIP_FILE}" | cut -f1)
echo "Package size: ${PACKAGE_SIZE}"

# Check if Lambda function exists
FUNCTION_FULL_NAME="passbook-${ENVIRONMENT}-${FUNCTION_NAME}"
FUNCTION_EXISTS=$(aws lambda get-function --function-name "${FUNCTION_FULL_NAME}" --region "${REGION}" 2>/dev/null || echo "")

if [ -z "$FUNCTION_EXISTS" ]; then
  echo "⚠️  Lambda function ${FUNCTION_FULL_NAME} does not exist."
  echo "   Please deploy infrastructure first using: ./deploy.sh ${ENVIRONMENT} ${REGION}"
  echo "   Or create the function manually in AWS Console."
  exit 1
fi

# Deploy to Lambda
echo "🚀 Deploying to Lambda..."
aws lambda update-function-code \
  --function-name "${FUNCTION_FULL_NAME}" \
  --zip-file "fileb://${ZIP_FILE}" \
  --region "${REGION}" \
  --output json > /tmp/lambda-deploy-output.json

# Wait for update to complete
echo "⏳ Waiting for deployment to complete..."
aws lambda wait function-updated \
  --function-name "${FUNCTION_FULL_NAME}" \
  --region "${REGION}"

# Get function info
FUNCTION_INFO=$(aws lambda get-function \
  --function-name "${FUNCTION_FULL_NAME}" \
  --region "${REGION}" \
  --query 'Configuration.[FunctionName,Runtime,LastModified,CodeSize]' \
  --output text)

echo ""
echo "✅ Function deployed successfully!"
echo "=========================================="
echo "Function: ${FUNCTION_FULL_NAME}"
echo "Runtime: $(echo $FUNCTION_INFO | cut -d' ' -f2)"
echo "Last Modified: $(echo $FUNCTION_INFO | cut -d' ' -f3)"
echo "Code Size: $(echo $FUNCTION_INFO | cut -d' ' -f4) bytes"
echo "=========================================="

# Cleanup
rm -rf "${BUILD_DIR}"
rm -f "${ZIP_FILE}"
rm -f /tmp/lambda-deploy-output.json

echo ""
echo "🎉 Deployment complete!"
