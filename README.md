# Kids Passbook App

A simple, secure passbook application for tracking a child's allowance and expenses.

## Features

- Monthly $100 allowance automatically added
- Track expenses with descriptions
- View monthly history
- PIN-protected access
- Mobile-friendly responsive design

## Architecture

- **Frontend**: Static HTML/CSS/JavaScript hosted on GitHub Pages
- **Backend**: AWS Lambda (Go) with API Gateway
- **Database**: DynamoDB (single table design)
- **Infrastructure**: CloudFormation

## Deployment

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. GitHub repository with Pages enabled

### Step 1: Bootstrap AWS Infrastructure

Deploy the bootstrap stack to create the S3 bucket and GitHub OIDC provider:

```bash
aws cloudformation deploy \
  --template-file infrastructure/bootstrap.yaml \
  --stack-name passbook-bootstrap \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-west-2
```

### Step 2: Configure GitHub Secrets

Add the following secret to your GitHub repository:

- `AWS_ACCOUNT_ID`: Your AWS account ID

After the backend deploys, add this repository variable:

- `API_ENDPOINT`: The API Gateway URL (shown in deployment output)

### Step 3: Enable GitHub Pages

1. Go to repository Settings > Pages
2. Set Source to "GitHub Actions"

### Step 4: Push to Deploy

Push to `main` branch to trigger deployments:

```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

## Security

- PIN authentication with Argon2 hashing
- Rate limiting on PIN attempts (5 attempts per 15 min)
- Account lockout after 10 failed attempts
- Strict CORS (only GitHub Pages origin allowed)
- Origin header validation
- Session tokens with 24-hour expiry
- All data encrypted at rest (DynamoDB SSE)
- HTTPS enforced
- Tight API Gateway throttling (5 req/sec, 10 burst)

## Cost

Estimated monthly cost: **~$0.05** (mostly within AWS free tier)

- DynamoDB: On-demand pricing
- Lambda: 128MB ARM64
- API Gateway: HTTP API v2
- No idle costs - pay only for usage

## Local Development

### Backend

```bash
cd backend
go mod download
go test ./...
```

### Frontend

Open `frontend/index.html` in a browser (API calls will fail without backend).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/auth/status | Check if PIN is set up |
| POST | /api/auth/setup | Set up initial PIN |
| POST | /api/auth/verify | Verify PIN and get session |
| POST | /api/auth/change | Change PIN |
| GET | /api/balance | Get total balance |
| GET | /api/month/{yyyy-mm} | Get month data with expenses |
| GET | /api/months | List all months |
| POST | /api/expense | Add expense |
| DELETE | /api/expense/{month}/{id} | Delete expense |

## License

MIT
