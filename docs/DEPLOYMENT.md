# Passbook Deployment Guide

This guide walks you through deploying Passbook to your own AWS account with GitHub Actions CI/CD.

## Prerequisites

- AWS Account with admin access
- GitHub account
- AWS CLI installed and configured
- SAM CLI installed
- GitHub CLI (`gh`) installed (optional, for easier secret management)

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/passbook.git
cd passbook
```

### 2. Set Up AWS IAM User for GitHub Actions

Run the automated setup script:

```bash
chmod +x scripts/setup-github-actions-iam.sh
./scripts/setup-github-actions-iam.sh
```

This script will:
- Create a new IAM user named `github-actions-passbook`
- Create and attach the necessary IAM policy
- Generate access keys
- Output the credentials for GitHub Secrets

**Save the output!** You'll need the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for the next step.

### 3. Configure GitHub Secrets

#### Option A: Using GitHub CLI (Recommended)

```bash
# Set AWS credentials
gh secret set AWS_ACCESS_KEY_ID --body "YOUR_ACCESS_KEY_ID"
gh secret set AWS_SECRET_ACCESS_KEY --body "YOUR_SECRET_ACCESS_KEY"
gh secret set AWS_ACCOUNT_ID --body "YOUR_AWS_ACCOUNT_ID"

# Set SMTP credentials (optional, for email notifications)
gh secret set SMTP_USER --body "your-smtp-username"
gh secret set SMTP_PASSWORD --body "your-smtp-password"
gh secret set SMTP_FROM --body "noreply@yourdomain.com"
```

#### Option B: Using GitHub Web UI

1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Add the following secrets:
   - `AWS_ACCESS_KEY_ID`: From step 2
   - `AWS_SECRET_ACCESS_KEY`: From step 2
   - `AWS_ACCOUNT_ID`: Your 12-digit AWS account ID
   - `SMTP_USER`: (Optional) SMTP username for emails
   - `SMTP_PASSWORD`: (Optional) SMTP password
   - `SMTP_FROM`: (Optional) Sender email address

### 4. Configure GitHub Pages

```bash
# Enable GitHub Pages (using gh CLI)
gh api repos/:owner/:repo/pages -X POST -f build_type=workflow -f source[branch]=gh-pages
```

Or manually:
1. Go to Settings → Pages
2. Source: Deploy from a branch
3. Branch: `gh-pages` / `/ (root)`

### 5. Deploy Backend Locally (First Time)

Before pushing to GitHub, deploy the backend once locally to create the initial stack:

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
chmod +x deploy-sam.sh
./deploy-sam.sh development us-west-2
```

This creates the CloudFormation stack and resources.

### 6. Push to GitHub

```bash
git add .
git commit -m "Initial deployment setup"
git push origin main
```

This will trigger:
- Backend deployment workflow (tests + SAM deploy)
- Frontend deployment workflow (GitHub Pages)

### 7. Get Your API URL

After deployment completes:

```bash
aws cloudformation describe-stacks \
  --stack-name passbook-development \
  --region us-west-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text
```

Update `web-dashboard/app.js` with your API URL if it's different.

## Manual Deployment

### Backend Only

```bash
cd backend
source venv/bin/activate
./deploy-sam.sh development us-west-2
```

### Frontend Only

The frontend is automatically deployed to GitHub Pages on push, but you can also manually deploy:

```bash
# This is handled by GitHub Actions, but for local testing:
cd web-dashboard
# Just open index.html in a browser
```

## Testing Locally

### Backend Tests

```bash
cd backend
source venv/bin/activate
pytest tests/
```

### API Testing

```bash
# Get your API URL
API_URL=$(aws cloudformation describe-stacks \
  --stack-name passbook-development \
  --region us-west-2 \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

# Test health endpoint
curl $API_URL/health
```

## Accessing the Application

- **Frontend**: https://yourusername.github.io/passbook/
- **Backend API**: Check CloudFormation outputs for the API Gateway URL

## Default Test Account

After first deployment, create a parent account:

```bash
# Use the API or the frontend registration
# Default test account in development:
# Email: support@embeddedinn.com
# Password: Passbook2025!
```

## Troubleshooting

### GitHub Actions Failing

1. **Check IAM Permissions**: Ensure the GitHub Actions user has all necessary permissions
2. **Check Secrets**: Verify all required secrets are set in GitHub
3. **Check CloudFormation**: Look for stack errors in AWS CloudFormation console

### Backend Deployment Errors

```bash
# View CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name passbook-development \
  --region us-west-2 \
  --max-items 20

# View Lambda logs
sam logs -n CreateParentFunction --stack-name passbook-development --tail
```

### Frontend Not Loading

1. Check GitHub Pages is enabled
2. Verify the `gh-pages` branch exists
3. Check the API URL in `web-dashboard/app.js` matches your backend

## Cost Considerations

Passbook uses the following AWS resources:
- Lambda (Free tier: 1M requests/month)
- API Gateway (Free tier: 1M requests/month)
- DynamoDB (Free tier: 25GB storage, 25 RCU/WCU)
- S3 (Minimal, for SAM deployments)
- Secrets Manager (~$0.40/month per secret)
- CloudWatch Logs (Free tier: 5GB ingestion)

Estimated monthly cost for light usage: **$1-5/month**

## Cleanup

To delete all resources:

```bash
# Delete the CloudFormation stack
aws cloudformation delete-stack --stack-name passbook-development --region us-west-2

# Delete S3 deployment buckets
aws s3 rb s3://passbook-sam-deployments-YOUR_ACCOUNT_ID-us-west-2 --force

# Delete IAM user (if no longer needed)
aws iam delete-access-key --user-name github-actions-passbook --access-key-id YOUR_KEY_ID
aws iam detach-user-policy --user-name github-actions-passbook --policy-arn arn:aws:iam::YOUR_ACCOUNT_ID:policy/PassbookGitHubActionsPolicy
aws iam delete-user --user-name github-actions-passbook
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/yourusername/passbook/issues
- Documentation: https://github.com/yourusername/passbook/docs/

