# Backend-Frontend Configuration Sync

This document explains how backend changes automatically update the frontend configuration.

## Overview

When the CloudFormation stack is updated (new Lambda functions, API Gateway endpoints, etc.), the frontend needs to know about the new API endpoints. This is handled automatically through:

1. **CloudFormation Outputs** - Stack outputs export all API endpoints
2. **GitHub Actions Workflow** - Automatically syncs outputs to frontend `.env.production`
3. **Automatic Frontend Rebuild** - Frontend rebuilds when configuration changes

## How It Works

### 1. CloudFormation Stack Updates

When you update the backend stack:

```bash
cd aws/scripts
./deploy.sh -e production -r us-west-2
```

CloudFormation automatically:
- Creates/updates API Gateway resources (routes, methods, CORS)
- Creates/updates Lambda functions
- Exports endpoint URLs as stack outputs

### 2. Automatic Sync (GitHub Actions)

The `.github/workflows/sync-backend-config.yml` workflow:

- **Runs daily** at 2 AM UTC to catch manual backend changes
- **Can be triggered manually** from GitHub Actions UI
- Fetches CloudFormation stack outputs
- Updates `frontend/.env.production` with new API endpoints
- Commits changes (if any) to trigger frontend rebuild

### 3. Manual Sync (Local Script)

If you want to sync immediately after deploying:

```bash
cd aws/scripts
./sync-frontend-config.sh production us-west-2
git add frontend/.env.production
git commit -m "chore: update API endpoints from backend"
git push
```

## Setup

### GitHub Actions Setup

1. **Create AWS IAM Role for GitHub Actions**:
   ```bash
   # Create an IAM role that GitHub Actions can assume
   # See: https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services
   ```

2. **Add GitHub Secrets**:
   - `AWS_ROLE_TO_ASSUME` - ARN of the IAM role for GitHub Actions

3. **Enable Workflow**:
   - The workflow is already configured
   - Go to Actions → "Sync Backend API Configuration"
   - Click "Run workflow" to test

### Manual Sync Script

The script requires:
- AWS CLI configured with appropriate permissions
- `jq` installed (`brew install jq` or `apt-get install jq`)

## CloudFormation Outputs

The stack exports these outputs (used by sync):

- `ApiGatewayBaseUrl` - Base API URL
- `EmailServiceEndpoint` - Email service endpoint
- `AuthLoginEndpoint` - Authentication login endpoint
- `AuthValidateEndpoint` - Token validation endpoint

## Workflow

```
┌─────────────────────┐
│  Deploy Backend     │
│  (CloudFormation)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Stack Outputs      │
│  (API Endpoints)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  GitHub Actions     │
│  Sync Workflow      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Update             │
│  .env.production    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Commit & Push      │
│  (auto-triggers)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Frontend Rebuild   │
│  (GitHub Pages)     │
└─────────────────────┘
```

## Troubleshooting

### Sync Workflow Fails

1. **Check AWS Credentials**:
   - Verify `AWS_ROLE_TO_ASSUME` secret is set
   - Verify IAM role has `cloudformation:DescribeStacks` permission

2. **Check Stack Name**:
   - Ensure stack name matches: `allowance-passbook-{environment}`
   - Verify stack exists in the specified region

3. **Check Outputs**:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name allowance-passbook-production \
     --query 'Stacks[0].Outputs' \
     --region us-west-2
   ```

### Frontend Not Updating

1. **Check if changes were committed**:
   - Look at workflow logs for "Check for changes"
   - If `changed=false`, endpoints didn't change

2. **Manually trigger deploy**:
   - Go to Actions → "Deploy to GitHub Pages"
   - Click "Run workflow"

3. **Verify .env.production**:
   ```bash
   cat frontend/.env.production
   ```

## Best Practices

1. **Always deploy backend first** - Then let sync update frontend
2. **Review changes** - Check the diff before committing
3. **Test endpoints** - Verify new endpoints work before frontend rebuild
4. **Monitor logs** - Check GitHub Actions logs for sync issues

## Future Enhancements

- [ ] CloudFormation custom resource to trigger GitHub Actions
- [ ] Webhook from CloudFormation to GitHub for immediate sync
- [ ] Multi-environment support (staging, production)
- [ ] Validation of endpoints before updating frontend

