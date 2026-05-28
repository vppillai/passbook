# Passbook

A simple, secure budget-tracker app. One codebase, multiple independent deployments (e.g., a child's allowance, a household eat-out budget). Each deployment has its own data, login PIN, branding, and URL — but shares CI and code.

**Live apps:**
- Kids: https://vppillai.github.io/passbook/kids/
- Eat-Out: https://vppillai.github.io/passbook/eatout/

---

## Features

- Multi-instance deployment from a single codebase
- Per-instance PWA (name, icon, theme color, start URL)
- Per-instance UI color theming via CSS variables
- Per-instance UI labels (e.g., "Allowance" vs "Budget")
- Dynamic CI matrix: drop a YAML file to add a new instance
- Monthly budget tracking (configurable amount per instance)
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
                              GitHub Pages
                  ┌──────────────────────────────────┐
                  │  /passbook/      (landing page)  │
                  │  /passbook/kids/    (kids SPA)   │
                  │  /passbook/eatout/  (eatout SPA) │
                  └──────────┬───────────┬───────────┘
                             │           │  HTTPS
              ┌──────────────▼─┐   ┌─────▼───────────┐
              │ API Gateway    │   │ API Gateway     │
              │ passbook-kids- │   │ passbook-eatout-│
              │ prod           │   │ prod            │
              └────────┬───────┘   └────────┬────────┘
                       │  AWS_PROXY         │
              ┌────────▼───────┐    ┌───────▼────────┐
              │ Lambda (Go)    │    │ Lambda (Go)    │
              │ ARM64, 128MB   │    │ ARM64, 128MB   │
              └────────┬───────┘    └───────┬────────┘
                       │                    │
              ┌────────▼───────┐    ┌───────▼────────┐
              │ DynamoDB       │    │ DynamoDB       │
              │ passbook-kids- │    │ passbook-eatout│
              │ prod           │    │ -prod          │
              └────────────────┘    └────────────────┘

   Shared infrastructure (deployed once via bootstrap.yaml):
     • S3 bucket — Lambda deployment artifacts
     • IAM role — passbook-github-actions (assumed via OIDC)
     • OIDC provider — trusts environment:production only
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

### How per-instance customization works

Each instance's `config/instances/<name>.yaml` drives three layers of customization:

| Block | Drives | Mechanism |
|---|---|---|
| `pwa:` | PWA install (name, icon, theme color, start URL) | CI writes `build/<instance>/manifest.json`; meta tags rewritten in `index.html` |
| `colors:` | In-app accent / background colors | CI writes `build/<instance>/css/theme.css` (linked after `styles.css`); cascade overrides CSS custom properties |
| `labels:` | Divergent UI strings ("Allowance" vs "Budget") | CI bakes `window.PASSBOOK_LABELS` into `build/<instance>/js/config.js`; `applyLabels()` runs at page init |

The CSS theming is a separate stylesheet (not an inline `<style>` block) because the app's Content-Security-Policy uses `style-src 'self'`, which blocks inline styles. External same-origin stylesheets are allowed.

To customize the PWA icon for an instance, drop a square SVG at `frontend/assets/icons/<name>.svg`. If absent, the instance uses the default `frontend/assets/icon.svg`.

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
     theme_color: "#5B7FD9"
     background_color: "#F5F7FB"
   colors:
     primary: "#5B7FD9"
     primary_dark: "#4263B3"
     background: "#F5F7FB"
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
| Session Storage | Server-side in DynamoDB; client token in `sessionStorage` | Token is cleared when the tab closes (matches the "Lock" UX) |
| Session Expiry | 24-hour TTL | Auto-deleted by DynamoDB |

### Brute Force Protection

| Control | Value | Purpose |
|---------|-------|---------|
| Attempt limit | 5 failed attempts per 15-minute window | Per source IP; further attempts refused until the window's TTL elapses |
| Counter storage | DynamoDB row with 15-minute TTL | Auto-expires, no manual cleanup |
| Argon2id cost | 16 MB / 3 iterations | Each verification is deliberately slow |
| API rate limit | 5 req/sec, 10 burst | API Gateway level |

### Network Security

| Control | Implementation | Purpose |
|---------|----------------|---------|
| CORS | `Access-Control-Allow-Origin: https://vppillai.github.io` | Only allow requests from app |
| Origin / Referer enforcement | At least one of `Origin` or `Referer` must match the allowed origin (browser-style requests). Requests with neither header are rejected. | Blocks direct API access from non-browser clients |
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
| PIN brute force | Low | Rate limiting (5 / 15 min per IP), Argon2id slowness |
| Session hijacking | Low | HTTPS only, short TTL, no persistent storage |
| XSS | Low | No user-generated HTML, minimal DOM manipulation |
| CSRF | Low | Origin validation, no cookies used |
| Code injection | Low | Parameterized DynamoDB queries |
| Direct API access | None | Requires matching `Origin` or `Referer` header; non-browser clients with neither are rejected |
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

**Secrets:**
- `AWS_ACCOUNT_ID`: Your 12-digit AWS account ID

The frontend workflow fetches each instance's API endpoint directly from CloudFormation outputs — no manual variable needed.

**Pages:**
- Settings → Pages → Source: "GitHub Actions"

### Step 3: Deploy

Push to `main` to trigger automatic deployment:

```bash
git push origin main
```

CI runs a dynamic matrix across all instances defined in `config/instances/`. Each instance gets its own backend stack and frontend build. Workflows:
1. Build and test Go backend
2. Deploy CloudFormation stack per instance
3. Upload Lambda code per instance
4. Build and deploy all instance frontends to GitHub Pages

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
│   └── ... (Go Lambda handler, shared across instances)
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

Per instance (typical household-scale usage):

| Service | Expected Usage | Monthly Cost |
|---------|---------------|--------------|
| Lambda | ~1,000 invocations | $0.00 |
| API Gateway | ~1,000 requests | $0.00 |
| DynamoDB | <1 MB, minimal reads/writes | $0.00 |
| CloudWatch logs | Basic logs | $0.00 |
| **Per-instance subtotal** | | **~$0.00/month** |

Shared (one-time across all instances):

| Service | Monthly Cost |
|---|---|
| S3 (Lambda artifacts, ~5 MB) | $0.01 |

All services stay within AWS Free Tier for typical multi-instance household usage.

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

Use the one-shot script. It deletes every per-instance stack, the retained
DynamoDB tables, and the bootstrap stack — and crucially **empties the
versioned S3 bucket** (all object versions + delete markers), which a plain
`aws s3 rm --recursive` cannot do, so `aws s3 rb` would otherwise fail:

```bash
./scripts/teardown.sh --dry-run   # preview everything that would be deleted
./scripts/teardown.sh             # delete (prompts: type "DELETE EVERYTHING")
```

DynamoDB PITR snapshots survive table deletion for 35 days and can be restored
manually from the console if needed.

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
- Check CloudWatch logs: `/aws/lambda/passbook-api-<instance>-prod` (e.g., `/aws/lambda/passbook-api-kids-prod`)
- Verify DynamoDB table exists and Lambda has permissions

### 401 Unauthorized
- Session expired (24h limit)
- Close the tab (clears the `sessionStorage` token) and re-authenticate

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

## License

MIT

---

<sub>Built with [Claude Code](https://claude.ai/code)</sub>
