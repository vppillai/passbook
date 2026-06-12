#!/bin/bash
# One-shot teardown of every Passbook resource in this AWS account.
#
# Removes:
#   • Every per-instance CloudFormation stack (passbook-<name>-prod)
#   • The DynamoDB table behind each stack (CFN's DeletionPolicy: Retain
#     leaves the table alive on stack delete — this script removes it
#     explicitly. PITR backups DO survive table deletion for 35 days.)
#   • The bootstrap stack (passbook-bootstrap), which in turn removes
#     the GH-actions IAM role, OIDC provider, and the S3 deployment bucket
#   • All object versions + delete markers in the S3 bucket (versioning
#     is enabled; CFN can't delete a non-empty bucket)
#   • Any CloudWatch log groups Lambda auto-created outside the stack
#
# Re-runnable: skips resources that don't exist. Use --dry-run for a
# preview without any destructive calls.

set -euo pipefail

REGION="us-west-2"
DRY_RUN=false
SKIP_CONFIRM=false

usage() {
    cat <<'EOF'
Usage: teardown.sh [--region us-west-2] [--dry-run] [--yes]

  --region   AWS region (default: us-west-2)
  --dry-run  Show what would be deleted, do not delete
  --yes      Skip interactive confirmation (DANGEROUS)

This deletes ALL Passbook resources. There is no automated restore from
this state — DynamoDB PITR snapshots persist for 35 days after table
deletion and can be restored manually, but everything else is gone.
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --region) REGION="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --yes) SKIP_CONFIRM=true; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1 ;;
    esac
done

# Helper: print + run, or print + skip when --dry-run
run() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] $*"
    else
        echo "  + $*"
        "$@"
    fi
}

# Helper: print + run, suppressing stderr "does not exist" errors so we
# can safely re-run on a partially-torn-down state.
run_quiet() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] $*"
    else
        echo "  + $*"
        "$@" 2>/dev/null || echo "    (already gone)"
    fi
}

echo "=========================================="
echo "Passbook teardown — region: $REGION"
[[ "$DRY_RUN" == "true" ]] && echo "Mode: DRY RUN"
echo "=========================================="
echo ""

# Discover live per-instance stacks (passbook-*-prod, excluding bootstrap).
echo "Discovering Passbook stacks..."
STACKS=$(aws cloudformation list-stacks --region "$REGION" \
    --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE ROLLBACK_COMPLETE \
    --query "StackSummaries[?starts_with(StackName, 'passbook-') && StackName != 'passbook-bootstrap'].StackName" \
    --output text 2>/dev/null || echo "")

if [[ -z "$STACKS" ]]; then
    echo "  No per-instance stacks found."
else
    echo "  Found: $STACKS"
fi
echo ""

# Per-stack: list the table(s) so we can show the user what's about to go.
TABLES_TO_DELETE=()
for STACK in $STACKS; do
    TABLE=$(aws cloudformation describe-stack-resources --region "$REGION" \
        --stack-name "$STACK" \
        --query "StackResources[?ResourceType=='AWS::DynamoDB::Table'].PhysicalResourceId" \
        --output text 2>/dev/null || echo "")
    [[ -n "$TABLE" ]] && TABLES_TO_DELETE+=("$TABLE")
done

# Bootstrap bucket — must be emptied before CFN can delete it.
BUCKET=$(aws cloudformation describe-stacks --region "$REGION" \
    --stack-name passbook-bootstrap \
    --query "Stacks[0].Outputs[?OutputKey=='LambdaDeploymentBucketName'].OutputValue" \
    --output text 2>/dev/null || echo "")

echo "Summary of what will be deleted:"
[[ -n "$STACKS" ]] && printf "  Stack: %s\n" $STACKS
# ${TABLES_TO_DELETE[@]+"..."} guards against bash 3.2 (macOS) treating an
# empty array as unset under set -u, which would cause a fatal expansion error.
for T in ${TABLES_TO_DELETE[@]+"${TABLES_TO_DELETE[@]}"}; do
    echo "  Table: $T  (CFN retains it; this script removes it explicitly)"
done
[[ -n "$BUCKET" ]] && echo "  Bucket: $BUCKET  (all object versions)"
echo "  Stack: passbook-bootstrap  (IAM role, OIDC provider, S3 bucket resource)"
echo ""

if [[ "$DRY_RUN" != "true" && "$SKIP_CONFIRM" != "true" ]]; then
    read -r -p 'Type "DELETE EVERYTHING" to confirm: ' CONFIRM
    if [[ "$CONFIRM" != "DELETE EVERYTHING" ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# === 1. Delete per-instance CFN stacks (waits for completion in series).
for STACK in $STACKS; do
    echo ""
    echo "Deleting CFN stack: $STACK"
    run_quiet aws cloudformation delete-stack --region "$REGION" --stack-name "$STACK"
    if [[ "$DRY_RUN" != "true" ]]; then
        echo "  (waiting for $STACK delete to complete...)"
        aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name "$STACK" 2>/dev/null \
            || echo "    (no longer trackable — likely already deleted)"
    fi
done

# === 2. Delete the retained DynamoDB tables.
for TABLE in ${TABLES_TO_DELETE[@]+"${TABLES_TO_DELETE[@]}"}; do
    echo ""
    echo "Deleting DynamoDB table: $TABLE"
    run_quiet aws dynamodb delete-table --region "$REGION" --table-name "$TABLE"
done

# === 3. Empty the bootstrap bucket (all versions + delete markers) so
# CFN can drop the bucket resource on the next stack delete.
if [[ -n "$BUCKET" ]]; then
    echo ""
    echo "Emptying bucket: $BUCKET"
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] (would delete all object versions and delete-markers)"
    else
        # delete-objects accepts at most 1000 keys per call. Loop over both
        # Versions and DeleteMarkers in 1000-key batches until the bucket is
        # empty — the previous single-shot delete silently broke once the
        # bucket held >1000 versions (live account had 43+ growing forever).
        # Use mktemp for the batch payload, not a fixed /tmp path (collision /
        # symlink-attack hardening; auto-cleaned by the EXIT trap below).
        BATCH_FILE=$(mktemp)
        trap 'rm -f "$BATCH_FILE"' EXIT

        emptied=0
        for SELECTOR in "Versions" "DeleteMarkers"; do
            while :; do
                # Pull up to 1000 keys for this selector.
                BATCH=$(aws s3api list-object-versions --bucket "$BUCKET" \
                    --max-items 1000 \
                    --query "{Objects: ${SELECTOR}[].{Key:Key,VersionId:VersionId}}" \
                    --output json 2>/dev/null || echo "")
                # No more objects of this kind → move on.
                if [[ -z "$BATCH" || "$BATCH" == "null" || "$BATCH" == '{"Objects":null}' ]]; then
                    break
                fi
                # Guard against an empty Objects array (jq returns []).
                count=$(echo "$BATCH" | jq -r '.Objects | length')
                if [[ "$count" == "0" ]]; then
                    break
                fi
                echo "$BATCH" > "$BATCH_FILE"
                aws s3api delete-objects --bucket "$BUCKET" --delete "file://$BATCH_FILE" > /dev/null
                emptied=$((emptied + count))
                echo "  + deleted $count ${SELECTOR} (running total: $emptied)"
            done
        done
        rm -f "$BATCH_FILE"
        trap - EXIT
        echo "  + bucket emptied ($emptied objects/markers removed)"
    fi
fi

# === 4. Delete the bootstrap stack (IAM, OIDC, S3 bucket).
echo ""
echo "Deleting CFN stack: passbook-bootstrap"
run_quiet aws cloudformation delete-stack --region "$REGION" --stack-name passbook-bootstrap
if [[ "$DRY_RUN" != "true" ]]; then
    echo "  (waiting for passbook-bootstrap delete to complete...)"
    aws cloudformation wait stack-delete-complete --region "$REGION" --stack-name passbook-bootstrap 2>/dev/null \
        || echo "    (no longer trackable — likely already deleted)"
fi

# === 5. Mop up any orphan log groups Lambda auto-created outside the
# stack (CFN's LogGroup resource catches /aws/lambda/passbook-* but if
# the function ever ran before the LogGroup resource existed, AWS Logs
# may have pre-created one with default retention).
echo ""
echo "Cleaning up orphan log groups..."
ORPHANS=$(aws logs describe-log-groups --region "$REGION" \
    --log-group-name-prefix /aws/lambda/passbook- \
    --query "logGroups[].logGroupName" --output text 2>/dev/null || echo "")
if [[ -n "$ORPHANS" ]]; then
    for LG in $ORPHANS; do
        echo "  Found leftover log group: $LG"
        run_quiet aws logs delete-log-group --region "$REGION" --log-group-name "$LG"
    done
else
    echo "  None."
fi

echo ""
echo "=========================================="
echo "Teardown complete."
echo ""
echo "Not deleted (intentionally):"
echo "  • DynamoDB PITR backups (persist 35 days; restore via Console if needed)"
echo "  • GitHub repo, GitHub Pages deployment, GitHub OIDC provider on GitHub side"
echo "  • Any Dependabot PRs"
echo "=========================================="
