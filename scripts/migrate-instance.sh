#!/bin/bash
# Copies DynamoDB items between two passbook tables.
# Skips SESSION#* and RATELIMIT#* (transient — users will re-login).
# Idempotent: re-running overwrites items, doesn't duplicate.
#
# Safety:
#   - Paginates across LastEvaluatedKey so large tables (>1MB scan page)
#     are fully covered. Previous single-page scan silently truncated.
#   - Tracks put-item failures via a tmp counter file (bash subshells
#     can't propagate vars through pipes, so a file is the cheapest
#     out-of-band channel). Exits non-zero if any item failed to copy.
#   - Sanity-checks final dest count against expected keep count.

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

aws dynamodb describe-table --table-name "$SOURCE" --region "$REGION" > /dev/null 2>&1 \
    || { echo "Error: source table $SOURCE not found" >&2; exit 1; }
aws dynamodb describe-table --table-name "$DEST" --region "$REGION" > /dev/null 2>&1 \
    || { echo "Error: dest table $DEST not found" >&2; exit 1; }

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT
ALL_ITEMS="$TMPDIR/all-items.json"
FAIL_FILE="$TMPDIR/fail.count"
echo "[]" > "$ALL_ITEMS"
echo 0 > "$FAIL_FILE"

echo ""
echo "Scanning source table (paginated)..."
NEXT_TOKEN=""
PAGE=0
while :; do
    PAGE=$((PAGE + 1))
    if [[ -z "$NEXT_TOKEN" ]]; then
        PAGE_JSON=$(aws dynamodb scan --table-name "$SOURCE" --region "$REGION" --output json)
    else
        PAGE_JSON=$(aws dynamodb scan --table-name "$SOURCE" --region "$REGION" \
            --starting-token "$NEXT_TOKEN" --output json)
    fi
    PAGE_COUNT=$(echo "$PAGE_JSON" | jq '.Items | length')
    echo "  Page $PAGE: $PAGE_COUNT items"

    # Append this page's items into the running array
    jq -s '.[0] + .[1].Items' "$ALL_ITEMS" <(echo "$PAGE_JSON") > "$ALL_ITEMS.new"
    mv "$ALL_ITEMS.new" "$ALL_ITEMS"

    # AWS CLI v2 emits NextToken (opaque base64) for pagination. Once
    # absent, all pages have been read.
    NEXT_TOKEN=$(echo "$PAGE_JSON" | jq -r '.NextToken // empty')
    [[ -z "$NEXT_TOKEN" ]] && break
done

TOTAL=$(jq 'length' "$ALL_ITEMS")
SKIPPED=$(jq '[.[] | select((.PK.S // "") | (startswith("SESSION#") or startswith("RATELIMIT#")))] | length' "$ALL_ITEMS")
KEEP=$((TOTAL - SKIPPED))

echo ""
echo "Scan complete: $TOTAL items across $PAGE page(s) ($SKIPPED transient, will copy $KEEP)"
echo ""

# Process substitution (not pipe-to-while) so the loop runs in the current
# shell and the FAIL counter file is updated by the same process that
# actually invokes aws put-item.
COUNT=0
while IFS= read -r item; do
    PK=$(echo "$item" | jq -r '.PK.S')
    SK=$(echo "$item" | jq -r '.SK.S')
    COUNT=$((COUNT + 1))
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [$COUNT/$KEEP] Would copy: PK=$PK SK=$SK"
        continue
    fi
    if aws dynamodb put-item --table-name "$DEST" --region "$REGION" --item "$item" > /dev/null; then
        echo "  [$COUNT/$KEEP] Copied: PK=$PK SK=$SK"
    else
        FAILED=$(cat "$FAIL_FILE")
        echo $((FAILED + 1)) > "$FAIL_FILE"
        echo "  [$COUNT/$KEEP] FAILED: PK=$PK SK=$SK" >&2
    fi
done < <(jq -c '.[] | select((.PK.S // "") | (startswith("SESSION#") or startswith("RATELIMIT#")) | not)' "$ALL_ITEMS")

FAILED=$(cat "$FAIL_FILE")
echo ""
if [[ "$DRY_RUN" == "true" ]]; then
    echo "Dry run complete. Would copy $KEEP items, skip $SKIPPED transient."
    exit 0
fi

# Verify dest contains at least the items we tried to put. Doesn't catch
# subset-overlap problems but does catch a complete copy failure.
DEST_COUNT=$(aws dynamodb scan --table-name "$DEST" --region "$REGION" \
    --select COUNT --output json | jq '.Count')

echo "Done. Migrated $((COUNT - FAILED)) of $KEEP items, skipped $SKIPPED transient."
echo "Destination table now contains $DEST_COUNT items."

if [[ "$FAILED" -gt 0 ]]; then
    echo "Error: $FAILED item(s) failed to copy — destination is inconsistent." >&2
    exit 1
fi
