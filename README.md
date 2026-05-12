# Passbook

A simple, secure budget-tracker app. Originally built for tracking a child's allowance; now supports running multiple independent instances from one codebase (e.g., kids allowance + household eat-out budget).

**Live apps:**
- Kids: https://vppillai.github.io/passbook/kids/
- Eat-Out: https://vppillai.github.io/passbook/eatout/

---

## Features

- Monthly allowance tracking (configurable, default $100)
- Expense tracking with descriptions (add, edit, delete)
- Running balance calculation (monthly and total)
- Monthly history view with pagination
- Month management from the UI (create months, add funds)
- PIN-protected access (4-6 digits)
- Mobile-first responsive design
- Automatic session expiry (24h)

---

## Architecture

```
┌─────────────────────┐         HTTPS          ┌────────────────────────┐
│   GitHub Pages      │ ──────────────────────▶│   API Gateway          │
│   (Static SPA)      │                        │   (HTTP API v2)        │
│                     │                        │                        │
│  - Vanilla JS       │◀───────────────────────│  - CORS: single origin │
│  - Mobile-first CSS │    JSON responses      │  - Rate: 5/sec, 10 brst│
└─────────────────────┘                        └───────────┬────────────┘
                                                           │
                                               ┌───────────▼────────────┐
                                               │   Lambda (Go)          │
                                               │   ARM64, 128MB         │
                                               │                        │
                                               │  - PIN: Argon2id hash  │
                                               │  - Sessions: UUID + TTL│
                                               │  - Origin validation   │
                                               └───────────┬────────────┘
                                                           │
                                               ┌───────────▼────────────┐
                                               │   DynamoDB             │
                                               │   (On-Demand)          │
                                               │                        │
                                               │  - Single-table design │
                                               │  - AES-256 encryption  │
                                               │  - TTL auto-cleanup    │
                                               └────────────────────────┘
```

### Data Model (Single-Table Design)

| PK | SK | Purpose |
|----|----|----|
| `CONFIG` | `CONFIG` | PIN hash (Argon2id), settings |
| `BALANCE` | `BALANCE` | Total accumulated balance |
| `MONTH#2026-02` | `SUMMARY` | Month starting/ending balance, totals |
| `MONTH#2026-02` | `EXP#<ts>#<id>` | Individual expense |
| `SESSION#<token>` | `SESSION#<token>` | Auth session (24h TTL) |
| `RATELIMIT#<ip>` | `RATELIMIT#<ip>` | Failed PIN attempts (15m TTL) |

### API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/health` | No | Health check |
| GET | `/api/auth/status` | No | Check if PIN is configured |
| POST | `/api/auth/setup` | No | First-time PIN setup |
| POST | `/api/auth/verify` | No | Verify PIN, receive session token |
| POST | `/api/auth/change` | Yes | Change PIN (requires current PIN) |
| POST | `/api/auth/logout` | Yes | Invalidate session |
| GET | `/api/balance` | Yes | Get total balance |
| GET | `/api/months?limit=50&cursor=` | Yes | List months with balances (paginated) |
| GET | `/api/month/{yyyy-mm}?limit=50&cursor=` | Yes | Get month summary + expenses (paginated) |
| POST | `/api/month` | Yes | Create a new month with allowance |
| POST | `/api/month/{yyyy-mm}/funds` | Yes | Add funds to an existing month |
| POST | `/api/expense` | Yes | Add new expense |
| PUT | `/api/expense/{month}/{id}` | Yes | Edit expense amount and/or description |
| DELETE | `/api/expense/{month}/{id}` | Yes | Delete expense (refunds balance) |

---

## Multi-Instance

Each deployment ("instance") is fully isolated — its own DynamoDB table, Lambda function, API Gateway, and frontend subpath. Instances share: codebase, CloudFormation template, CI workflows, bootstrap stack, and S3 deployment bucket.

### Adding a new instance

1. Create `config/instances/<name>.yaml`. Minimum required fields:
   ```yaml
   name: <name>
   display_name: Human Readable Name
   monthly_amount: 200
   pwa:
     name: App Display Name
     short_name: ShortName
     description: Brief description
     theme_color: "#4A90A4"
     background_color: "#f5f7fa"
   labels:
     app_title: My App
     # ... see config/instances/kids.yaml for the full label set
   ```
2. (Optional) Add a custom PWA icon at `frontend/assets/icons/<name>.svg`. If not present, the instance uses the default `frontend/assets/icon.svg`.
3. Commit and push to `main`.
4. CI discovers the file, deploys `passbook-<name>-prod` stack, and publishes the frontend at `https://vppillai.github.io/passbook/<name>/`.

No other code changes are required — the workflow's dynamic matrix expands automatically.

---

## Security Review

This app is hosted in a **public GitHub repository**. Below is a comprehensive security analysis.

### What's Public vs. Private

| Data | Location | Visibility |
|------|----------|------------|
| Source code | GitHub | Public |
| Infrastructure templates | GitHub | Public |
| PIN hash | DynamoDB | Private (AWS account only) |
| Session tokens | DynamoDB | Private |
| Expense data | DynamoDB | Private |
| AWS credentials | GitHub OIDC | Never stored |

### Authentication Security

| Control | Implementation | Notes |
|---------|----------------|-------|
| PIN Hashing | Argon2id (16MB, 3 iterations, 1 thread) | Memory-hard, resistant to GPU attacks |
| Salt | 16 bytes random per PIN | Unique salt prevents rainbow tables |
| Session Tokens | UUID v4 (122 bits of randomness) | Cryptographically secure |
| Session Storage | Server-side DynamoDB only | Token in localStorage, persists 24h across browser restarts |
| Session Expiry | 24-hour TTL | Auto-deleted by DynamoDB |

### Brute Force Protection

| Control | Value | Purpose |
|---------|-------|---------|
| Attempt limit | 5 per 15 minutes | Per source IP |
| Lockout threshold | 10 attempts | Triggers 15-minute lockout |
| Lockout storage | DynamoDB with TTL | Auto-expires, no manual cleanup |
| API rate limit | 5 req/sec, 10 burst | API Gateway level |

### Network Security

| Control | Implementation | Purpose |
|---------|----------------|---------|
| CORS | `Access-Control-Allow-Origin: https://vppillai.github.io` | Only allow requests from app |
| Origin validation | Checked in Lambda code | Defense-in-depth |
| Referer check | Fallback for edge cases | Additional validation |
| HTTPS | Enforced by API Gateway + GitHub Pages | Encryption in transit |
| Security headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Cache-Control: no-store` | MIME sniffing, clickjacking, referrer, caching protection |
| Content Security Policy | CSP meta tag: `default-src 'none'` with minimal allowances | Restricts resource loading to same origin |
| Request body limit | 32 KB max in Lambda handler | Prevents oversized payload abuse |

### Data Protection

| Control | Implementation |
|---------|----------------|
| Encryption at rest | DynamoDB SSE (AES-256) |
| Encryption in transit | TLS 1.2+ (API Gateway) |
| No PII in logs | Lambda doesn't log sensitive data |
| PIN never stored | Only Argon2id hash |

### Infrastructure Security

| Control | Implementation |
|---------|----------------|
| No stored credentials | GitHub OIDC for AWS access |
| OIDC scope | Trust restricted to `environment:production` — only production deployments can assume role |
| Least privilege | Lambda role limited to specific table; CI role scoped to `passbook-*` resources |
| Reserved concurrency | Lambda capped at 5 concurrent executions |
| Private S3 | Lambda artifacts not publicly accessible |
| Resource isolation | All resources prefixed `passbook-*` |

### Potential Attack Vectors & Mitigations

| Vector | Risk | Mitigation |
|--------|------|------------|
| PIN brute force | Low | Rate limiting, lockout, Argon2id slowness |
| Session hijacking | Low | HTTPS only, short TTL, no persistent storage |
| XSS | Low | No user-generated HTML, minimal DOM manipulation |
| CSRF | Low | Origin validation, no cookies used |
| Code injection | Low | Parameterized DynamoDB queries |
| Direct API access | None | Origin header required, validated server-side |
| Credential exposure | None | No credentials in code, OIDC used |

### Security Recommendations

1. **Keep PIN private** - The 4-6 digit PIN is the primary authentication
2. **Use unique PIN** - Don't reuse PINs from other services
3. **Monitor CloudWatch** - Review logs periodically for anomalies
4. **Update dependencies** - Keep Go modules updated for security patches

---

## Deployment

### Prerequisites

- AWS CLI configured with admin access
- GitHub repository with Pages enabled
- Region: `us-west-2` (configurable in templates)

### Step 1: Bootstrap (One-Time)

```bash
aws cloudformation deploy \
  --template-file infrastructure/bootstrap.yaml \
  --stack-name passbook-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-2
```

### Step 2: GitHub Configuration

Add these repository settings (Settings → Secrets and variables → Actions):

**Variables:**
- `AWS_ACCOUNT_ID`: Your 12-digit AWS account ID
- `API_ENDPOINT`: Set after first backend deploy (from CloudFormation outputs)

**Pages:**
- Settings → Pages → Source: "GitHub Actions"

### Step 3: Deploy

Push to `main` to trigger automatic deployment:

```bash
git push origin main
```

Workflows will:
1. Build and test Go backend
2. Deploy CloudFormation stack
3. Upload Lambda code
4. Deploy frontend to GitHub Pages

---

## Project Structure

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
│   ├── manifest.json           # Default PWA manifest (CI rewrites per instance)
│   ├── assets/
│   │   ├── icon.svg            # Default icon (kids)
│   │   └── icons/
│   │       └── eatout.svg      # Per-instance icon overrides
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
│   ├── bootstrap.yaml          # Shared across instances (manually deployed)
│   └── template.yaml           # Parameterized by InstanceName
└── scripts/
    ├── admin.sh                # All take --instance <name>
    ├── add-data.sh
    ├── cleanup-aws.sh
    ├── migrate-instance.sh     # Cross-stack data migration tool
    └── bootstrap.sh
```

---

## Cost Estimate

| Service | Expected Usage | Monthly Cost |
|---------|---------------|--------------|
| Lambda | ~1,000 invocations | $0.00 |
| API Gateway | ~1,000 requests | $0.00 |
| DynamoDB | <1 MB, minimal reads/writes | $0.00 |
| S3 | ~5 MB artifacts | $0.01 |
| CloudWatch | Basic logs | $0.00 |
| **Total** | | **~$0.01/month** |

All services within AWS Free Tier for typical usage.

---

## Admin Tools

Scripts for managing data directly in DynamoDB.

### Prerequisites

| Tool | Purpose | Installation |
|------|---------|--------------|
| **AWS CLI v2** | DynamoDB access | [Install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |
| **jq** | JSON parsing | `sudo apt install jq` / `brew install jq` |
| **bc** | Arithmetic calculations | `sudo apt install bc` / `brew install bc` |
| **xxd** | Random ID generation | Usually pre-installed (part of vim) |

**AWS CLI Configuration:**

```bash
# Configure credentials (one-time setup)
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region (us-west-2)

# Verify access to a DynamoDB table (substitute your instance name)
aws dynamodb describe-table --table-name passbook-kids-prod --region us-west-2
```

### Interactive TUI

```bash
./scripts/admin.sh --instance kids
```

Provides a menu-driven interface:

```
╔════════════════════════════════════════════╗
║     Passbook Admin Console                 ║
╚════════════════════════════════════════════╝

Total Balance: $148

Monthly History:

  Month      │   Starting │  Allowance │   Expenses │     Ending │      Saved
  ───────────┼────────────┼────────────┼────────────┼────────────┼────────────
  2026-02    │         $0 │      +$100 │        -$1 │        $99 │        $99
  2026-01    │         $0 │       +$50 │        -$1 │        $49 │        $49

Actions:
─────────────────────────────────────────────
  1) Add/Update month      6) Set total balance
  2) Add expense           7) View month expenses
  3) Add funds             8) Export data
  4) Remove funds          9) Import data
  5) Delete month          r) Recalculate balance
  0) Admin (PIN/Sessions)  q) Quit
```

### CLI Commands

For scripting or batch operations:

```bash
# View all data in DynamoDB
./scripts/add-data.sh --instance kids show

# Export all data to JSON backup
./scripts/add-data.sh --instance eatout export backups/eatout-$(date +%Y%m%d).json

# Add a month summary (starting balance auto-calculated from previous month)
./scripts/add-data.sh --instance kids month 2026-01 100 30
#                                         ^     ^   ^
#                                         |     |   └── expenses
#                                         |     └────── allowance
#                                         └──────────── YYYY-MM

# Add a historic expense (auto-creates month if needed)
./scripts/add-data.sh --instance kids expense 2026-01 15 "Book purchase"

# Add extra funds to a month
./scripts/add-data.sh --instance kids funds 2026-02 50

# Remove funds from a month
./scripts/add-data.sh --instance kids rmfunds 2026-02 20

# Delete a month and ALL its expenses
./scripts/add-data.sh --instance kids rmmonth 2026-01

# Set total balance directly
./scripts/add-data.sh --instance kids balance 170

# Recalculate total balance from all months
./scripts/add-data.sh --instance kids recalc

# Import data from JSON backup
./scripts/add-data.sh --instance kids import mybackup.json
```

---

## Development

### Backend

```bash
cd backend
go mod tidy
go test ./...
go build -o bootstrap cmd/api/main.go
```

### Frontend

Open `frontend/index.html` directly in browser. API calls will fail without backend, but UI can be tested.

### Environment Variables (Lambda)

| Variable | Default | Description |
|----------|---------|-------------|
| `TABLE_NAME` | Required | DynamoDB table name |
| `ALLOWED_ORIGIN` | Required | CORS allowed origin (e.g. `https://vppillai.github.io`) |
| `MONTHLY_ALLOWANCE` | `100` | Allowance amount |

These are set automatically by the CloudFormation template per instance. See `infrastructure/template.yaml` for the parameter wiring.

---

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

# 2. Empty and delete the shared S3 deployment bucket
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3 rm s3://passbook-lambda-${ACCOUNT_ID}-us-west-2 --recursive
aws s3 rb s3://passbook-lambda-${ACCOUNT_ID}-us-west-2

# 3. Delete the bootstrap stack (OIDC provider, IAM role)
aws cloudformation delete-stack --stack-name passbook-bootstrap --region us-west-2
```

### Rehoming to another AWS account

1. Export each instance's data: `./scripts/add-data.sh --instance <name> export backup-<name>.json`
2. Run the full teardown above in the old account.
3. Configure AWS CLI for the new account: `aws configure`
4. Deploy the bootstrap stack: `aws cloudformation deploy --template-file infrastructure/bootstrap.yaml --stack-name passbook-bootstrap --capabilities CAPABILITY_NAMED_IAM --region us-west-2`
5. Update the `AWS_ACCOUNT_ID` GitHub repository variable.
6. Push to trigger backend + frontend deploys.
7. Import data back: `./scripts/add-data.sh --instance <name> import backup-<name>.json`

---

## Troubleshooting

### PIN Setup Fails
- Check CloudWatch logs: `/aws/lambda/passbook-api`
- Verify DynamoDB table exists and Lambda has permissions

### 401 Unauthorized
- Session expired (24h limit)
- Clear browser localStorage and re-authenticate

### 403 Forbidden
- Request origin doesn't match allowed origin
- Direct API access attempted (not from app)

### 429 Too Many Requests
- API rate limit exceeded (5 req/sec)
- Wait and retry

### CloudFormation stack stuck in UPDATE_ROLLBACK_FAILED
If a deployment adds new IAM permissions to the GitHub Actions role (e.g. new Lambda or CloudWatch actions) and the stack update fails mid-rollback:
1. Apply the updated `bootstrap.yaml` first using admin credentials: `aws cloudformation deploy --template-file infrastructure/bootstrap.yaml --stack-name passbook-bootstrap --capabilities CAPABILITY_NAMED_IAM --region us-west-2`
2. Resume the stuck rollback (substitute your instance's stack name): `aws cloudformation continue-update-rollback --stack-name passbook-kids-prod --region us-west-2`
3. Wait for `UPDATE_ROLLBACK_COMPLETE`, then re-trigger the CI deployment

### bootstrap.yaml changes don't take effect automatically
`bootstrap.yaml` is a manually managed stack (it creates the CI/CD role itself, so it can't bootstrap itself via CI). Any changes to `bootstrap.yaml` must be deployed manually with admin credentials before the CI pipeline will have the new permissions.

---

## Migration Runbook: `passbook-prod` → `passbook-kids-prod`

This runbook documents the one-time migration that renamed the original `passbook-prod` stack to `passbook-kids-prod` when multi-instance was introduced. Kept for reference and as a template for any future cross-stack data move.

### Pre-merge (operator with admin AWS creds, before pushing the PR)

1. Export current data using the pre-refactor `add-data.sh` (which still targets `passbook-prod`):
   ```bash
   mkdir -p backups
   git checkout main -- scripts/add-data.sh    # use the pre-refactor version
   ./scripts/add-data.sh export backups/kids-pre-migration-$(date +%Y%m%d).json
   git checkout multi-instance-deploy -- scripts/add-data.sh    # restore the refactored version
   jq . backups/kids-pre-migration-*.json > /dev/null && echo "JSON OK"
   ```
   Alternatively, use the AWS CLI directly: `aws dynamodb scan --table-name passbook-prod --region us-west-2 > backups/raw-$(date +%Y%m%d).json`

2. Create an AWS-native on-demand backup:
   ```bash
   aws dynamodb create-backup --table-name passbook-prod --backup-name pre-migration-$(date +%Y%m%d) --region us-west-2
   ```
   Verify `BackupStatus: AVAILABLE` via `aws dynamodb describe-backup --backup-arn <arn>`.

### Merge the multi-instance PR

CI deploys `passbook-kids-prod` and `passbook-eatout-prod` stacks alongside the existing `passbook-prod`. The kids frontend now points at the (empty) `passbook-kids-prod` table — coordinate "don't open the app for ~10 minutes."

### Cutover

```bash
./scripts/migrate-instance.sh --from passbook-prod --to passbook-kids-prod
```

Verify the kids app at `/passbook/kids/` shows the migrated data. Test login, balance, expense list, edit, delete, add.

### Cleanup (after confidence period)

- ~1 week: `rm backups/kids-pre-migration-*.json`
- ~2 weeks: `aws cloudformation delete-stack --stack-name passbook-prod --region us-west-2`, then `aws dynamodb delete-table --table-name passbook-prod --region us-west-2`
- ~1 month: `aws dynamodb delete-backup --backup-arn <pre-migration-arn>`

---

## License

MIT

---

<sub>Built with [Claude Code](https://claude.ai/code)</sub>
