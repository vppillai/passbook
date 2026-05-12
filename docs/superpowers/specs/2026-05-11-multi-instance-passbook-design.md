# Multi-Instance Passbook — Design

**Date:** 2026-05-11
**Status:** Approved
**Author:** vpillai

## Goal

Run N independent deployments of the passbook app from a single codebase. The first new deployment is a shared household "Eat-Out Budget" tracker ($500/month) alongside the existing "Kids Passbook" ($100/month). The design must make it trivial to add a third, fourth, etc. instance later — drop a YAML file, push, done.

## Constraints

- One repo, one set of source files, one set of CloudFormation templates.
- Each instance is fully isolated: separate DynamoDB table, separate Lambda, separate API Gateway, separate frontend subpath.
- Existing kids data must survive the migration; multiple independent backups required.
- No backend Go code changes.
- Existing user-facing URL `https://vppillai.github.io/passbook/` continues to work for current bookmarks (via redirect).
- Single shared PIN per instance (no multi-user auth — that's out of scope).

## Non-goals

- Multi-user authentication.
- Cross-instance shared data, aggregation, or single sign-on.
- Multi-region deployment.
- Internationalization beyond a per-instance label override map.

## Architecture overview

```
              one codebase (this repo)
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   config/instances/  Go Lambda    frontend/
     kids.yaml        (unchanged)  (label-driven)
     eatout.yaml
     (future)
        │
        │  read by CI → matrix expansion
        ▼
   ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
   │ kids stack  │  │ eatout stack│  │  (future)    │
   │ passbook-   │  │ passbook-   │  │  passbook-   │
   │   kids-prod │  │   eatout-   │  │   <name>-    │
   │             │  │   prod      │  │   prod       │
   │ DDB+Lambda+ │  │ DDB+Lambda+ │  │              │
   │ API Gateway │  │ API Gateway │  │              │
   └─────────────┘  └─────────────┘  └──────────────┘
        │                │                  │
        ▼                ▼                  ▼
  vppillai.github.io/passbook/
       ├── index.html        (landing + redirect)
       ├── kids/             (frontend, config injected for kids)
       ├── eatout/           (frontend, config injected for eatout)
       └── <name>/           (future)
```

## Components

### 1. Instance configuration files

A new directory `config/instances/` holds one YAML file per instance. The file is the single source of truth for everything that differs between instances: resource name suffix, monthly budget amount, UI label overrides, and frontend subpath (defaults to the instance name).

```yaml
# config/instances/kids.yaml
name: kids
display_name: Kids Passbook
monthly_amount: 100
labels:
  income: Allowance
  add: Add Funds
  remaining: Saved
  app_title: Kids Passbook
```

```yaml
# config/instances/eatout.yaml
name: eatout
display_name: Eat-Out Budget
monthly_amount: 500
labels:
  income: Budget
  add: Top Up
  remaining: Remaining
  app_title: Eat-Out Budget
```

**Adding a new instance later:** create a third file, push. No other change required anywhere.

### 2. Backend (Go Lambda)

**No changes.** The Lambda already takes its identity from environment variables (`TABLE_NAME`, `ALLOWED_ORIGIN`, `MONTHLY_ALLOWANCE`). Each instance's CloudFormation stack passes the right values.

### 3. Infrastructure — `infrastructure/template.yaml`

- Add a required `InstanceName` parameter (no default, no conditional logic).
- All resource names become uniform: `passbook-${InstanceName}-${Environment}`.
  - DynamoDB table: `passbook-kids-prod`, `passbook-eatout-prod`
  - Lambda function: `passbook-api-kids-prod`, `passbook-api-eatout-prod`
  - Lambda exec role: `passbook-lambda-kids-prod`, `passbook-lambda-eatout-prod`
  - API Gateway: `passbook-api-kids-prod`, `passbook-api-eatout-prod`
  - Log group: `/aws/lambda/passbook-api-kids-prod`, `/aws/lambda/passbook-api-eatout-prod`
- CloudFormation Outputs export names get the instance suffix too: `PassbookApiEndpoint-kids-prod`, etc.

### 4. Bootstrap — `infrastructure/bootstrap.yaml`

**No changes.** Every IAM resource ARN already matches `passbook-*` which covers both `passbook-kids-prod` and `passbook-eatout-prod` and any future name.

### 5. CI workflows — dynamic matrix

**`deploy-backend.yaml`** gains a `discover` job that lists `config/instances/*.yaml`, outputs a JSON array of instance names, and feeds it to a downstream `deploy` job's matrix via `fromJson()`.

```yaml
jobs:
  discover:
    outputs:
      instances: ${{ steps.list.outputs.instances }}
    steps:
      - uses: actions/checkout@v4
      - id: list
        run: |
          INSTANCES=$(ls config/instances/*.yaml \
            | xargs -n1 basename \
            | sed 's/\.yaml$//' \
            | jq -R . | jq -sc .)
          echo "instances=$INSTANCES" >> $GITHUB_OUTPUT

  build:
    needs: test
    steps:
      - Build Go Lambda zip once (binary is identical for all instances —
        differentiation is via env vars at runtime)
      - aws s3 cp function.zip s3://<bucket>/function-${{ github.sha }}.zip
      # Output: the S3 key, used by all deploy matrix jobs

  deploy:
    needs: [build, discover]
    strategy:
      matrix:
        instance: ${{ fromJson(needs.discover.outputs.instances) }}
      fail-fast: false      # one instance's failure doesn't block others
    steps:
      - Parse config/instances/${{ matrix.instance }}.yaml
      - aws cloudformation deploy --stack-name passbook-${{ matrix.instance }}-prod
          --parameter-overrides InstanceName=${{ matrix.instance }} ...
      - aws lambda update-function-code --function-name passbook-api-${{ matrix.instance }}-prod ...
```

The build step is shared (single Lambda zip per CI run); deploy is per-instance. This avoids any race between parallel matrix jobs trying to upload the same S3 key. The matrix expands automatically as new YAML files are added.

**`deploy-frontend.yaml`** mirrors the pattern: a `discover` job lists instances, then a single `build` job iterates over the list, building one subdirectory per instance. AWS OIDC step queries each backend stack's `ApiEndpoint` output to inject into `js/config.js`, eliminating the manual `API_ENDPOINT` repo variable.

Generated build layout:
```
build/
├── index.html              ← landing page + meta-refresh redirect to /kids/
├── kids/
│   ├── index.html          ← copy of frontend/index.html
│   ├── js/config.js        ← window.PASSBOOK_API_URL + window.PASSBOOK_LABELS
│   └── ...                 ← all other frontend/ files
├── eatout/
│   └── ...                 ← same structure, different config.js
└── <future>/
```

### 6. Frontend — label externalization

Today, user-facing strings are inline English in `frontend/index.html` and `frontend/js/*.js`. The refactor:

- Wrap each divergent string in an attribute: `<h2 data-i18n="income_label">Monthly Allowance</h2>`.
- Add `frontend/js/labels.js` with the default English strings (today's kids wording).
- In `frontend/js/app.js`, on init: walk all `[data-i18n]` elements and replace their text content with values from `window.PASSBOOK_LABELS` (overrides) falling back to `labels.js` (defaults).
- CI injects per-instance `window.PASSBOOK_LABELS` into each subdirectory's `js/config.js`.

**Strings to externalize (initial list, expand during implementation):**
- "Allowance" / "Budget"
- "Monthly Allowance" / "Monthly Budget"
- "Add Funds" / "Top Up"
- "Saved" / "Remaining"
- "Kids Passbook" / "Eat-Out Budget" (page title, header)
- "Add expense" — same in both, but include for consistency

Strings used only in admin/scripts (DDB-side terminology like "MONTH#", error messages) are NOT externalized — they're internal.

### 7. Backward-compat redirect

`build/index.html` (the root landing page) is a small static page:

```html
<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./kids/">
<title>Passbook</title>
<noscript>
  <a href="./kids/">Kids Passbook</a> ·
  <a href="./eatout/">Eat-Out Budget</a>
</noscript>
<script>location.replace('./kids/');</script>
```

This preserves the existing bookmark of `https://vppillai.github.io/passbook/` — it just bounces to `/kids/`. Curious humans without JS see two links.

### 8. Helper scripts

`scripts/admin.sh`, `scripts/add-data.sh`, `scripts/cleanup-aws.sh` get a required `INSTANCE` env var (or `--instance` flag). **No silent default** — the operator must pick. This prevents accidental writes to the wrong instance.

The scripts read `config/instances/<instance>.yaml` to resolve the DynamoDB table name (`passbook-<instance>-prod`) and other config. Existing call sites that ran with no flag will fail loudly with a clear error message rather than silently affecting the wrong instance.

### 9. New tool — `scripts/migrate-instance.sh`

Used during the migration (and reusable for any future cross-stack data move):

```bash
./scripts/migrate-instance.sh --from passbook-prod --to passbook-kids-prod
```

Behavior:
- Scans source table.
- Filters out `SESSION#*` and `RATELIMIT#*` rows (transient — let users re-login, drop stale lockouts).
- BatchWriteItem to destination table.
- Idempotent — re-running overwrites items, doesn't duplicate.
- Reports count of items migrated and any items skipped.

## Migration plan — single PR, four independent safety nets

### Pre-merge (operator runs locally with admin AWS creds, before pushing the PR)

1. App-level JSON export (runs against the current pre-refactor `add-data.sh`, which targets `passbook-prod` by default — no flag needed at this stage):
   ```bash
   mkdir -p backups
   ./scripts/add-data.sh export backups/kids-pre-migration-20260511.json
   ```
   Verify the file size is reasonable and JSON parses.

2. AWS-native on-demand DynamoDB backup:
   ```bash
   aws dynamodb create-backup \
     --table-name passbook-prod \
     --backup-name pre-migration-20260511 \
     --region us-west-2
   aws dynamodb describe-backup --backup-arn <arn>  # confirm AVAILABLE
   ```

**Both backups must be confirmed before pushing the PR.** The local JSON file must not be committed (contains the Argon2id PIN hash).

### Merge (single PR push)

3. CI runs the dynamic-matrix deploy:
   - New stack `passbook-kids-prod` (empty new table).
   - New stack `passbook-eatout-prod` (empty new table).
   - Existing `passbook-prod` stack — untouched. Still holds the kids data.
4. CI deploys the multi-instance frontend. Subpaths `/kids/` and `/eatout/` are live. The `/kids/` subpath points at the new (empty) table — **brief visible empty state for the kids app if anyone visits before the cutover step below**.

### Cutover (operator runs ~immediately after CI completes — coordinate with family: "don't open the app for 10 min")

5. Run the migration script:
   ```bash
   ./scripts/migrate-instance.sh --from passbook-prod --to passbook-kids-prod
   ```
6. Open `https://vppillai.github.io/passbook/kids/`, log in with the original PIN, verify:
   - Total balance correct
   - Recent months show
   - Expense list shows
   - Pagination works
   - Edit and delete operations work
   - "Add expense" creates a new entry that persists

### Safety net summary

Four independent backups exist at the cutover point. To lose data, all four would have to fail simultaneously.

| # | Backup | Where | Lifetime |
|---|---|---|---|
| 1 | Local JSON export | Operator's laptop | Until manually deleted |
| 2 | AWS on-demand backup | AWS Backup service | Until manually deleted |
| 3 | Orphaned `passbook-prod` DynamoDB table | AWS (Retain policy survives stack deletion) | Until manually deleted |
| 4 | `passbook-prod` CloudFormation stack | AWS | Until manually deleted |

### Cleanup (after a confidence period — suggested intervals)

After ~1 week of normal use of the new `passbook-kids-prod` stack:
- `rm backups/kids-pre-migration-*.json`

After ~2 weeks:
- `aws cloudformation delete-stack --stack-name passbook-prod --region us-west-2`
  (Old table is retained.)
- `aws dynamodb delete-table --table-name passbook-prod --region us-west-2`

After ~1 month:
- `aws dynamodb delete-backup --backup-arn <pre-migration-arn>`

Each cleanup step is independent and reversible up until the moment it runs. If anything ever looks off, the next-cleaner backup level is still intact.

## Extensibility — adding a third instance later

After this PR is merged, the recipe is:

1. Create `config/instances/<name>.yaml` with the new instance's settings.
2. Commit and push.
3. CI's `discover` job picks up the new file. The matrix expands. A new stack `passbook-<name>-prod` is created. The frontend gets a new `/<name>/` subpath.

No edits required in: workflow YAML, CloudFormation templates, backend code, frontend code, or helper scripts.

## Risks & open questions

| Risk | Mitigation |
|---|---|
| Brief empty-state window on `/kids/` between CI completion and migration script run | Operator coordinates with family; window is ~10 min and a logged-in user just sees "no data" rather than an error |
| Migration script fails partway | Idempotent — re-run safely. All four backups untouched. |
| Operator forgets to run migration script | Documented as required step in `README.md`'s deployment section. Optional: add a CI step that asserts the new kids table has expected item count (post-cutover sanity check) — out of scope for this PR. |
| `add-data.sh export` hits a row format the importer can't parse | Pre-merge step #1 catches this — operator verifies the JSON file parses cleanly before continuing. AWS-native backup (step #2) provides an alternative restore path that bypasses the script entirely. |
| Eat-out app needs different CORS origin in the future (e.g., custom domain) | `cors_origin` is an optional per-instance field. Defaults to `https://vppillai.github.io`. |

## What's out of scope for this PR

- Backend feature changes (no schema changes, no new endpoints).
- Multi-user / per-user PINs.
- Cross-instance aggregation or shared total view.
- A CI-driven assertion that data was migrated correctly (could be added later as a `post-cutover-verify.sh`).
- Per-instance feature flags (e.g., "eat-out doesn't show 'Saved' history").
