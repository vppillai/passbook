#!/bin/bash

# Passbook Backend Deployment Script
# Usage: ./deploy.sh [environment] [region]
# Example: ./deploy.sh development us-west-2

set -e

ENVIRONMENT=${1:-development}
REGION=${2:-us-west-2}
STACK_NAME="passbook-${ENVIRONMENT}"

echo "Deploying Passbook backend to ${ENVIRONMENT} in ${REGION}..."

# Validate CloudFormation templates
echo "Validating CloudFormation templates..."
aws cloudformation validate-template \
  --template-body file://infrastructure/database.yaml \
  --region ${REGION} > /dev/null || { echo "Database template validation failed"; exit 1; }

aws cloudformation validate-template \
  --template-body file://infrastructure/api.yaml \
  --region ${REGION} > /dev/null || { echo "API template validation failed"; exit 1; }

aws cloudformation validate-template \
  --template-body file://infrastructure/auth.yaml \
  --region ${REGION} > /dev/null || { echo "Auth template validation failed"; exit 1; }

aws cloudformation validate-template \
  --template-body file://infrastructure/main.yaml \
  --region ${REGION} > /dev/null || { echo "Main template validation failed"; exit 1; }

echo "All templates validated successfully."

# Check if stack exists
if aws cloudformation describe-stacks --stack-name ${STACK_NAME} --region ${REGION} > /dev/null 2>&1; then
  echo "Stack ${STACK_NAME} exists. Updating..."
  OPERATION="update-stack"
  WAIT_OPERATION="stack-update-complete"
else
  echo "Stack ${STACK_NAME} does not exist. Creating..."
  OPERATION="create-stack"
  WAIT_OPERATION="stack-create-complete"
fi

# Prepare parameters
PARAMETERS="ParameterKey=Environment,ParameterValue=${ENVIRONMENT}"
PARAMETERS="${PARAMETERS} ParameterKey=Region,ParameterValue=${REGION}"

# Prompt for SMTP credentials if not in environment
if [ -z "$SMTP_USER" ]; then
  read -p "Enter SMTP username (email): " SMTP_USER
fi
if [ -z "$SMTP_PASSWORD" ]; then
  read -sp "Enter SMTP password: " SMTP_PASSWORD
  echo
fi
if [ -z "$SMTP_FROM" ]; then
  SMTP_FROM="support@embeddedinn.com"
fi

PARAMETERS="${PARAMETERS} ParameterKey=SMTPUser,ParameterValue=${SMTP_USER}"
PARAMETERS="${PARAMETERS} ParameterKey=SMTPPassword,ParameterValue=${SMTP_PASSWORD}"
PARAMETERS="${PARAMETERS} ParameterKey=SMTPFrom,ParameterValue=${SMTP_FROM}"

# Deploy stack
echo "Deploying CloudFormation stack..."
aws cloudformation ${OPERATION} \
  --stack-name ${STACK_NAME} \
  --template-body file://infrastructure/main.yaml \
  --parameters ${PARAMETERS} \
  --capabilities CAPABILITY_NAMED_IAM \
  --region ${REGION} \
  --tags Key=Project,Value=passbook Key=Environment,Value=${ENVIRONMENT} \
  > /dev/null || { echo "Stack ${OPERATION} failed"; exit 1; }

echo "Waiting for stack ${WAIT_OPERATION}..."
aws cloudformation wait ${WAIT_OPERATION} \
  --stack-name ${STACK_NAME} \
  --region ${REGION} || { echo "Stack deployment failed"; exit 1; }

# Get stack outputs
echo "Deployment complete! Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --query 'Stacks[0].Outputs' \
  --output table

echo ""
echo "✅ Backend deployment successful!"
echo "Stack: ${STACK_NAME}"
echo "Region: ${REGION}"
