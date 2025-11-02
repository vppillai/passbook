#!/bin/bash

# Allowance Passbook - AWS CloudFormation Deployment Script
# This script deploys the AWS infrastructure using CloudFormation with proper tagging and cost controls

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT="development"
REGION="us-east-1"
PROJECT_NAME="allowance-passbook"
DRY_RUN="false"
WAIT_FOR_COMPLETION="true"

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

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "OPTIONS:"
    echo "  -e, --environment ENVIRONMENT    Deployment environment (development, staging, production)"
    echo "  -r, --region REGION             AWS region (default: us-east-1)"
    echo "  -p, --project PROJECT_NAME      Project name (default: allowance-passbook)"
    echo "  -d, --dry-run                   Show what would be deployed without actually deploying"
    echo "  -n, --no-wait                   Don't wait for stack completion"
    echo "  -h, --help                      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -e development -r us-west-2"
    echo "  $0 --environment production --region eu-west-1 --dry-run"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--environment)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -r|--region)
            REGION="$2"
            shift 2
            ;;
        -p|--project)
            PROJECT_NAME="$2"
            shift 2
            ;;
        -d|--dry-run)
            DRY_RUN="true"
            shift
            ;;
        -n|--no-wait)
            WAIT_FOR_COMPLETION="false"
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            print_error "Unknown option $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate environment
if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    print_error "Invalid environment: $ENVIRONMENT"
    print_error "Valid environments: development, staging, production"
    exit 1
fi

# Set up variables
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"
TEMPLATE_FILE="../cloudformation/templates/main-template.yaml"
PARAMETER_FILE="../cloudformation/parameters/${ENVIRONMENT}.json"

# Check if required files exist
if [[ ! -f "$TEMPLATE_FILE" ]]; then
    print_error "CloudFormation template not found: $TEMPLATE_FILE"
    exit 1
fi

if [[ ! -f "$PARAMETER_FILE" ]]; then
    print_error "Parameter file not found: $PARAMETER_FILE"
    exit 1
fi

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI not found. Please install AWS CLI and configure your credentials."
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_error "AWS credentials not configured. Please run 'aws configure' or set environment variables."
    exit 1
fi

print_info "=== Allowance Passbook AWS Deployment ==="
print_info "Environment: $ENVIRONMENT"
print_info "Region: $REGION"
print_info "Stack Name: $STACK_NAME"
print_info "Project: $PROJECT_NAME"
print_info "Dry Run: $DRY_RUN"
echo ""

# Show current AWS account info
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
print_info "AWS Account: $ACCOUNT_ID"
print_info "User/Role: $USER_ARN"
echo ""

# Validate CloudFormation template
print_info "Validating CloudFormation template..."
if aws cloudformation validate-template --template-body file://"$TEMPLATE_FILE" --region "$REGION" > /dev/null; then
    print_success "CloudFormation template is valid"
else
    print_error "CloudFormation template validation failed"
    exit 1
fi

# Check if stack exists
STACK_EXISTS="false"
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &> /dev/null; then
    STACK_EXISTS="true"
    print_info "Stack $STACK_NAME already exists - will update"
else
    print_info "Stack $STACK_NAME does not exist - will create"
fi

# Show estimated costs (if dry run or production)
if [[ "$DRY_RUN" == "true" || "$ENVIRONMENT" == "production" ]]; then
    print_warning "=== COST ESTIMATION ==="
    print_warning "This deployment creates pay-per-use resources only:"
    print_warning "- DynamoDB: Pay per read/write (Free tier: 25 GB storage, 25 read/write capacity units)"
    print_warning "- Lambda: Pay per request (Free tier: 1M requests/month)"
    print_warning "- API Gateway: Pay per request (Free tier: 1M requests/month)"
    print_warning "- CloudWatch: Pay per log ingestion (Free tier: 5 GB/month)"
    print_warning ""
    print_warning "Expected monthly cost for typical usage: $0 - $5"
    print_warning "Cost controls are built-in with daily limits and billing alarms"
    echo ""
fi

# Production warning
if [[ "$ENVIRONMENT" == "production" && "$DRY_RUN" == "false" ]]; then
    print_warning "=== PRODUCTION DEPLOYMENT WARNING ==="
    print_warning "You are about to deploy to PRODUCTION environment"
    print_warning "This will create resources that may incur costs"
    print_warning "Billing alarms are set at \$1 and \$5"
    echo ""
    read -p "Are you sure you want to proceed? (yes/no): " -r
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        print_info "Deployment cancelled"
        exit 0
    fi
fi

# Dry run - show what would be deployed
if [[ "$DRY_RUN" == "true" ]]; then
    print_info "=== DRY RUN MODE ==="
    print_info "The following resources would be created/updated:"
    echo ""
    print_info "DynamoDB Tables:"
    echo "  - ${PROJECT_NAME}-${ENVIRONMENT}-parent-accounts"
    echo "  - ${PROJECT_NAME}-${ENVIRONMENT}-child-accounts"
    echo "  - ${PROJECT_NAME}-${ENVIRONMENT}-expenses"
    echo "  - ${PROJECT_NAME}-${ENVIRONMENT}-fund-additions"
    echo "  - ${PROJECT_NAME}-${ENVIRONMENT}-accounting-periods"
    echo ""
    print_info "IAM Roles:"
    echo "  - ${PROJECT_NAME}-${ENVIRONMENT}-lambda-role"
    echo ""
    print_info "API Gateway:"
    echo "  - ${PROJECT_NAME}-${ENVIRONMENT}-api"
    echo "  - Usage plan with cost controls"
    echo ""
    print_info "CloudWatch:"
    echo "  - Billing alarms at \$1 and \$5"
    echo "  - High error rate alarm"
    if [[ "$ENVIRONMENT" != "development" ]]; then
        echo "  - Monitoring dashboard"
    fi
    echo ""
    print_info "Tags applied to all resources:"
    echo "  - Project: $PROJECT_NAME"
    echo "  - Environment: $ENVIRONMENT"
    echo "  - ManagedBy: CloudFormation"
    echo "  - Owner: (from parameter file)"
    echo "  - CostCenter: (from parameter file)"
    echo ""
    print_success "Dry run completed. Use without --dry-run to actually deploy."
    exit 0
fi

# Perform deployment
print_info "Starting deployment..."

# Build CloudFormation command
CF_COMMAND="aws cloudformation"
if [[ "$STACK_EXISTS" == "true" ]]; then
    CF_OPERATION="update-stack"
    print_info "Updating existing stack..."
else
    CF_OPERATION="create-stack"
    print_info "Creating new stack..."
fi

# Additional parameters for create-stack
CREATE_STACK_PARAMS=""
if [[ "$STACK_EXISTS" == "false" ]]; then
    CREATE_STACK_PARAMS="--enable-termination-protection"
    if [[ "$ENVIRONMENT" == "production" ]]; then
        CREATE_STACK_PARAMS="$CREATE_STACK_PARAMS --enable-termination-protection"
    fi
fi

# Execute CloudFormation deployment
DEPLOYMENT_CMD="$CF_COMMAND $CF_OPERATION \
    --stack-name $STACK_NAME \
    --template-body file://$TEMPLATE_FILE \
    --parameters file://$PARAMETER_FILE \
    --capabilities CAPABILITY_NAMED_IAM \
    --region $REGION \
    --tags Key=DeployedBy,Value=$(whoami) Key=DeploymentDate,Value=$(date -u +%Y-%m-%dT%H:%M:%SZ) \
    $CREATE_STACK_PARAMS"

print_info "Executing: $DEPLOYMENT_CMD"
echo ""

if eval $DEPLOYMENT_CMD; then
    print_success "CloudFormation operation initiated successfully"
else
    print_error "CloudFormation operation failed"
    exit 1
fi

# Wait for completion if requested
if [[ "$WAIT_FOR_COMPLETION" == "true" ]]; then
    print_info "Waiting for stack operation to complete..."
    print_info "This may take several minutes..."

    if [[ "$STACK_EXISTS" == "true" ]]; then
        WAIT_CONDITION="stack-update-complete"
    else
        WAIT_CONDITION="stack-create-complete"
    fi

    if aws cloudformation wait $WAIT_CONDITION --stack-name "$STACK_NAME" --region "$REGION"; then
        print_success "Stack operation completed successfully!"
    else
        print_error "Stack operation failed or timed out"
        print_error "Check the CloudFormation console for more details"
        exit 1
    fi
fi

# Show stack outputs
print_info "=== Stack Outputs ==="
aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query 'Stacks[0].Outputs' \
    --output table

echo ""
print_success "=== Deployment Summary ==="
print_success "Stack Name: $STACK_NAME"
print_success "Environment: $ENVIRONMENT"
print_success "Region: $REGION"
print_success "Status: $(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].StackStatus' --output text)"

# Show next steps
echo ""
print_info "=== Next Steps ==="
print_info "1. Verify the deployment in AWS CloudFormation console"
print_info "2. Check CloudWatch for billing alarms"
print_info "3. Deploy Lambda functions using SAM or Serverless Framework"
print_info "4. Test API endpoints"
print_info "5. Monitor costs in AWS Billing dashboard"

# Show important URLs
echo ""
print_info "=== Important Links ==="
print_info "CloudFormation Console: https://console.aws.amazon.com/cloudformation/home?region=$REGION#/stacks/stackinfo?stackId=$STACK_NAME"
print_info "Billing Dashboard: https://console.aws.amazon.com/billing/home#/"
print_info "CloudWatch Alarms: https://console.aws.amazon.com/cloudwatch/home?region=$REGION#alarmsV2:"

print_success "Deployment completed successfully!"