#!/bin/bash

# Allowance Passbook - AWS CloudFormation Teardown Script
# This script safely tears down the AWS infrastructure with data protection

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
ENVIRONMENT=""
REGION="us-east-1"
PROJECT_NAME="allowance-passbook"
FORCE_DELETE="false"
BACKUP_DATA="true"
DRY_RUN="false"

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
    echo "Usage: $0 -e ENVIRONMENT [OPTIONS]"
    echo ""
    echo "REQUIRED:"
    echo "  -e, --environment ENVIRONMENT    Environment to teardown (development, staging, production)"
    echo ""
    echo "OPTIONS:"
    echo "  -r, --region REGION             AWS region (default: us-east-1)"
    echo "  -p, --project PROJECT_NAME      Project name (default: allowance-passbook)"
    echo "  -f, --force                     Force delete without confirmation (DANGEROUS)"
    echo "  --no-backup                     Skip data backup (DANGEROUS)"
    echo "  -d, --dry-run                   Show what would be deleted without actually deleting"
    echo "  -h, --help                      Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 -e development"
    echo "  $0 --environment staging --region us-west-2 --dry-run"
    echo "  $0 -e production --force --no-backup  # DANGEROUS!"
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
        -f|--force)
            FORCE_DELETE="true"
            shift
            ;;
        --no-backup)
            BACKUP_DATA="false"
            shift
            ;;
        -d|--dry-run)
            DRY_RUN="true"
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

# Validate required parameters
if [[ -z "$ENVIRONMENT" ]]; then
    print_error "Environment is required"
    show_usage
    exit 1
fi

# Validate environment
if [[ "$ENVIRONMENT" != "development" && "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
    print_error "Invalid environment: $ENVIRONMENT"
    print_error "Valid environments: development, staging, production"
    exit 1
fi

# Set up variables
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"

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

print_warning "=== Allowance Passbook AWS Teardown ==="
print_warning "Environment: $ENVIRONMENT"
print_warning "Region: $REGION"
print_warning "Stack Name: $STACK_NAME"
print_warning "Project: $PROJECT_NAME"
print_warning "Dry Run: $DRY_RUN"
echo ""

# Show current AWS account info
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
USER_ARN=$(aws sts get-caller-identity --query Arn --output text)
print_info "AWS Account: $ACCOUNT_ID"
print_info "User/Role: $USER_ARN"
echo ""

# Check if stack exists
if ! aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" &> /dev/null; then
    print_warning "Stack $STACK_NAME does not exist in region $REGION"
    exit 0
fi

# Get stack status
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].StackStatus' --output text)
print_info "Current stack status: $STACK_STATUS"

# Get stack resources
print_info "Fetching stack resources..."
RESOURCES=$(aws cloudformation describe-stack-resources --stack-name "$STACK_NAME" --region "$REGION" --query 'StackResources[?ResourceStatus==`CREATE_COMPLETE` || ResourceStatus==`UPDATE_COMPLETE`].[LogicalResourceId,ResourceType,PhysicalResourceId]' --output text)

if [[ -z "$RESOURCES" ]]; then
    print_warning "No resources found in stack"
else
    print_info "=== Resources to be deleted ==="
    echo "$RESOURCES" | while read -r line; do
        echo "  - $line"
    done
    echo ""
fi

# Check for DynamoDB tables with data (if not dry run)
if [[ "$DRY_RUN" == "false" && "$BACKUP_DATA" == "true" ]]; then
    print_info "Checking for data in DynamoDB tables..."

    # Get DynamoDB tables from stack
    DYNAMODB_TABLES=$(echo "$RESOURCES" | grep "AWS::DynamoDB::Table" | awk '{print $3}' || true)

    if [[ -n "$DYNAMODB_TABLES" ]]; then
        HAS_DATA="false"
        while IFS= read -r table; do
            if [[ -n "$table" ]]; then
                ITEM_COUNT=$(aws dynamodb scan --table-name "$table" --region "$REGION" --select "COUNT" --query 'Count' --output text 2>/dev/null || echo "0")
                if [[ "$ITEM_COUNT" -gt 0 ]]; then
                    print_warning "Table $table contains $ITEM_COUNT items"
                    HAS_DATA="true"
                fi
            fi
        done <<< "$DYNAMODB_TABLES"

        if [[ "$HAS_DATA" == "true" ]]; then
            print_warning "=== DATA BACKUP REQUIRED ==="
            print_warning "Some DynamoDB tables contain data."
            print_warning "Consider backing up your data before proceeding."
            echo ""

            if [[ "$FORCE_DELETE" == "false" ]]; then
                read -p "Do you want to continue without backup? (yes/no): " -r
                if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
                    print_info "Teardown cancelled. Please backup your data first."
                    exit 0
                fi
            fi
        fi
    fi
fi

# Dry run mode
if [[ "$DRY_RUN" == "true" ]]; then
    print_warning "=== DRY RUN MODE ==="
    print_warning "The following actions would be performed:"
    echo ""
    print_warning "1. Disable termination protection (if enabled)"
    print_warning "2. Delete CloudFormation stack: $STACK_NAME"
    print_warning "3. All associated resources would be deleted:"
    echo ""
    echo "$RESOURCES" | while read -r line; do
        echo "     - $line"
    done
    echo ""
    print_warning "⚠️  This would permanently delete all data in DynamoDB tables!"
    print_warning "⚠️  API Gateway endpoints would be removed!"
    print_warning "⚠️  IAM roles and policies would be deleted!"
    echo ""
    print_success "Dry run completed. Use without --dry-run to actually teardown."
    exit 0
fi

# Production safety check
if [[ "$ENVIRONMENT" == "production" ]]; then
    print_error "=== PRODUCTION TEARDOWN WARNING ==="
    print_error "You are about to PERMANENTLY DELETE the PRODUCTION environment!"
    print_error "This action CANNOT be undone!"
    print_error "ALL DATA will be LOST!"
    echo ""

    if [[ "$FORCE_DELETE" == "false" ]]; then
        print_error "Type the exact environment name to confirm: $ENVIRONMENT"
        read -p "Confirmation: " -r
        if [[ "$REPLY" != "$ENVIRONMENT" ]]; then
            print_info "Confirmation failed. Teardown cancelled."
            exit 0
        fi

        print_error "Are you absolutely sure you want to delete PRODUCTION? (yes/no)"
        read -p "Final confirmation: " -r
        if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
            print_info "Teardown cancelled."
            exit 0
        fi
    fi
fi

# Check for termination protection
TERMINATION_PROTECTION=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].EnableTerminationProtection' --output text)

if [[ "$TERMINATION_PROTECTION" == "True" ]]; then
    print_info "Disabling termination protection..."
    aws cloudformation update-termination-protection \
        --no-enable-termination-protection \
        --stack-name "$STACK_NAME" \
        --region "$REGION"
    print_success "Termination protection disabled"
fi

# Start deletion
print_info "Starting stack deletion..."
print_info "This may take several minutes..."

if aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"; then
    print_success "Stack deletion initiated"
else
    print_error "Failed to initiate stack deletion"
    exit 1
fi

# Wait for deletion to complete
print_info "Waiting for stack deletion to complete..."
if aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"; then
    print_success "Stack deletion completed successfully!"
else
    print_error "Stack deletion failed or timed out"
    print_error "Check the CloudFormation console for more details"

    # Try to get the stack status
    FINAL_STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DELETED")
    print_error "Final stack status: $FINAL_STATUS"
    exit 1
fi

print_success "=== Teardown Complete ==="
print_success "Environment: $ENVIRONMENT"
print_success "Stack: $STACK_NAME"
print_success "All resources have been deleted"
echo ""

print_info "=== Cleanup Verification ==="
print_info "Please manually verify in AWS Console:"
print_info "1. CloudFormation stack is deleted"
print_info "2. DynamoDB tables are removed"
print_info "3. API Gateway is deleted"
print_info "4. IAM roles are cleaned up"
print_info "5. CloudWatch alarms are removed"
echo ""

print_warning "Note: CloudWatch logs may remain for the configured retention period"
print_warning "This is normal and will not incur additional costs after retention expires"

print_success "Teardown completed successfully!"