#!/bin/bash
# Bootstrap script for Kids Passbook App
# Run this once to set up the AWS infrastructure

set -e

REGION="us-west-2"
STACK_NAME="passbook-bootstrap"

echo "Deploying bootstrap stack to AWS..."

aws cloudformation deploy \
  --template-file infrastructure/bootstrap.yaml \
  --stack-name "$STACK_NAME" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$REGION"

echo ""
echo "Bootstrap complete!"
echo ""

# Get outputs
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='LambdaDeploymentBucketName'].OutputValue" \
  --output text)

ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='GitHubActionsRoleArn'].OutputValue" \
  --output text)

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "=== Next Steps ==="
echo ""
echo "1. Add the following secret to your GitHub repository:"
echo "   Secret name: AWS_ACCOUNT_ID"
echo "   Value: $ACCOUNT_ID"
echo ""
echo "2. Enable GitHub Pages in repository Settings > Pages"
echo "   Set Source to 'GitHub Actions'"
echo ""
echo "3. Push your code to the main branch to trigger deployment"
echo ""
echo "=== AWS Resources Created ==="
echo "S3 Bucket: $BUCKET"
echo "GitHub Actions Role: $ROLE_ARN"
