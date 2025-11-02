#!/bin/bash

# Allowance Passbook - AWS Setup Script
# This script validates prerequisites and prepares for deployment

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_info "=== Allowance Passbook AWS Setup ==="
echo ""

# Check if we're in the right directory
if [[ ! -f "../cloudformation/templates/main-template.yaml" ]]; then
    print_error "Please run this script from the aws/scripts directory"
    exit 1
fi

# Check AWS CLI
print_info "Checking AWS CLI..."
if command -v aws &> /dev/null; then
    AWS_VERSION=$(aws --version 2>&1 | cut -d/ -f2 | cut -d' ' -f1)
    print_success "AWS CLI found: $AWS_VERSION"
else
    print_error "AWS CLI not found"
    print_error "Please install AWS CLI: https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
print_info "Checking AWS credentials..."
if aws sts get-caller-identity &> /dev/null; then
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
    print_success "AWS credentials configured"
    print_info "Account ID: $ACCOUNT_ID"
    print_info "User/Role: $USER_ARN"
else
    print_error "AWS credentials not configured"
    print_error "Please run: aws configure"
    print_error "Or set environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
    exit 1
fi

# Check required permissions
print_info "Checking AWS permissions..."
PERMISSIONS_OK=true

# Test CloudFormation permissions
if aws cloudformation list-stacks --region us-east-1 &> /dev/null; then
    print_success "CloudFormation permissions: OK"
else
    print_error "CloudFormation permissions: MISSING"
    PERMISSIONS_OK=false
fi

# Test IAM permissions
if aws iam list-roles --max-items 1 &> /dev/null; then
    print_success "IAM permissions: OK"
else
    print_error "IAM permissions: MISSING"
    PERMISSIONS_OK=false
fi

# Test DynamoDB permissions
if aws dynamodb list-tables --region us-east-1 &> /dev/null; then
    print_success "DynamoDB permissions: OK"
else
    print_error "DynamoDB permissions: MISSING"
    PERMISSIONS_OK=false
fi

if [[ "$PERMISSIONS_OK" == "false" ]]; then
    print_error "Missing required AWS permissions"
    print_error "Please ensure your AWS user/role has the following policies:"
    print_error "- CloudFormationFullAccess"
    print_error "- IAMFullAccess"
    print_error "- AmazonDynamoDBFullAccess"
    print_error "- AmazonAPIGatewayAdministrator"
    print_error "- AWSLambda_FullAccess"
    print_error "- CloudWatchFullAccess"
    exit 1
fi

# Validate CloudFormation template
print_info "Validating CloudFormation template..."
if aws cloudformation validate-template --template-body file://../cloudformation/templates/main-template.yaml --region us-east-1 > /dev/null; then
    print_success "CloudFormation template is valid"
else
    print_error "CloudFormation template validation failed"
    exit 1
fi

# Check parameter files
print_info "Checking parameter files..."
for env in development staging production; do
    if [[ -f "../cloudformation/parameters/${env}.json" ]]; then
        if python3 -m json.tool "../cloudformation/parameters/${env}.json" > /dev/null 2>&1; then
            print_success "Parameter file for $env: Valid JSON"
        else
            print_error "Parameter file for $env: Invalid JSON"
            exit 1
        fi
    else
        print_error "Parameter file for $env: Not found"
        exit 1
    fi
done

# Check region selection
DEFAULT_REGION=$(aws configure get region 2>/dev/null || echo "us-east-1")
print_info "Default AWS region: $DEFAULT_REGION"

# Check billing alerts (if possible)
print_info "Checking billing configuration..."
if aws cloudwatch describe-alarms --region us-east-1 --alarm-names "billing-alert" &> /dev/null; then
    print_info "Existing billing alerts found"
else
    print_warning "No existing billing alerts found"
    print_warning "The deployment will create billing alerts at \$1 and \$5"
fi

# Check for existing stacks
print_info "Checking for existing stacks..."
for env in development staging production; do
    STACK_NAME="allowance-passbook-${env}"
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$DEFAULT_REGION" &> /dev/null; then
        STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$DEFAULT_REGION" --query 'Stacks[0].StackStatus' --output text)
        print_warning "Stack $STACK_NAME already exists with status: $STACK_STATUS"
    fi
done

echo ""
print_success "=== Setup Complete ==="
print_success "Your environment is ready for Allowance Passbook deployment!"
echo ""

print_info "Next steps:"
print_info "1. Deploy development environment:"
print_info "   ./deploy.sh -e development -r $DEFAULT_REGION"
echo ""
print_info "2. Test the deployment:"
print_info "   Check AWS Console > CloudFormation"
echo ""
print_info "3. Deploy other environments as needed:"
print_info "   ./deploy.sh -e staging -r $DEFAULT_REGION"
print_info "   ./deploy.sh -e production -r $DEFAULT_REGION"
echo ""

print_warning "Important reminders:"
print_warning "- This creates pay-per-use resources (typically $0-5/month)"
print_warning "- Billing alarms are set at \$1 and \$5"
print_warning "- Use teardown.sh to remove resources when done"
print_warning "- Monitor costs in AWS Billing dashboard"

print_success "Setup completed successfully!"