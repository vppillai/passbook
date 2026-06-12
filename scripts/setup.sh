#!/usr/bin/env bash
#
# One-shot onboarding for a Passbook fork.
#
# After forking the repo, a new owner runs this ONE script. The only manual
# prerequisites are:
#   • aws CLI logged in with admin-capable credentials (aws sts get-caller-identity works)
#   • gh  CLI logged in (gh auth status works)
#
# It then:
#   1. Preflights aws / gh / jq.
#   2. Derives the GitHub owner + repo from `gh repo view` (git remote fallback).
#   3. Prompts for the AWS region (default us-west-2; override with --region).
#   4. Deploys infrastructure/bootstrap.yaml (the shared CI/OIDC + S3 stack).
#   5. Sets the AWS_ACCOUNT_ID repo secret (consumed by the deploy workflows).
#   6. Creates the `production` GitHub environment (the OIDC trust condition
#      requires repo:<owner>/<repo>:environment:production).
#   7. Enables GitHub Pages with "GitHub Actions" as the build source.
#   8. Prints the next steps (add an instance YAML, push, app URL).
#
# Idempotent: safe to re-run. CloudFormation deploys use
# --no-fail-on-empty-changeset; the gh calls tolerate already-exists state.

set -euo pipefail

# ----------------------------------------------------------------------------
# Defaults and flag parsing
# ----------------------------------------------------------------------------
REGION="us-west-2"
DRY_RUN=false
STACK_NAME="passbook-bootstrap"

# Resolve repo root from this script's location so it works from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_FILE="${REPO_ROOT}/infrastructure/bootstrap.yaml"

usage() {
    cat <<'EOF'
Usage: setup.sh [--region us-west-2] [--dry-run]

  --region   AWS region to deploy the bootstrap stack into (default: us-west-2)
  --dry-run  Print every command that would run; make no changes
  -h --help  Show this help

Prerequisites (do these first):
  • aws CLI logged in with admin-capable credentials
  • gh  CLI logged in (run: gh auth login)
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --region)
            [[ $# -ge 2 ]] || { echo "Error: --region needs a value" >&2; exit 1; }
            REGION="$2"; shift 2 ;;
        --region=*)
            REGION="${1#*=}"; shift ;;
        --dry-run)
            DRY_RUN=true; shift ;;
        -h|--help)
            usage; exit 0 ;;
        *)
            echo "Error: unknown argument: $1" >&2
            usage >&2
            exit 1 ;;
    esac
done

# Helper: print + run, or print + skip when --dry-run.
run() {
    if [[ "$DRY_RUN" == "true" ]]; then
        echo "  [DRY-RUN] $*"
    else
        echo "  + $*"
        "$@"
    fi
}

# ----------------------------------------------------------------------------
# 1. Preflight
# ----------------------------------------------------------------------------
echo "=========================================="
echo "Passbook setup"
[[ "$DRY_RUN" == "true" ]] && echo "Mode: DRY RUN (no changes will be made)"
echo "=========================================="
echo ""
echo "Checking prerequisites..."

if ! command -v aws >/dev/null 2>&1; then
    echo "Error: 'aws' CLI not found. Install it: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html" >&2
    exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
    echo "Error: 'gh' CLI not found. Install it: https://cli.github.com/" >&2
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "Error: 'jq' not found. Install it: 'sudo apt install jq' or 'brew install jq'." >&2
    exit 1
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "Error: AWS credentials are not configured or have expired." >&2
    echo "       Log in with an admin-capable identity, then re-run." >&2
    echo "       (e.g. 'aws configure' or 'aws sso login')" >&2
    exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "Error: GitHub CLI is not authenticated. Run 'gh auth login' and re-run." >&2
    exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" ]]; then
    echo "Error: bootstrap template not found at $TEMPLATE_FILE" >&2
    echo "       Run this script from inside the cloned passbook repo." >&2
    exit 1
fi

echo "  OK: aws, gh, jq present and authenticated."
echo ""

# ----------------------------------------------------------------------------
# 2. Derive GitHub owner / repo
# ----------------------------------------------------------------------------
echo "Determining GitHub repository..."
OWNER=""
REPO=""
if REPO_JSON="$(gh repo view --json owner,name 2>/dev/null)"; then
    OWNER="$(printf '%s' "$REPO_JSON" | jq -r '.owner.login')"
    REPO="$(printf '%s' "$REPO_JSON" | jq -r '.name')"
fi

# Fallback: parse the origin git remote if gh couldn't resolve a repo.
if [[ -z "$OWNER" || "$OWNER" == "null" || -z "$REPO" || "$REPO" == "null" ]]; then
    REMOTE_URL="$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo "")"
    if [[ -n "$REMOTE_URL" ]]; then
        # Handles both git@github.com:owner/repo(.git) and https://github.com/owner/repo(.git)
        STRIPPED="${REMOTE_URL%.git}"
        REPO="${STRIPPED##*/}"
        OWNER_PATH="${STRIPPED%/*}"
        OWNER="${OWNER_PATH##*[:/]}"
    fi
fi

if [[ -z "$OWNER" || "$OWNER" == "null" || -z "$REPO" || "$REPO" == "null" ]]; then
    echo "Error: could not determine the GitHub owner/repo." >&2
    echo "       Ensure you are inside the cloned fork and 'gh repo view' works." >&2
    exit 1
fi

echo "  Repository: $OWNER/$REPO"
echo ""

# ----------------------------------------------------------------------------
# 3. Region prompt (skip the prompt if --region was passed or stdin isn't a TTY)
# ----------------------------------------------------------------------------
if [[ -t 0 ]]; then
    read -r -p "AWS region [$REGION]: " REGION_INPUT || true
    if [[ -n "${REGION_INPUT:-}" ]]; then
        REGION="$REGION_INPUT"
    fi
fi
echo "  Region: $REGION"
echo ""

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
echo "  AWS account: $ACCOUNT_ID"
echo ""

# ----------------------------------------------------------------------------
# 4. Deploy the bootstrap stack
# ----------------------------------------------------------------------------
echo "=== Step 1/4: Deploy bootstrap CloudFormation stack ($STACK_NAME) ==="
run aws cloudformation deploy \
    --template-file "$TEMPLATE_FILE" \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --parameter-overrides "GitHubOrg=$OWNER" "GitHubRepo=$REPO" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset
echo ""

# ----------------------------------------------------------------------------
# 5. Set the AWS_ACCOUNT_ID repo secret
# ----------------------------------------------------------------------------
echo "=== Step 2/4: Set AWS_ACCOUNT_ID GitHub secret ==="
run gh secret set AWS_ACCOUNT_ID --repo "$OWNER/$REPO" --body "$ACCOUNT_ID"
echo ""

# ----------------------------------------------------------------------------
# 6. Create the `production` environment (required by the OIDC trust condition)
# ----------------------------------------------------------------------------
echo "=== Step 3/4: Create 'production' GitHub environment ==="
# PUT is idempotent: creates the environment, or no-ops if it already exists.
run gh api -X PUT "repos/$OWNER/$REPO/environments/production"
echo ""

# ----------------------------------------------------------------------------
# 7. Enable GitHub Pages with workflow (GitHub Actions) builds
# ----------------------------------------------------------------------------
echo "=== Step 4/4: Enable GitHub Pages (build source: GitHub Actions) ==="
if [[ "$DRY_RUN" == "true" ]]; then
    echo "  [DRY-RUN] gh api -X POST repos/$OWNER/$REPO/pages -f build_type=workflow"
    echo "  [DRY-RUN]   (on 409 already-exists: gh api -X PUT repos/$OWNER/$REPO/pages -f build_type=workflow)"
else
    # POST creates Pages for the first time.
    # Capture stderr so we can inspect the error message on failure; stdout
    # goes to /dev/null (the response body is not needed on success).
    _PAGES_ERR_FILE="$(mktemp)"
    if gh api -X POST "repos/$OWNER/$REPO/pages" -f build_type=workflow \
           >/dev/null 2>"$_PAGES_ERR_FILE"; then
        echo "  + Pages enabled (build_type=workflow)"
    else
        _PAGES_EXIT=$?
        _PAGES_ERR="$(cat "$_PAGES_ERR_FILE")"
        # GitHub returns HTTP 409 when Pages already exists.  Any other
        # failure (403 forbidden, 404 repo not found, network error, …) is a
        # real problem — print the captured message and abort so the operator
        # can diagnose it rather than falling through to a confusing PUT.
        if echo "$_PAGES_ERR" | grep -qi "409\|already exists\|conflict"; then
            echo "  + Pages already exists; ensuring build_type=workflow via PUT"
            _PAGES_PUT_ERR_FILE="$(mktemp)"
            if ! gh api -X PUT "repos/$OWNER/$REPO/pages" -f build_type=workflow \
                    >/dev/null 2>"$_PAGES_PUT_ERR_FILE"; then
                echo "Error: failed to update GitHub Pages build type." >&2
                echo "       gh PUT error: $(cat "$_PAGES_PUT_ERR_FILE")" >&2
                rm -f "$_PAGES_ERR_FILE" "$_PAGES_PUT_ERR_FILE"
                exit 1
            fi
            rm -f "$_PAGES_PUT_ERR_FILE"
        else
            echo "Error: failed to enable GitHub Pages (exit $_PAGES_EXIT)." >&2
            echo "       gh POST error: $_PAGES_ERR" >&2
            rm -f "$_PAGES_ERR_FILE"
            exit 1
        fi
    fi
    rm -f "$_PAGES_ERR_FILE"
fi
echo ""

# ----------------------------------------------------------------------------
# Next steps
# ----------------------------------------------------------------------------
echo "=========================================="
echo "Setup complete for $OWNER/$REPO"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "  1. Create or edit an instance config, e.g. config/instances/<name>.yaml"
echo "     (copy config/instances/kids.yaml as a starting point)."
echo ""
echo "  2. Commit and push to the 'main' branch:"
echo "       git add config/instances/<name>.yaml"
echo "       git commit -m 'Add <name> instance'"
echo "       git push origin main"
echo ""
echo "  3. CI deploys the backend stack, then rebuilds the frontend. Your app"
echo "     will be live at:"
echo "       https://$OWNER.github.io/$REPO/<name>/"
echo ""
[[ "$DRY_RUN" == "true" ]] && echo "(DRY RUN: nothing was actually changed.)"
