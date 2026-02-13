# Kids Passbook

A simple, secure passbook app for tracking a child's allowance and expenses.

**Live App:** https://vppillai.github.io/passbook/

---

## Admin Tools

### Prerequisites

The admin scripts require the following tools to be installed and configured:

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

# Verify access to the DynamoDB table
aws dynamodb describe-table --table-name passbook-prod --region us-west-2
```

The AWS credentials must have permissions to read/write to the `passbook-prod` DynamoDB table.

### Interactive TUI

```bash
./scripts/admin.sh
```

Provides a menu-driven interface:

```
╔════════════════════════════════════════════╗
║     Passbook Admin Console                 ║
╚════════════════════════════════════════════╝

Total Balance: $170

Monthly History:
─────────────────────────────────────────────
  2026-02  │  Start: $70  │  +$100  │  -$0  │  End: $170
  2026-01  │  Start: $0   │  +$100  │  -$30 │  End: $70

Actions:
─────────────────────────────────────────────
  1) Add/Update month
  2) Add expense (historic)
  3) Add funds
  4) Set total balance
  5) View month expenses
  6) Reset PIN
  7) Clear all sessions
  q) Quit
```

### CLI Commands

For scripting or batch operations:

```bash
# Add a month summary (auto-calculates ending balance)
./scripts/add-data.sh month 2026-01 0 100 30
#                      ^     ^  ^   ^
#                      |     |  |   └── expenses
#                      |     |  └────── allowance
#                      |     └───────── starting balance
#                      └─────────────── YYYY-MM

# Add a historic expense
./scripts/add-data.sh expense 2026-01 15 "Book purchase"

# Add extra funds to a month (updates allowance + balances)
./scripts/add-data.sh funds 2026-02 50

# Set total balance directly
./scripts/add-data.sh balance 170

# View all data in DynamoDB
./scripts/add-data.sh show
```

---

## Features

- $100 monthly allowance (configurable)
- Expense tracking with descriptions
- Running balance calculation
- Monthly history view
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
| GET | `/api/months` | Yes | List all months with balances |
| GET | `/api/month/{yyyy-mm}` | Yes | Get month summary + expenses |
| POST | `/api/expense` | Yes | Add new expense |
| DELETE | `/api/expense/{month}/{id}` | Yes | Delete expense (refunds balance) |

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
| Session Storage | Server-side DynamoDB only | Token in sessionStorage, cleared on tab close |
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
| Least privilege | Lambda role limited to specific table |
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

## Project Structure

```
passbook/
├── .github/workflows/
│   ├── deploy-frontend.yaml    # GitHub Pages deployment
│   └── deploy-backend.yaml     # Lambda build, test, deploy
├── frontend/
│   ├── index.html              # Single page application
│   ├── css/styles.css          # Mobile-first responsive design
│   └── js/
│       ├── app.js              # Main application logic
│       ├── api.js              # HTTP client with session handling
│       ├── auth.js             # PIN entry UI and logic
│       └── ui.js               # Rendering and helpers
├── backend/
│   ├── cmd/api/main.go         # Lambda entry point
│   └── internal/
│       ├── handler/            # HTTP route handlers
│       ├── service/            # Business logic (auth, expenses)
│       ├── repository/         # DynamoDB operations
│       ├── middleware/         # CORS, authentication
│       └── model/              # Data structures
├── infrastructure/
│   ├── bootstrap.yaml          # One-time: OIDC provider, S3 bucket
│   └── template.yaml           # Main: DynamoDB, Lambda, API Gateway
└── scripts/
    ├── admin.sh                # Interactive TUI
    └── add-data.sh             # CLI batch operations
```

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
| `ALLOWED_ORIGIN` | `https://vppillai.github.io` | CORS origin |
| `MONTHLY_ALLOWANCE` | `100` | Allowance amount |

---

## Troubleshooting

### PIN Setup Fails
- Check CloudWatch logs: `/aws/lambda/passbook-api`
- Verify DynamoDB table exists and Lambda has permissions

### 401 Unauthorized
- Session expired (24h limit)
- Clear browser sessionStorage and re-authenticate

### 403 Forbidden
- Request origin doesn't match allowed origin
- Direct API access attempted (not from app)

### 429 Too Many Requests
- API rate limit exceeded (5 req/sec)
- Wait and retry

---

## License

MIT
