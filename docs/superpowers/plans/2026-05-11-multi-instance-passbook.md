# Multi-Instance Passbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the passbook repo so a single codebase deploys N independent instances (kids existing, eatout new) via per-instance YAML configs; migrate existing kids data into the new naming scheme with zero data loss.

**Architecture:** Single repo. `config/instances/<name>.yaml` is the source of truth for each deployment. CI discovers configs dynamically and matrix-deploys each one to its own CloudFormation stack (separate DynamoDB table, Lambda, API Gateway). Frontend ships per-instance subdirectories under one GitHub Pages site, each with injected `config.js` (API URL + label overrides). Backend Go code is unchanged.

**Tech Stack:** Go 1.22 Lambda (ARM64), DynamoDB, CloudFormation, GitHub Actions matrix, vanilla JS frontend, bash helper scripts, `yq` for YAML parsing in CI.

**Pre-reqs:** Working on branch `multi-instance-deploy` (already created). The design spec at `docs/superpowers/specs/2026-05-11-multi-instance-passbook-design.md` is the contract — review it if anything in this plan is unclear.

**Commit identity for this branch:** Use `git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" commit ...` (overrides per-command, no global git config changes).

---

## Task 1: Add instance config files + backups gitignore

**Files:**
- Create: `config/instances/kids.yaml`
- Create: `config/instances/eatout.yaml`
- Modify: `.gitignore`

- [ ] **Step 1: Create kids config**

```bash
mkdir -p config/instances
```

`config/instances/kids.yaml`:
```yaml
name: kids
display_name: Kids Passbook
monthly_amount: 100
labels:
  app_title: My Passbook
  app_description: Track allowance and expenses
  total_savings: Total Savings
  add_funds_button: "+ Funds"
  add_funds_modal_title: Add Funds
  add_funds_modal_submit: Add Funds
  expense_buy_label: What did you buy?
  expense_buy_placeholder: e.g., Ice cream
  monthly_allowance_hint: Monthly allowance will be applied automatically.
  funds_added_toast: Funds added!
  spent_suffix: spent
```

- [ ] **Step 2: Create eatout config**

`config/instances/eatout.yaml`:
```yaml
name: eatout
display_name: Eat-Out Budget
monthly_amount: 500
labels:
  app_title: Eat-Out Budget
  app_description: Track household eat-out spending
  total_savings: Total Remaining
  add_funds_button: "+ Top Up"
  add_funds_modal_title: Top Up Budget
  add_funds_modal_submit: Top Up
  expense_buy_label: Where did you eat?
  expense_buy_placeholder: "e.g., Pizza Hut"
  monthly_allowance_hint: Monthly budget will be applied automatically.
  funds_added_toast: Budget topped up!
  spent_suffix: spent
```

- [ ] **Step 3: Add backups/ to .gitignore**

Edit `.gitignore` and append:
```
# Local data backups (never commit — contain PIN hashes)
backups/
*.json.bak
```

- [ ] **Step 4: Verify configs are well-formed**

Run:
```bash
yq '.' config/instances/kids.yaml > /dev/null && echo "kids OK"
yq '.' config/instances/eatout.yaml > /dev/null && echo "eatout OK"
```
Expected: both print `OK`.

- [ ] **Step 5: Commit**

```bash
git add config/instances/kids.yaml config/instances/eatout.yaml .gitignore
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "Add per-instance config files for kids and eatout

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: CloudFormation template — uniform InstanceName-based naming

**Files:**
- Modify: `infrastructure/template.yaml`

- [ ] **Step 1: Add InstanceName parameter**

In `infrastructure/template.yaml`, after the `Environment` parameter block (around line 9), add:
```yaml
  InstanceName:
    Type: String
    Description: Instance suffix used in resource names (e.g., kids, eatout)
    AllowedPattern: '^[a-z][a-z0-9-]*$'
    MinLength: 1
    MaxLength: 32
```

- [ ] **Step 2: Update DynamoDB table name**

Replace:
```yaml
      TableName: !Sub 'passbook-${Environment}'
```
With:
```yaml
      TableName: !Sub 'passbook-${InstanceName}-${Environment}'
```

- [ ] **Step 3: Update Lambda execution role name**

Replace:
```yaml
      RoleName: !Sub 'passbook-lambda-${Environment}'
```
With:
```yaml
      RoleName: !Sub 'passbook-lambda-${InstanceName}-${Environment}'
```

- [ ] **Step 4: Update Lambda function name**

Replace:
```yaml
      FunctionName: !Sub 'passbook-api-${Environment}'
```
With:
```yaml
      FunctionName: !Sub 'passbook-api-${InstanceName}-${Environment}'
```

- [ ] **Step 5: Update API Gateway name**

Replace:
```yaml
      Name: !Sub 'passbook-api-${Environment}'
```
With:
```yaml
      Name: !Sub 'passbook-api-${InstanceName}-${Environment}'
```

- [ ] **Step 6: Update Outputs export name**

Replace:
```yaml
      Name: !Sub 'PassbookApiEndpoint-${Environment}'
```
With:
```yaml
      Name: !Sub 'PassbookApiEndpoint-${InstanceName}-${Environment}'
```

- [ ] **Step 7: Validate template syntactically**

Run:
```bash
aws cloudformation validate-template --template-body file://infrastructure/template.yaml --region us-west-2
```
Expected: prints `{"Parameters": [...], "Description": "...", "Capabilities": [...]}` with no error. (Requires AWS creds; if not available locally, this validation runs in CI later — skip this step.)

- [ ] **Step 8: Commit**

```bash
git add infrastructure/template.yaml
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "Make CloudFormation template uniformly instance-named

Adds required InstanceName parameter. All resource names become
passbook-\${InstanceName}-\${Environment}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Refactor `scripts/add-data.sh` to require `--instance`

**Files:**
- Modify: `scripts/add-data.sh`

- [ ] **Step 1: Replace hardcoded TABLE_NAME with argument parsing**

In `scripts/add-data.sh`, locate the line:
```bash
TABLE_NAME="passbook-prod"
```
(currently at line 49)

Replace the surrounding setup block (lines ~46-50 — `REGION="us-west-2"` and `TABLE_NAME="passbook-prod"`) with:
```bash
REGION="us-west-2"

# Parse --instance flag (must come BEFORE the positional command)
INSTANCE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--instance)
            INSTANCE="$2"; shift 2 ;;
        --region)
            REGION="$2"; shift 2 ;;
        --) shift; break ;;
        -h|--help)
            echo "Usage: $0 --instance <name> <command> [args...]"
            echo ""
            echo "Commands: month, expense, funds, rmfunds, rmmonth, balance, recalc, show, export, import"
            echo ""
            echo "Examples:"
            echo "  $0 --instance kids show"
            echo "  $0 --instance eatout export backup.json"
            exit 0 ;;
        *) break ;;
    esac
done

if [[ -z "$INSTANCE" ]]; then
    echo "Error: --instance <name> required (e.g., --instance kids)" >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1
fi

TABLE_NAME="passbook-${INSTANCE}-prod"
```

- [ ] **Step 2: Test the help flag works**

Run:
```bash
./scripts/add-data.sh --help
```
Expected: prints usage text and exits 0.

- [ ] **Step 3: Test missing instance errors**

Run:
```bash
./scripts/add-data.sh show
```
Expected: prints `Error: --instance <name> required ...` and exits 1.

- [ ] **Step 4: Test help with --instance**

Run:
```bash
./scripts/add-data.sh --instance kids 2>&1 | head -5
```
Expected: doesn't error on argument parsing (may error later on missing command, that's fine — we just verified parsing works).

- [ ] **Step 5: Commit**

```bash
git add scripts/add-data.sh
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "add-data.sh: require --instance flag (no implicit default)

Prevents accidental writes to the wrong instance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Refactor `scripts/admin.sh` to require `--instance`

**Files:**
- Modify: `scripts/admin.sh`

- [ ] **Step 1: Replace hardcoded TABLE_NAME with argument parsing**

In `scripts/admin.sh`, locate the line:
```bash
TABLE_NAME="passbook-prod"
```
(currently at line 46)

Replace the surrounding setup block (the `REGION="us-west-2"` and `TABLE_NAME="passbook-prod"` lines) with the full block below. Note that `admin.sh` is an interactive TUI with no positional commands, so we `shift` past unrecognized args rather than `break`-ing (unlike `add-data.sh`).

```bash
REGION="us-west-2"

INSTANCE=""
while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--instance)
            INSTANCE="$2"; shift 2 ;;
        --region)
            REGION="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 --instance <name>"
            echo ""
            echo "Interactive admin TUI for a passbook instance."
            echo ""
            echo "Example: $0 --instance kids"
            exit 0 ;;
        *) shift ;;
    esac
done

if [[ -z "$INSTANCE" ]]; then
    echo "Error: --instance <name> required (e.g., --instance kids)" >&2
    echo "Run '$0 --help' for usage." >&2
    exit 1
fi

TABLE_NAME="passbook-${INSTANCE}-prod"
```

- [ ] **Step 2: Also display the instance name in the TUI header**

Find the TUI header (search for `Passbook Admin Console`). Inside the heredoc/echo that draws the header, add the instance name. For example, if the header looks like:
```bash
echo "╔════════════════════════════════════════════╗"
echo "║     Passbook Admin Console                 ║"
echo "╚════════════════════════════════════════════╝"
```
Change to:
```bash
echo "╔════════════════════════════════════════════╗"
echo "║     Passbook Admin Console — ${INSTANCE^^}          ║"
echo "╚════════════════════════════════════════════╝"
```
(Pad the line so the right-hand border stays aligned. If the instance name is long, you can simply add a separate line: `echo "  Instance: ${INSTANCE}"`.)

- [ ] **Step 3: Test help**

Run:
```bash
./scripts/admin.sh --help
```
Expected: usage text, exits 0.

- [ ] **Step 4: Test missing instance**

Run:
```bash
./scripts/admin.sh
```
Expected: error, exits 1.

- [ ] **Step 5: Commit**

```bash
git add scripts/admin.sh
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "admin.sh: require --instance flag

Displays the active instance in the TUI header to prevent confusion
when administering multiple instances.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Refactor `scripts/cleanup-aws.sh` to be per-instance

**Files:**
- Modify: `scripts/cleanup-aws.sh`

This script previously deleted everything (main stack + bootstrap stack + S3 bucket + table). Per the design, the **bootstrap stack and S3 bucket are shared across instances** and should NOT be deleted as part of per-instance cleanup. Refactor:

- [ ] **Step 1: Replace top-of-file constants with argument parsing**

In `scripts/cleanup-aws.sh`, replace the lines (currently 7-11):
```bash
REGION="us-west-2"
MAIN_STACK="passbook-prod"
BOOTSTRAP_STACK="passbook-bootstrap"
TABLE_NAME="passbook-prod"
LOG_GROUP="/aws/lambda/passbook-api-prod"
```

With:
```bash
REGION="us-west-2"
INSTANCE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -i|--instance) INSTANCE="$2"; shift 2 ;;
        --region) REGION="$2"; shift 2 ;;
        -h|--help)
            echo "Usage: $0 --instance <name>"
            echo ""
            echo "Deletes one instance's CloudFormation stack, DynamoDB table, and log group."
            echo "Does NOT touch the shared bootstrap stack or S3 bucket — see README for full teardown."
            echo ""
            echo "Example: $0 --instance kids"
            exit 0 ;;
        *) shift ;;
    esac
done

if [[ -z "$INSTANCE" ]]; then
    echo "Error: --instance <name> required" >&2
    exit 1
fi

MAIN_STACK="passbook-${INSTANCE}-prod"
TABLE_NAME="passbook-${INSTANCE}-prod"
LOG_GROUP="/aws/lambda/passbook-api-${INSTANCE}-prod"
```

- [ ] **Step 2: Remove bootstrap/S3 cleanup sections**

Delete the sections that handle the bootstrap stack and S3 bucket (search for `BOOTSTRAP_STACK` and `BUCKET_NAME` — remove those entire blocks, including the corresponding `echo "Deleting..."` and `aws cloudformation delete-stack` calls for the bootstrap stack).

Update the step counters in the remaining steps (e.g., `[1/6]`, `[2/6]` → `[1/3]`, `[2/3]`, `[3/3]`).

The remaining steps should be:
1. Delete the instance's CloudFormation stack
2. Delete the (retained) DynamoDB table
3. Delete the CloudWatch log group

- [ ] **Step 3: Update the export step at the top**

The script currently asks "Do you want to export data first?" and calls `./scripts/add-data.sh export <file>`. That call needs `--instance`:
```bash
if ./scripts/add-data.sh --instance "$INSTANCE" export "$BACKUP_FILE" 2>/dev/null; then
```

- [ ] **Step 4: Update the final help text**

The current epilogue mentions rehoming-to-another-account steps. Update the "next steps" message to reflect that this is per-instance cleanup, and point to the README for full teardown. For example:
```bash
echo "Instance '${INSTANCE}' resources removed."
echo ""
echo "Shared resources NOT touched (used by other instances):"
echo "  - Bootstrap stack: passbook-bootstrap"
echo "  - S3 bucket: passbook-lambda-<account>-${REGION}"
echo ""
echo "For full system teardown, see README.md."
```

- [ ] **Step 5: Test help**

Run:
```bash
./scripts/cleanup-aws.sh --help
```
Expected: usage text, exits 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/cleanup-aws.sh
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "cleanup-aws.sh: per-instance scope, leave shared resources alone

Removes the bootstrap-stack and S3-bucket deletion logic, which were
unsafe in a multi-instance world. Per-instance cleanup deletes only
that instance's stack, table, and log group.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Create `scripts/migrate-instance.sh`

**Files:**
- Create: `scripts/migrate-instance.sh`

- [ ] **Step 1: Write the script**

`scripts/migrate-instance.sh`:
```bash
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
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/migrate-instance.sh
```

- [ ] **Step 3: Test help**

Run:
```bash
./scripts/migrate-instance.sh --help
```
Expected: usage text, exits 0.

- [ ] **Step 4: Test missing args**

Run:
```bash
./scripts/migrate-instance.sh --from foo
```
Expected: `Error: --from and --to required`, exits 1.

- [ ] **Step 5: Test dry-run against current production table**

(Only if you have AWS creds locally — otherwise skip and rely on the actual cutover step in Task 16 to exercise it.)
```bash
./scripts/migrate-instance.sh --from passbook-prod --to passbook-prod --dry-run 2>&1 | head -10
```
Expected: lists items it WOULD copy without modifying anything. The "to" being the same table is just for the dry-run sanity check — no writes happen.

- [ ] **Step 6: Commit**

```bash
git add scripts/migrate-instance.sh
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "Add migrate-instance.sh for cross-stack data migration

Copies CONFIG, BALANCE, and MONTH# items between DynamoDB tables.
Skips SESSION# and RATELIMIT# (transient). Idempotent.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Create frontend `labels.js`

**Files:**
- Create: `frontend/js/labels.js`

- [ ] **Step 1: Write the labels module**

`frontend/js/labels.js`:
```javascript
// Default English labels (kids passbook wording).
// Per-instance overrides come from `window.PASSBOOK_LABELS`, injected
// at build time by CI based on config/instances/<name>.yaml.

const defaultLabels = {
    app_title: 'My Passbook',
    app_description: 'Track allowance and expenses',
    total_savings: 'Total Savings',
    add_funds_button: '+ Funds',
    add_funds_modal_title: 'Add Funds',
    add_funds_modal_submit: 'Add Funds',
    expense_buy_label: 'What did you buy?',
    expense_buy_placeholder: 'e.g., Ice cream',
    monthly_allowance_hint: 'Monthly allowance will be applied automatically.',
    funds_added_toast: 'Funds added!',
    spent_suffix: 'spent',
};

const overrides = (typeof window !== 'undefined' && window.PASSBOOK_LABELS) || {};

export const labels = Object.freeze({ ...defaultLabels, ...overrides });

// Apply labels to all elements with data-i18n attributes.
// Called once during app init, after DOM is parsed.
export function applyLabels() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.dataset.i18n;
        if (labels[key] !== undefined) el.textContent = labels[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.dataset.i18nPlaceholder;
        if (labels[key] !== undefined) el.placeholder = labels[key];
    });
    if (labels.app_title) document.title = labels.app_title;
}
```

- [ ] **Step 2: Syntax-check the file**

Run:
```bash
node --check frontend/js/labels.js
```
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/labels.js
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "Add labels.js for per-instance UI string overrides

Defaults are the kids-passbook English wording. Per-instance overrides
come from window.PASSBOOK_LABELS injected at build time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Add `data-i18n` attributes to `frontend/index.html`

**Files:**
- Modify: `frontend/index.html`

The replacements below add `data-i18n` (or `data-i18n-placeholder`) attributes so `applyLabels()` from Task 7 will override the divergent strings.

- [ ] **Step 1: Title element**

Replace:
```html
    <title>My Passbook</title>
```
With:
```html
    <title data-i18n="app_title">My Passbook</title>
```

- [ ] **Step 2: All three `<h1>My Passbook</h1>`**

For each of the three `<h1>My Passbook</h1>` instances (setup screen, auth screen, main screen header), replace:
```html
            <h1>My Passbook</h1>
```
With:
```html
            <h1 data-i18n="app_title">My Passbook</h1>
```

Use `Edit` with `replace_all: true` (the string is identical in all three places).

- [ ] **Step 3: "Total Savings" label**

Replace:
```html
                    <span class="label">Total Savings</span>
```
With:
```html
                    <span class="label" data-i18n="total_savings">Total Savings</span>
```

- [ ] **Step 4: "+ Funds" button**

Replace:
```html
                    <button id="add-funds-btn" class="btn-text" title="Add funds to this month">+ Funds</button>
```
With:
```html
                    <button id="add-funds-btn" class="btn-text" data-i18n="add_funds_button" title="Add funds to this month">+ Funds</button>
```

- [ ] **Step 5: "What did you buy?" label and placeholder**

Replace:
```html
                <div class="form-group">
                    <label for="expense-desc">What did you buy?</label>
                    <input type="text" id="expense-desc" placeholder="e.g., Ice cream" maxlength="100" required>
                </div>
```
With:
```html
                <div class="form-group">
                    <label for="expense-desc" data-i18n="expense_buy_label">What did you buy?</label>
                    <input type="text" id="expense-desc" data-i18n-placeholder="expense_buy_placeholder" placeholder="e.g., Ice cream" maxlength="100" required>
                </div>
```

- [ ] **Step 6: Monthly allowance hint**

Replace:
```html
                <p class="form-hint">Monthly allowance will be applied automatically.</p>
```
With:
```html
                <p class="form-hint" data-i18n="monthly_allowance_hint">Monthly allowance will be applied automatically.</p>
```

- [ ] **Step 7: "Add Funds" modal title**

Inside `<div id="add-funds-modal" ...>`, replace:
```html
            <h2>Add Funds</h2>
```
With:
```html
            <h2 data-i18n="add_funds_modal_title">Add Funds</h2>
```

(Note: there is **also** an `<h2>Edit Expense</h2>` and other modal titles. Be specific — only change the one inside `add-funds-modal`. Use enough context in the `old_string` to make it unique.)

- [ ] **Step 8: "Add Funds" submit button (inside add-funds-modal only)**

Inside `<div id="add-funds-modal" ...>`, replace:
```html
                    <button type="submit" class="btn btn-primary">Add Funds</button>
```
With:
```html
                    <button type="submit" class="btn btn-primary" data-i18n="add_funds_modal_submit">Add Funds</button>
```

(Same uniqueness caveat — use enough surrounding context.)

- [ ] **Step 9: HTML syntax check**

Run:
```bash
grep -c "data-i18n" frontend/index.html
```
Expected: at least 10 occurrences (one for title, three `<h1>`, "Total Savings", "+ Funds" button, "What did you buy?" label+placeholder, hint, modal title, modal submit).

Run:
```bash
grep -q "</html>" frontend/index.html && echo "well-formed"
```
Expected: prints `well-formed`.

- [ ] **Step 10: Commit**

```bash
git add frontend/index.html
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "Tag divergent UI strings with data-i18n attributes

Per-instance labels.js will swap textContent on these elements at init,
so the same HTML serves both kids and eatout instances.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Wire `applyLabels()` into `app.js` init + replace hardcoded toast

**Files:**
- Modify: `frontend/js/app.js`

- [ ] **Step 1: Import labels and applyLabels**

At the top of `frontend/js/app.js`, after the existing imports (around line 4):
```javascript
import { api } from './api.js';
import { auth } from './auth.js';
import * as ui from './ui.js';
```

Add:
```javascript
import { labels, applyLabels } from './labels.js';
```

- [ ] **Step 2: Call applyLabels() at the very start of init()**

In the `init()` method (around line 15), make the first line of the function body:
```javascript
    async init() {
        applyLabels();
        try {
```

The rest of init() stays unchanged.

- [ ] **Step 3: Replace the hardcoded "Funds added!" toast**

Find the line (around 507):
```javascript
            ui.showToast('Funds added!', 'success');
```
Replace with:
```javascript
            ui.showToast(labels.funds_added_toast, 'success');
```

- [ ] **Step 4: Syntax check**

Run:
```bash
node --check frontend/js/app.js
```
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/js/app.js
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "app.js: call applyLabels() on init, use label for toast

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Use `spent_suffix` label in `ui.js`

**Files:**
- Modify: `frontend/js/ui.js`

- [ ] **Step 1: Import labels**

Look at the existing imports at the top of `frontend/js/ui.js`. Add:
```javascript
import { labels } from './labels.js';
```
(If there are no existing imports because ui.js exports functions used by app.js, the import still works since both are ES modules.)

- [ ] **Step 2: Replace hardcoded "spent" suffix (two locations)**

Line ~256:
```javascript
    document.getElementById('expenses-total').textContent = `${formatCurrency(totalExpenses)} spent`;
```
Replace with:
```javascript
    document.getElementById('expenses-total').textContent = `${formatCurrency(totalExpenses)} ${labels.spent_suffix}`;
```

Line ~264:
```javascript
    document.getElementById('expenses-total').textContent = '$0.00 spent';
```
Replace with:
```javascript
    document.getElementById('expenses-total').textContent = `$0.00 ${labels.spent_suffix}`;
```

- [ ] **Step 3: Syntax check**

Run:
```bash
node --check frontend/js/ui.js
```
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add frontend/js/ui.js
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "ui.js: use spent_suffix label for expense total

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Refactor `deploy-backend.yaml` — dynamic matrix

**Files:**
- Replace: `.github/workflows/deploy-backend.yaml`

- [ ] **Step 1: Replace the entire file**

Write `.github/workflows/deploy-backend.yaml`:
```yaml
name: Deploy Backend to AWS

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - 'infrastructure/**'
      - 'config/instances/**'
      - '.github/workflows/deploy-backend.yaml'
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

env:
  AWS_REGION: us-west-2

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
          cache: false
      - name: Test
        working-directory: backend
        run: |
          go mod tidy
          go test -v -race ./...
          go vet ./...

  discover:
    runs-on: ubuntu-latest
    outputs:
      instances: ${{ steps.list.outputs.instances }}
    steps:
      - uses: actions/checkout@v4
      - id: list
        run: |
          INSTANCES=$(ls config/instances/*.yaml | xargs -n1 basename | sed 's/\.yaml$//' | jq -R . | jq -sc .)
          echo "instances=$INSTANCES" >> $GITHUB_OUTPUT
          echo "Discovered instances: $INSTANCES"

  build:
    needs: test
    runs-on: ubuntu-latest
    environment: production
    outputs:
      s3_key: ${{ steps.upload.outputs.s3_key }}
      bucket: ${{ steps.bucket.outputs.bucket }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
          cache: false
      - name: Build Lambda
        working-directory: backend
        run: |
          go mod tidy
          GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -tags lambda.norpc -o bootstrap ./cmd/api
          zip function.zip bootstrap
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/passbook-github-actions
          aws-region: ${{ env.AWS_REGION }}
      - id: bucket
        run: |
          BUCKET=$(aws cloudformation describe-stacks \
            --stack-name passbook-bootstrap \
            --query "Stacks[0].Outputs[?OutputKey=='LambdaDeploymentBucketName'].OutputValue" \
            --output text)
          echo "bucket=$BUCKET" >> $GITHUB_OUTPUT
      - id: upload
        run: |
          S3_KEY="function-${{ github.sha }}.zip"
          aws s3 cp backend/function.zip s3://${{ steps.bucket.outputs.bucket }}/$S3_KEY
          echo "s3_key=$S3_KEY" >> $GITHUB_OUTPUT

  deploy:
    needs: [build, discover]
    runs-on: ubuntu-latest
    environment: production
    strategy:
      matrix:
        instance: ${{ fromJson(needs.discover.outputs.instances) }}
      fail-fast: false
    steps:
      - uses: actions/checkout@v4
      - name: Read instance config
        id: config
        run: |
          CONFIG="config/instances/${{ matrix.instance }}.yaml"
          MONTHLY=$(yq '.monthly_amount' "$CONFIG")
          echo "monthly_amount=$MONTHLY" >> $GITHUB_OUTPUT
          echo "Instance: ${{ matrix.instance }}, monthly_amount: $MONTHLY"
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/passbook-github-actions
          aws-region: ${{ env.AWS_REGION }}
      - name: Deploy CloudFormation
        run: |
          aws cloudformation deploy \
            --template-file infrastructure/template.yaml \
            --stack-name passbook-${{ matrix.instance }}-prod \
            --parameter-overrides \
              Environment=prod \
              InstanceName=${{ matrix.instance }} \
              LambdaCodeBucket=${{ needs.build.outputs.bucket }} \
              LambdaCodeKey=${{ needs.build.outputs.s3_key }} \
              AllowedOrigin=https://vppillai.github.io \
              MonthlyAllowance=${{ steps.config.outputs.monthly_amount }} \
            --capabilities CAPABILITY_NAMED_IAM \
            --no-fail-on-empty-changeset
      - name: Update Lambda code
        run: |
          aws lambda update-function-code \
            --function-name passbook-api-${{ matrix.instance }}-prod \
            --s3-bucket ${{ needs.build.outputs.bucket }} \
            --s3-key ${{ needs.build.outputs.s3_key }}
      - name: Summarize
        run: |
          API_URL=$(aws cloudformation describe-stacks \
            --stack-name passbook-${{ matrix.instance }}-prod \
            --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text)
          echo "## Deployed: ${{ matrix.instance }}" >> $GITHUB_STEP_SUMMARY
          echo "- Stack: passbook-${{ matrix.instance }}-prod" >> $GITHUB_STEP_SUMMARY
          echo "- API: $API_URL" >> $GITHUB_STEP_SUMMARY
```

- [ ] **Step 2: Lint workflow YAML**

Run:
```bash
yq '.' .github/workflows/deploy-backend.yaml > /dev/null && echo "YAML valid"
```
Expected: prints `YAML valid`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-backend.yaml
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "deploy-backend.yaml: dynamic matrix over config/instances/

Discovers instances from yaml files. Shared build job uploads one
Lambda zip per CI run; matrix deploy fans out to one CF stack per
instance.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Refactor `deploy-frontend.yaml` — multi-instance build

**Files:**
- Replace: `.github/workflows/deploy-frontend.yaml`

- [ ] **Step 1: Replace the entire file**

Write `.github/workflows/deploy-frontend.yaml`:
```yaml
name: Deploy Frontend to GitHub Pages

on:
  push:
    branches: [main]
    paths:
      - 'frontend/**'
      - 'config/instances/**'
      - '.github/workflows/deploy-frontend.yaml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: true

env:
  AWS_REGION: us-west-2

jobs:
  discover:
    runs-on: ubuntu-latest
    outputs:
      instances: ${{ steps.list.outputs.instances }}
    steps:
      - uses: actions/checkout@v4
      - id: list
        run: |
          INSTANCES=$(ls config/instances/*.yaml | xargs -n1 basename | sed 's/\.yaml$//' | jq -R . | jq -sc .)
          echo "instances=$INSTANCES" >> $GITHUB_OUTPUT

  build-and-deploy:
    needs: discover
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ secrets.AWS_ACCOUNT_ID }}:role/passbook-github-actions
          aws-region: ${{ env.AWS_REGION }}

      - name: Determine version
        id: version
        run: |
          if [ -f frontend/VERSION ]; then
            VERSION=$(cat frontend/VERSION | tr -d '[:space:]')
          else
            VERSION=$(git describe --tags --always 2>/dev/null || echo "dev")
          fi
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "Version: $VERSION"

      - name: Assemble multi-instance build
        env:
          INSTANCES: ${{ needs.discover.outputs.instances }}
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          set -euo pipefail
          mkdir -p build

          # Landing page with meta-refresh to /kids/
          cat > build/index.html <<'EOF'
          <!doctype html>
          <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta http-equiv="refresh" content="0; url=./kids/">
            <title>Passbook</title>
            <style>body{font-family:system-ui,sans-serif;max-width:36em;margin:4em auto;padding:0 1em}</style>
          </head>
          <body>
            <h1>Passbook</h1>
            <p>Redirecting to <a href="./kids/">Kids Passbook</a>...</p>
            <ul>
              <li><a href="./kids/">Kids Passbook</a></li>
              <li><a href="./eatout/">Eat-Out Budget</a></li>
            </ul>
            <script>location.replace('./kids/');</script>
          </body>
          </html>
          EOF

          for INSTANCE in $(echo "$INSTANCES" | jq -r '.[]'); do
            echo "=== Building $INSTANCE ==="
            mkdir -p "build/$INSTANCE"
            cp -r frontend/. "build/$INSTANCE/"

            # Inject version into footer
            sed -i "s|>dev</span>|>$VERSION</span>|" "build/$INSTANCE/index.html"

            # Fetch API URL from CloudFormation outputs
            API_URL=$(aws cloudformation describe-stacks \
              --stack-name "passbook-$INSTANCE-prod" \
              --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
              --output text 2>/dev/null || echo "")
            if [ -z "$API_URL" ] || [ "$API_URL" = "None" ]; then
              echo "::warning::No API URL for $INSTANCE (stack may not be deployed yet)"
              API_URL=""
            else
              echo "API URL for $INSTANCE: $API_URL"
            fi

            # Extract labels from YAML as JSON (default to {} if missing)
            CONFIG_FILE="config/instances/$INSTANCE.yaml"
            LABELS_JSON=$(yq -o=json '.labels // {}' "$CONFIG_FILE")

            # Generate config.js. Use jq to safely JSON-encode the API URL string.
            {
              printf 'window.PASSBOOK_API_URL = %s;\n' "$(printf '%s' "$API_URL" | jq -Rs .)"
              printf 'window.PASSBOOK_LABELS = %s;\n' "$LABELS_JSON"
            } > "build/$INSTANCE/js/config.js"

            # Insert config.js script tag before app.js (must execute first)
            sed -i 's|<script type="module" src="js/app.js"></script>|<script src="js/config.js"></script>\n    <script type="module" src="js/app.js"></script>|' "build/$INSTANCE/index.html"
          done

          echo ""
          echo "Build tree:"
          find build -type f | sort

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: 'build'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Validate YAML**

Run:
```bash
yq '.' .github/workflows/deploy-frontend.yaml > /dev/null && echo "YAML valid"
```
Expected: `YAML valid`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-frontend.yaml
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "deploy-frontend.yaml: multi-instance build with per-subpath config

Discovers instances dynamically. For each, generates a subdir under
build/<instance>/ with config.js holding API URL (from CF outputs)
and labels (from YAML). Root build/index.html bounces to /kids/.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Update README with multi-instance docs + migration runbook

**Files:**
- Modify: `README.md`

The README has sections for: title, Features, Architecture (with diagram), Data Model, API Endpoints, Security, Deployment, Project Structure, Cost, Admin Tools, Development, Cleanup, Troubleshooting. Updates needed:

- [ ] **Step 1: Update the title and intro**

Change:
```markdown
# Kids Passbook

A simple, secure passbook app for tracking a child's allowance and expenses.
```
To:
```markdown
# Passbook

A simple, secure budget-tracker app. Originally built for tracking a child's allowance; now supports running multiple independent instances from one codebase (e.g., kids allowance + household eat-out budget).

**Live apps:**
- Kids: https://vppillai.github.io/passbook/kids/
- Eat-Out: https://vppillai.github.io/passbook/eatout/
```

- [ ] **Step 2: Add a "Multi-Instance" section after the Architecture section**

After the Architecture diagram block, add:
```markdown
## Multi-Instance

Each deployment ("instance") is fully isolated — its own DynamoDB table, Lambda function, API Gateway, and frontend subpath. Instances share: codebase, CloudFormation template, CI workflows, bootstrap stack, and S3 deployment bucket.

### Adding a new instance

1. Create `config/instances/<name>.yaml` with at minimum:
   ```yaml
   name: <name>
   display_name: Human Readable Name
   monthly_amount: 200
   labels:
     app_title: My App
     # ... see existing files for the full label set
   ```
2. Commit and push to `main`.
3. CI discovers the file, deploys `passbook-<name>-prod` stack, and publishes the frontend at `https://vppillai.github.io/passbook/<name>/`.

No other code changes required.
```

- [ ] **Step 3: Update the "Project Structure" tree**

Find the existing Project Structure block (under `## Project Structure`) and replace it with:
```markdown
```
passbook/
├── config/
│   └── instances/             # One YAML per deployed instance
│       ├── kids.yaml
│       └── eatout.yaml
├── .github/workflows/
│   ├── deploy-frontend.yaml    # Per-instance build, GH Pages deploy
│   ├── deploy-backend.yaml     # Matrix over instances → N CF stacks
│   └── test.yaml               # PR validation
├── frontend/
│   ├── index.html              # Same SPA per instance (labels swapped at init)
│   ├── css/styles.css
│   └── js/
│       ├── app.js              # Calls applyLabels() on init
│       ├── api.js
│       ├── auth.js
│       ├── labels.js           # Default English strings + override merging
│       └── ui.js
├── backend/
│   └── ... (unchanged from single-instance)
├── infrastructure/
│   ├── bootstrap.yaml          # Shared across instances
│   └── template.yaml           # Parameterized by InstanceName
└── scripts/
    ├── admin.sh                # All take --instance <name>
    ├── add-data.sh
    ├── cleanup-aws.sh
    ├── migrate-instance.sh     # NEW: copy data between stacks
    └── bootstrap.sh
```
```

- [ ] **Step 4: Update Admin Tools section**

In the "Admin Tools" section, update the commands to show the `--instance` flag. For example:
```markdown
```bash
./scripts/admin.sh --instance kids
./scripts/add-data.sh --instance kids show
./scripts/add-data.sh --instance eatout export backups/eatout-$(date +%Y%m%d).json
```
```

- [ ] **Step 5: Replace the Cleanup section**

Replace the existing "Cleanup / Rehoming" section with:
```markdown
## Cleanup

### Remove one instance

```bash
./scripts/cleanup-aws.sh --instance <name>
```
Deletes the instance's CloudFormation stack, DynamoDB table, and log group. Does **not** touch the shared bootstrap stack or S3 deployment bucket.

### Full teardown (all instances + shared resources)

```bash
# 1. Cleanup each instance
for INSTANCE in kids eatout; do
  ./scripts/cleanup-aws.sh --instance $INSTANCE
done

# 2. Empty and delete shared S3 deployment bucket
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3 rm s3://passbook-lambda-${ACCOUNT_ID}-us-west-2 --recursive
aws s3 rb s3://passbook-lambda-${ACCOUNT_ID}-us-west-2

# 3. Delete bootstrap stack (OIDC provider, IAM role)
aws cloudformation delete-stack --stack-name passbook-bootstrap --region us-west-2
```
```

- [ ] **Step 6: Add a "Migration Runbook" section near the end**

Before the License section, add:
```markdown
## Migration Runbook: passbook-prod → passbook-kids-prod

This runbook documents the one-time migration that moved the original `passbook-prod` stack to the new `passbook-kids-prod` naming when multi-instance was introduced. Kept for reference and as a template for any future cross-stack data move.

### Pre-merge (operator with admin AWS creds)

1. Export current data:
   ```bash
   mkdir -p backups
   ./scripts/add-data.sh --instance kids export backups/kids-pre-migration-$(date +%Y%m%d).json
   ```
   Verify the file parses: `jq . backups/kids-pre-migration-*.json > /dev/null`
2. Create AWS-native backup:
   ```bash
   aws dynamodb create-backup --table-name passbook-prod --backup-name pre-migration-$(date +%Y%m%d) --region us-west-2
   ```
   Verify `BackupStatus: AVAILABLE` via `aws dynamodb describe-backup --backup-arn <arn>`.

### Merge

Merge the multi-instance PR. CI creates `passbook-kids-prod` and `passbook-eatout-prod` stacks alongside the existing `passbook-prod`. The kids frontend now points at the (empty) `passbook-kids-prod` table — coordinate "don't open the app for ~10 minutes."

### Cutover

```bash
./scripts/migrate-instance.sh --from passbook-prod --to passbook-kids-prod
```
Verify the kids app at `/passbook/kids/` shows the migrated data. Test login, balance, expense list, edit, delete, add.

### Cleanup (after confidence period)

- ~1 week: `rm backups/kids-pre-migration-*.json`
- ~2 weeks: `aws cloudformation delete-stack --stack-name passbook-prod --region us-west-2`, then `aws dynamodb delete-table --table-name passbook-prod --region us-west-2`
- ~1 month: `aws dynamodb delete-backup --backup-arn <pre-migration-arn>`
```

- [ ] **Step 7: Commit**

```bash
git add README.md
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "README: document multi-instance, update structure, add migration runbook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: Pre-merge backups (operator manual step — DO BEFORE MERGE)

**Not code. Operator runs locally with admin AWS creds. This task gates the merge — do not push the branch to main until both backups are confirmed.**

- [ ] **Step 1: Confirm AWS creds and table**

```bash
aws sts get-caller-identity
aws dynamodb describe-table --table-name passbook-prod --region us-west-2 --query 'Table.{Name: TableName, Items: ItemCount, Status: TableStatus}'
```
Expected: identifies your account, prints the table info with non-zero `Items`.

- [ ] **Step 2: App-level JSON export (uses current pre-refactor add-data.sh)**

Use a TEMPORARY copy of the **pre-refactor** add-data.sh — one that still has `TABLE_NAME="passbook-prod"` hardcoded. The branch's refactored script requires `--instance kids` which would try to talk to `passbook-kids-prod` (which doesn't exist yet pre-merge). Either:

(a) Run the export from main:
```bash
git stash  # or work in a separate checkout of main
git checkout main
./scripts/add-data.sh export ../backups/kids-pre-migration-$(date +%Y%m%d).json
git checkout multi-instance-deploy
git stash pop  # if you stashed
```

OR (b) Run it via AWS CLI directly (no script needed):
```bash
mkdir -p backups
aws dynamodb scan --table-name passbook-prod --region us-west-2 > backups/kids-pre-migration-raw-$(date +%Y%m%d).json
jq '.Items | length' backups/kids-pre-migration-raw-*.json   # sanity: >0
```

- [ ] **Step 3: AWS-native on-demand backup**

```bash
aws dynamodb create-backup \
  --table-name passbook-prod \
  --backup-name pre-migration-$(date +%Y%m%d) \
  --region us-west-2
```
Record the returned `BackupArn`. Wait a few seconds and:
```bash
aws dynamodb describe-backup --backup-arn <BACKUP_ARN_FROM_ABOVE> --region us-west-2 --query 'BackupDescription.BackupDetails.{Status:BackupStatus,Type:BackupType,Size:BackupSizeBytes}'
```
Expected: `Status: AVAILABLE`.

- [ ] **Step 4: Sanity-check both backups exist**

```bash
ls -lh backups/
aws dynamodb list-backups --table-name passbook-prod --region us-west-2
```
Both should show the backups from steps 2 and 3.

**Gate:** Do NOT proceed to Task 15 until both backups are confirmed.

---

## Task 15: Push the branch and let CI deploy the new stacks

- [ ] **Step 1: Push the branch**

```bash
git push -u origin multi-instance-deploy
```

- [ ] **Step 2: Create the PR**

```bash
gh pr create --title "Multi-instance passbook: kids (migrated) + eatout" --body "$(cat <<'EOF'
## Summary

- Refactor to support N independent deployments from one codebase
- Add eatout instance ($500/mo budget)
- Migrate existing kids data into the new `passbook-kids-prod` stack
- Externalize divergent UI strings via `labels.js`

## Test plan

- [ ] Pre-merge backups taken (see migration runbook)
- [ ] CI deploys both `passbook-kids-prod` and `passbook-eatout-prod` stacks
- [ ] Frontend deploys with `/passbook/kids/`, `/passbook/eatout/`, and root redirect
- [ ] Run `./scripts/migrate-instance.sh --from passbook-prod --to passbook-kids-prod`
- [ ] Verify kids app login, balance, history, edit/delete
- [ ] Verify eatout app login (initial PIN setup), add expense

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch CI**

```bash
gh pr checks --watch
```

If checks fail, debug from the workflow logs. Common issues:
- `aws cloudformation deploy` fails on `passbook-kids-prod` create — usually because resource names already exist from a previous attempt. Check CF console for `passbook-kids-prod` stack status; if `ROLLBACK_COMPLETE`, manually delete it before retrying.
- `aws cloudformation deploy` fails on `passbook-eatout-prod` — same.
- Frontend build fails fetching API URL — non-fatal warning only; proceed.

- [ ] **Step 4: Merge the PR**

After CI is green:
```bash
gh pr merge --merge --delete-branch
```

(Or do this in the GitHub UI if preferred.)

---

## Task 16: Run the migration script (operator, immediately after merge)

**Time-sensitive: the kids frontend now points at the empty `passbook-kids-prod` table. Anyone opening `/passbook/kids/` between merge and this task will see an empty app.**

- [ ] **Step 1: Pull latest main locally**

```bash
git checkout main && git pull
```

- [ ] **Step 2: Confirm both new tables exist and source still has data**

```bash
aws dynamodb describe-table --table-name passbook-kids-prod --region us-west-2 --query 'Table.{Name:TableName,Items:ItemCount}'
aws dynamodb describe-table --table-name passbook-eatout-prod --region us-west-2 --query 'Table.{Name:TableName,Items:ItemCount}'
aws dynamodb describe-table --table-name passbook-prod --region us-west-2 --query 'Table.{Name:TableName,Items:ItemCount}'
```
Expected: `passbook-kids-prod` and `passbook-eatout-prod` exist with `Items: 0` (count is approximate, may take a few minutes to update). `passbook-prod` still has its items.

- [ ] **Step 3: Dry-run the migration**

```bash
./scripts/migrate-instance.sh --from passbook-prod --to passbook-kids-prod --dry-run
```
Expected: lists items that WOULD be copied (CONFIG, BALANCE, MONTH#* rows). Should NOT list any SESSION# or RATELIMIT# items.

- [ ] **Step 4: Run the real migration**

```bash
./scripts/migrate-instance.sh --from passbook-prod --to passbook-kids-prod
```
Expected: prints `Copied: PK=... SK=...` for each item, ends with `Done. Migrated N items, skipped M transient items.`

- [ ] **Step 5: Verify count**

```bash
aws dynamodb scan --table-name passbook-kids-prod --region us-west-2 --select COUNT
```
Expected: matches the migrated count from step 4.

---

## Task 17: End-to-end verification of both apps

- [ ] **Step 1: Kids app**

Open `https://vppillai.github.io/passbook/kids/` (in incognito/private to avoid stale localStorage with old session token):
- [ ] Page loads (no console errors)
- [ ] Title is "My Passbook"
- [ ] Header shows "My Passbook"
- [ ] PIN prompt appears; enter the original PIN
- [ ] Successful login → main screen
- [ ] Total Savings balance is correct (matches old app)
- [ ] Current month shows
- [ ] Recent expenses load
- [ ] History menu (☰ top-right) shows months
- [ ] Pagination "more" link works in history
- [ ] Add an expense (e.g., $0.01 "migration test") → appears in list; balance decreases
- [ ] Edit that expense (change description or amount) → list updates
- [ ] Delete that expense → list updates; balance recovers

- [ ] **Step 2: Eatout app**

Open `https://vppillai.github.io/passbook/eatout/` (in incognito):
- [ ] Page loads
- [ ] Title is "Eat-Out Budget"
- [ ] Header shows "Eat-Out Budget"
- [ ] PIN setup screen appears (first-time setup)
- [ ] Set a PIN → main screen
- [ ] Balance is $0 (no months yet)
- [ ] Create a new month for the current month → allowance is $500
- [ ] Add an expense → appears; balance decreases
- [ ] Label "+ Top Up" instead of "+ Funds"
- [ ] Label "Total Remaining" instead of "Total Savings"
- [ ] Add Funds modal title is "Top Up Budget"

- [ ] **Step 3: Backward-compat redirect**

Open `https://vppillai.github.io/passbook/` (the old URL):
- [ ] Auto-redirects to `/passbook/kids/`
- [ ] Without JS (e.g., `curl -sL`), the body shows links to both apps

- [ ] **Step 4: Mark verification complete in PR**

Comment on the PR with verification results:
```bash
gh pr comment <PR_NUMBER> --body "Verification complete:
- Kids app at /passbook/kids/: login + balance + expenses + edit/delete confirmed
- Eatout app at /passbook/eatout/: setup + first expense confirmed
- Root /passbook/ redirects to /kids/"
```

---

## Task 18: Cleanup (timed — DO NOT run immediately)

**Wait at least 1 week before any of these. The whole point of the backups is to keep them while the new system proves stable.**

- [ ] **Step 1: After ~1 week of normal use — delete local JSON backup**

```bash
ls -la backups/
# If everything still works:
rm backups/kids-pre-migration-*.json
```

- [ ] **Step 2: After ~2 weeks — delete the old CloudFormation stack**

```bash
aws cloudformation delete-stack --stack-name passbook-prod --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name passbook-prod --region us-west-2
```
The old `passbook-prod` DynamoDB table is **retained** (DeletionPolicy: Retain) — it persists after stack deletion.

- [ ] **Step 3: After ~2 weeks — delete the orphaned table**

```bash
aws dynamodb delete-table --table-name passbook-prod --region us-west-2
```

- [ ] **Step 4: After ~1 month — delete the AWS on-demand backup**

```bash
aws dynamodb list-backups --region us-west-2 --query 'BackupSummaries[?contains(BackupName, `pre-migration`)]'
# Note the BackupArn, then:
aws dynamodb delete-backup --backup-arn <ARN> --region us-west-2
```

- [ ] **Step 5: Final repo cleanup commit (optional)**

If by this point you want to remove the migration runbook section from README, do so. It's also fine to keep it as historical record.

```bash
# Only if removing:
# Edit README.md to delete the "Migration Runbook" section
git add README.md
git -c user.email="3634378+vppillai@users.noreply.github.com" -c user.name="Vysakh P Pillai" \
  commit -m "Remove migration runbook (migration complete and verified)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

## Reference: spec self-review mapping

| Spec section | Plan task(s) |
|---|---|
| Config files | Task 1 |
| Backend (no-op) | n/a |
| Infrastructure template.yaml | Task 2 |
| Bootstrap (no-op) | n/a |
| CI workflows | Tasks 11, 12 |
| Frontend label externalization | Tasks 7, 8, 9, 10 |
| Backward-compat redirect | Task 12 step 1 (landing page in build) |
| Helper scripts | Tasks 3, 4, 5 |
| migrate-instance.sh | Task 6 |
| Pre-merge backups | Task 14 |
| Merge | Task 15 |
| Cutover | Task 16 |
| Verification | Task 17 |
| Cleanup | Task 18 |
| Documentation (README runbook) | Task 13 |
| Extensibility (future instance) | Built into Tasks 1, 11, 12 via dynamic `config/instances/` discovery |
