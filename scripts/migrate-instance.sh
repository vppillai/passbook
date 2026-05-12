#!/bin/bash
# Copies DynamoDB items between two passbook tables.
# Skips SESSION#* and RATELIMIT#* (transient — users will re-login).
# Idempotent: re-running overwrites items, doesn't duplicate.

set -euo pipefail

REGION="us-west-2"
SOURCE=""
DEST=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --from) SOURCE="$2"; shift 2 ;;
        --to)   DEST="$2"; shift 2 ;;
        --dry-run) DRY_RUN=true; shift ;;
        --region) REGION="$2"; shift 2 ;;
        -h|--help)
            cat <<'EOF'
Usage: migrate-instance.sh --from <source-table> --to <dest-table> [--dry-run]

Copies all CONFIG, BALANCE, and MONTH# items from source to dest.
SESSION# and RATELIMIT# items are skipped (transient).

Examples:
  migrate-instance.sh --from passbook-prod --to passbook-kids-prod
  migrate-instance.sh --from passbook-prod --to passbook-kids-prod --dry-run
EOF
            exit 0 ;;
        *) echo "Unknown arg: $1" >&2; exit 1 ;;
    esac
done

[[ -z "$SOURCE" || -z "$DEST" ]] && { echo "Error: --from and --to required" >&2; exit 1; }

echo "Source: $SOURCE"
echo "Dest:   $DEST"
echo "Region: $REGION"
[[ "$DRY_RUN" == "true" ]] && echo "Mode:   DRY RUN (no writes)"

# Verify tables exist
aws dynamodb describe-table --table-name "$SOURCE" --region "$REGION" > /dev/null 2>&1 \
    || { echo "Error: source table $SOURCE not found" >&2; exit 1; }
aws dynamodb describe-table --table-name "$DEST" --region "$REGION" > /dev/null 2>&1 \
    || { echo "Error: dest table $DEST not found" >&2; exit 1; }

echo ""
echo "Scanning source table..."
TMPFILE=$(mktemp)
trap "rm -f $TMPFILE" EXIT
aws dynamodb scan --table-name "$SOURCE" --region "$REGION" > "$TMPFILE"

TOTAL=$(jq '.Items | length' "$TMPFILE")
SKIPPED=$(jq '[.Items[] | select((.PK.S // "") | (startswith("SESSION#") or startswith("RATELIMIT#")))] | length' "$TMPFILE")
KEEP=$((TOTAL - SKIPPED))

echo "Found $TOTAL items ($SKIPPED transient, will copy $KEEP)"
echo ""

COUNT=0
jq -c '.Items[] | select((.PK.S // "") | (startswith("SESSION#") or startswith("RATELIMIT#")) | not)' "$TMPFILE" \
| while IFS= read -r item; do
    PK=$(echo "$item" | jq -r '.PK.S')
    SK=$(echo "$item" | jq -r '.SK.S')
    COUNT=$((COUNT + 1))
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [$COUNT/$KEEP] Would copy: PK=$PK SK=$SK"
    else
        aws dynamodb put-item --table-name "$DEST" --region "$REGION" --item "$item" > /dev/null
        echo "  [$COUNT/$KEEP] Copied: PK=$PK SK=$SK"
    fi
done

echo ""
echo "Done. Migrated $KEEP items, skipped $SKIPPED transient items."
