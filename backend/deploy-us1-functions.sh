#!/bin/bash

# Deploy all User Story 1 Lambda functions
# Usage: ./deploy-us1-functions.sh [environment] [region]
# Example: ./deploy-us1-functions.sh development us-west-2

set -e

ENVIRONMENT=${1:-development}
REGION=${2:-us-west-2}

echo "=========================================="
echo "Deploying User Story 1 Lambda Functions"
echo "Environment: ${ENVIRONMENT}"
echo "Region: ${REGION}"
echo "=========================================="
echo ""

# User Story 1 Lambda functions
FUNCTIONS=(
  "auth/signup_handler"
  "auth/verify_email_handler"
  "auth/login_handler"
  "accounts/create_family_handler"
)

SUCCESS_COUNT=0
FAILED_COUNT=0
FAILED_FUNCTIONS=()

for FUNCTION_PATH in "${FUNCTIONS[@]}"; do
  echo "Deploying: ${FUNCTION_PATH}"
  echo "----------------------------------------"

  if ./deploy-function.sh "${FUNCTION_PATH}" "${ENVIRONMENT}" "${REGION}"; then
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    echo "✅ ${FUNCTION_PATH} deployed successfully"
  else
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILED_FUNCTIONS+=("${FUNCTION_PATH}")
    echo "❌ ${FUNCTION_PATH} deployment failed"
  fi

  echo ""
done

echo "=========================================="
echo "Deployment Summary"
echo "=========================================="
echo "Total functions: ${#FUNCTIONS[@]}"
echo "Successful: ${SUCCESS_COUNT}"
echo "Failed: ${FAILED_COUNT}"
echo ""

if [ ${FAILED_COUNT} -gt 0 ]; then
  echo "Failed functions:"
  for FUNC in "${FAILED_FUNCTIONS[@]}"; do
    echo "  - ${FUNC}"
  done
  echo ""
  exit 1
else
  echo "🎉 All User Story 1 functions deployed successfully!"
  exit 0
fi
