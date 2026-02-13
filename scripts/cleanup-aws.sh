#!/bin/bash
# Cleanup script to remove all AWS backend resources for passbook
# Use this to completely remove the backend or before rehoming to another account

set -e

REGION="us-west-2"
MAIN_STACK="passbook-prod"
BOOTSTRAP_STACK="passbook-bootstrap"
TABLE_NAME="passbook-prod"
LOG_GROUP="/aws/lambda/passbook-api-prod"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║     Passbook AWS Cleanup                           ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════════╝${NC}"
echo

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI not found. Please install it first.${NC}"
    exit 1
fi

# Verify AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured. Run 'aws configure' first.${NC}"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
# S3 bucket name matches bootstrap.yaml: passbook-lambda-{account}-{region}
BUCKET_NAME="passbook-lambda-${ACCOUNT_ID}-${REGION}"

echo -e "AWS Account: ${GREEN}${ACCOUNT_ID}${NC}"
echo -e "Region: ${GREEN}${REGION}${NC}"
echo
echo "This will delete:"
echo "  - CloudFormation stack: ${MAIN_STACK}"
echo "  - CloudFormation stack: ${BOOTSTRAP_STACK}"
echo "  - DynamoDB table: ${TABLE_NAME} (retained by CloudFormation)"
echo "  - S3 bucket: ${BUCKET_NAME}"
echo "  - CloudWatch logs: ${LOG_GROUP}"
echo
echo -e "${RED}WARNING: This action is irreversible!${NC}"
echo

# Offer to export data first
read -p "Do you want to export data before deleting? (y/N): " export_first
if [[ "$export_first" =~ ^[Yy]$ ]]; then
    BACKUP_FILE="passbook-backup-$(date +%Y%m%d-%H%M%S).json"
    echo "Exporting data to ${BACKUP_FILE}..."
    if ./scripts/add-data.sh export "$BACKUP_FILE" 2>/dev/null; then
        echo -e "${GREEN}Data exported to ${BACKUP_FILE}${NC}"
    else
        echo -e "${YELLOW}Warning: Could not export data (table may not exist)${NC}"
    fi
    echo
fi

read -p "Are you sure you want to delete all AWS resources? (yes/no): " confirm
if [[ "$confirm" != "yes" ]]; then
    echo "Aborted."
    exit 0
fi

echo
echo "Starting cleanup..."
echo

# Step 1: Delete main stack (Note: DynamoDB table is retained due to DeletionPolicy)
echo -e "${YELLOW}[1/6] Deleting main stack (${MAIN_STACK})...${NC}"
if aws cloudformation describe-stacks --stack-name "$MAIN_STACK" --region "$REGION" &> /dev/null; then
    aws cloudformation delete-stack --stack-name "$MAIN_STACK" --region "$REGION"
    echo "Waiting for stack deletion..."
    aws cloudformation wait stack-delete-complete --stack-name "$MAIN_STACK" --region "$REGION"
    echo -e "${GREEN}Main stack deleted.${NC}"
else
    echo "Stack not found, skipping."
fi

# Step 2: Delete DynamoDB table (retained by CloudFormation due to DeletionPolicy: Retain)
echo -e "${YELLOW}[2/6] Deleting DynamoDB table (${TABLE_NAME})...${NC}"
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" &> /dev/null; then
    aws dynamodb delete-table --table-name "$TABLE_NAME" --region "$REGION" > /dev/null
    echo "Waiting for table deletion..."
    aws dynamodb wait table-not-exists --table-name "$TABLE_NAME" --region "$REGION"
    echo -e "${GREEN}DynamoDB table deleted.${NC}"
else
    echo "Table not found, skipping."
fi

# Step 3: Empty S3 bucket (including versioned objects)
echo -e "${YELLOW}[3/6] Emptying S3 bucket (${BUCKET_NAME})...${NC}"
if aws s3api head-bucket --bucket "$BUCKET_NAME" &> /dev/null; then
    # Delete all object versions (bucket has versioning enabled)
    echo "Deleting all object versions..."
    aws s3api list-object-versions --bucket "$BUCKET_NAME" --output json 2>/dev/null | \
        jq -r '.Versions[]? | "--key \"\(.Key)\" --version-id \(.VersionId)"' | \
        while read -r line; do
            if [ -n "$line" ]; then
                eval "aws s3api delete-object --bucket \"$BUCKET_NAME\" $line" 2>/dev/null || true
            fi
        done
    # Delete all delete markers
    aws s3api list-object-versions --bucket "$BUCKET_NAME" --output json 2>/dev/null | \
        jq -r '.DeleteMarkers[]? | "--key \"\(.Key)\" --version-id \(.VersionId)"' | \
        while read -r line; do
            if [ -n "$line" ]; then
                eval "aws s3api delete-object --bucket \"$BUCKET_NAME\" $line" 2>/dev/null || true
            fi
        done
    echo -e "${GREEN}Bucket emptied.${NC}"
else
    echo "Bucket not found, skipping."
fi

# Step 4: Delete S3 bucket
echo -e "${YELLOW}[4/6] Deleting S3 bucket...${NC}"
if aws s3api head-bucket --bucket "$BUCKET_NAME" &> /dev/null; then
    aws s3 rb "s3://${BUCKET_NAME}"
    echo -e "${GREEN}Bucket deleted.${NC}"
else
    echo "Bucket not found, skipping."
fi

# Step 5: Delete CloudWatch logs
echo -e "${YELLOW}[5/6] Deleting CloudWatch log group...${NC}"
if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" \
    --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" --output text 2>/dev/null | grep -q "$LOG_GROUP"; then
    aws logs delete-log-group --log-group-name "$LOG_GROUP" --region "$REGION"
    echo -e "${GREEN}Log group deleted.${NC}"
else
    echo "Log group not found, skipping."
fi

# Step 6: Delete bootstrap stack
echo -e "${YELLOW}[6/6] Deleting bootstrap stack (${BOOTSTRAP_STACK})...${NC}"
if aws cloudformation describe-stacks --stack-name "$BOOTSTRAP_STACK" --region "$REGION" &> /dev/null; then
    aws cloudformation delete-stack --stack-name "$BOOTSTRAP_STACK" --region "$REGION"
    echo "Waiting for stack deletion..."
    aws cloudformation wait stack-delete-complete --stack-name "$BOOTSTRAP_STACK" --region "$REGION"
    echo -e "${GREEN}Bootstrap stack deleted.${NC}"
else
    echo "Stack not found, skipping."
fi

echo
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Cleanup Complete!                              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo
echo "All passbook AWS resources have been deleted."
echo
echo "To rehome to another account:"
echo "  1. Configure AWS CLI for new account: aws configure"
echo "  2. Deploy bootstrap: aws cloudformation deploy --template-file infrastructure/bootstrap.yaml --stack-name passbook-bootstrap --capabilities CAPABILITY_NAMED_IAM --region us-west-2"
echo "  3. Update GitHub secret AWS_ACCOUNT_ID"
echo "  4. Push to trigger deployment"
if [[ -n "$BACKUP_FILE" ]]; then
    echo "  5. Import data: ./scripts/add-data.sh import ${BACKUP_FILE}"
fi
