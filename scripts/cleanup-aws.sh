#!/bin/bash
# Cleanup script to remove one instance's AWS resources for passbook
# Use with --instance <name> to delete that instance's stack, table, and logs
# Shared resources (bootstrap stack, S3 bucket, OIDC provider) are NOT touched

set -euo pipefail

REGION="us-west-2"
INSTANCE=""
DRY_RUN=false
SKIP_EXPORT=false

usage() {
    echo "Usage: $0 --instance <name> [--region <r>] [--dry-run] [--skip-export]"
    echo ""
    echo "Deletes one instance's CloudFormation stack, DynamoDB table, and log group."
    echo "Does NOT touch the shared bootstrap stack or S3 deployment bucket."
    echo "See README.md for full-system teardown."
    echo ""
    echo "Options:"
    echo "  -i, --instance <name>  Instance name (required)"
    echo "  --region <region>      AWS region (default: us-west-2)"
    echo "  --dry-run              Show what would be deleted; make no changes"
    echo "  --skip-export          Do not export data before deleting (DANGEROUS)"
    echo ""
    echo "Example: $0 --instance kids"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--instance) INSTANCE="${2:?--instance requires a value}"; shift 2 ;;
        --region) REGION="${2:?--region requires a value}"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --skip-export) SKIP_EXPORT=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Error: unknown option '$1'" >&2; usage >&2; exit 1 ;;
    esac
done

if [[ -z "$INSTANCE" ]]; then
    echo "Error: --instance <name> required (e.g., --instance kids)" >&2
    exit 1
fi

MAIN_STACK="passbook-${INSTANCE}-prod"
TABLE_NAME="passbook-${INSTANCE}-prod"
LOG_GROUP="/aws/lambda/passbook-api-${INSTANCE}-prod"
BACKUP_FILE=""

# Resolve add-data.sh relative to THIS script's directory so the export
# works regardless of the caller's working directory.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ADD_DATA="$SCRIPT_DIR/add-data.sh"

# run CMD... — execute, or print under --dry-run.
run() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] $*"
    else
        "$@"
    fi
}

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

echo -e "AWS Account: ${GREEN}${ACCOUNT_ID}${NC}"
echo -e "Region: ${GREEN}${REGION}${NC}"
echo -e "Instance: ${GREEN}${INSTANCE}${NC}"
echo
echo "This will delete for instance '${INSTANCE}':"
echo "  - CloudFormation stack: ${MAIN_STACK}"
echo "  - DynamoDB table: ${TABLE_NAME} (retained by CloudFormation)"
echo "  - CloudWatch logs: ${LOG_GROUP}"
echo
echo -e "${RED}WARNING: This action is irreversible!${NC}"
echo
[[ "$DRY_RUN" == "true" ]] && echo -e "${YELLOW}Mode: DRY RUN (no changes will be made)${NC}" && echo

# Export data before deleting. Unlike before, the export is MANDATORY by
# default and its failure ABORTS the deletion — a relative path / missing
# --region / swallowed stderr previously let the export fail silently and
# the table get deleted anyway. Pass --skip-export to opt out explicitly.
if [[ "$SKIP_EXPORT" == "true" ]]; then
    echo -e "${YELLOW}--skip-export set: NOT exporting data before deletion.${NC}"
    echo
elif [[ "$DRY_RUN" == "true" ]]; then
    echo "[DRY-RUN] would export data via $ADD_DATA before deleting."
    echo
else
    if [[ ! -x "$ADD_DATA" ]]; then
        echo -e "${RED}Error: add-data.sh not found or not executable at $ADD_DATA${NC}" >&2
        echo -e "${RED}Cannot export before deletion. Re-run with --skip-export to bypass (DANGEROUS).${NC}" >&2
        exit 1
    fi
    BACKUP_FILE="passbook-backup-$(date +%Y%m%d-%H%M%S).json"
    echo "Exporting data to ${BACKUP_FILE} before deletion..."
    # Stderr is NOT suppressed: a failed export must be visible. Abort the
    # whole cleanup if it fails, so we never delete an un-backed-up table.
    if "$ADD_DATA" --instance "$INSTANCE" --region "$REGION" export "$BACKUP_FILE"; then
        echo -e "${GREEN}Data exported to ${BACKUP_FILE}${NC}"
    else
        echo -e "${RED}Error: export failed — aborting deletion to avoid irreversible data loss.${NC}" >&2
        echo -e "${RED}Fix the export (or pass --skip-export to delete anyway) and re-run.${NC}" >&2
        exit 1
    fi
    echo
fi

if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] Skipping confirmation; nothing will be deleted."
else
    read -r -p "Are you sure you want to delete all AWS resources? (yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        echo "Aborted."
        exit 0
    fi
fi

echo
echo "Starting cleanup..."
echo

# Step 1: Delete main stack (Note: DynamoDB table is retained due to DeletionPolicy)
echo -e "${YELLOW}[1/3] Deleting main stack (${MAIN_STACK})...${NC}"
if aws cloudformation describe-stacks --stack-name "$MAIN_STACK" --region "$REGION" &> /dev/null; then
    run aws cloudformation delete-stack --stack-name "$MAIN_STACK" --region "$REGION"
    if [[ "$DRY_RUN" != "true" ]]; then
        echo "Waiting for stack deletion..."
        aws cloudformation wait stack-delete-complete --stack-name "$MAIN_STACK" --region "$REGION"
        echo -e "${GREEN}Main stack deleted.${NC}"
    fi
else
    echo "Stack not found, skipping."
fi

# Step 2: Delete DynamoDB table (retained by CloudFormation due to DeletionPolicy: Retain)
echo -e "${YELLOW}[2/3] Deleting DynamoDB table (${TABLE_NAME})...${NC}"
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" &> /dev/null; then
    run aws dynamodb delete-table --table-name "$TABLE_NAME" --region "$REGION"
    if [[ "$DRY_RUN" != "true" ]]; then
        echo "Waiting for table deletion..."
        aws dynamodb wait table-not-exists --table-name "$TABLE_NAME" --region "$REGION"
        echo -e "${GREEN}DynamoDB table deleted.${NC}"
    fi
else
    echo "Table not found, skipping."
fi

# Step 3: Delete CloudWatch logs
echo -e "${YELLOW}[3/3] Deleting CloudWatch log group...${NC}"
if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --region "$REGION" \
    --query "logGroups[?logGroupName=='$LOG_GROUP'].logGroupName" --output text 2>/dev/null | grep -q "$LOG_GROUP"; then
    run aws logs delete-log-group --log-group-name "$LOG_GROUP" --region "$REGION"
    [[ "$DRY_RUN" != "true" ]] && echo -e "${GREEN}Log group deleted.${NC}"
else
    echo "Log group not found, skipping."
fi

echo
echo -e "${GREEN}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Cleanup Complete!                              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════╝${NC}"
echo
echo "Instance '${INSTANCE}' resources removed."
echo
echo "Shared resources NOT touched (used by other instances):"
echo "  - Bootstrap stack: passbook-bootstrap"
echo "  - S3 bucket: passbook-lambda-${ACCOUNT_ID}-${REGION}"
echo
echo "For full system teardown, see README.md."
if [[ -n "$BACKUP_FILE" ]]; then
    echo
    echo "To restore data: ./scripts/add-data.sh --instance ${INSTANCE} import ${BACKUP_FILE}"
fi
