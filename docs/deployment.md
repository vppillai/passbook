# Passbook Deployment Guide

Complete guide for deploying the Passbook application to AWS and GitHub Pages.

## Prerequisites

### Required Tools

1. **Node.js** 18+ and npm 8+
   ```bash
   node --version  # Should be 18.x or higher
   npm --version   # Should be 8.x or higher
   ```

2. **Python** 3.11+
   ```bash
   python3 --version  # Should be 3.11.x or higher
   ```

3. **AWS CLI** v2
   ```bash
   aws --version  # Should be aws-cli/2.x
   aws configure  # Set up your AWS credentials
   ```

4. **AWS SAM CLI**
   ```bash
   # Install via pip
   pip install aws-sam-cli

   # Or via Homebrew (macOS)
   brew install aws-sam-cli

   # Verify installation
   sam --version
   ```

5. **Docker** (for SAM builds)
   ```bash
   docker --version
   ```

6. **Expo CLI** (for mobile builds)
   ```bash
   npm install -g expo-cli
   ```

### AWS Account Setup

1. **Create AWS Account** if you don't have one
2. **Configure AWS credentials**:
   ```bash
   aws configure
   # Enter your AWS Access Key ID
   # Enter your AWS Secret Access Key
   # Enter default region: us-west-2
   # Enter default output format: json
   ```

3. **Verify credentials**:
   ```bash
   aws sts get-caller-identity
   ```

### SMTP Configuration

You need an SMTP server for sending emails. The project is configured for Zoho Mail, but you can use any SMTP service.

**Zoho Mail Setup**:
1. Sign up at https://www.zoho.com/mail/
2. Create an app-specific password
3. Keep credentials ready for deployment

**Alternative SMTP Providers**:
- SendGrid
- AWS SES (Simple Email Service)
- Gmail (with app password)
- Mailgun

## Backend Deployment

### Step 1: Prepare Backend

```bash
cd passbook/backend

# Install Python dependencies
pip install -r requirements.txt
```

### Step 2: Deploy Infrastructure with SAM

```bash
# Deploy to development environment
./deploy-sam.sh development us-west-2

# You will be prompted for:
# - SMTP username (your email)
# - SMTP password (app-specific password)
# - SMTP from address (defaults to username)
```

The script will:
1. ✅ Build all Lambda functions
2. ✅ Package dependencies
3. ✅ Create S3 bucket for deployments
4. ✅ Deploy CloudFormation stack
5. ✅ Create all resources:
   - DynamoDB tables
   - Lambda functions
   - API Gateway
   - Secrets Manager secrets
   - IAM roles
   - S3 backup bucket

### Step 3: Note the API URL

After successful deployment, you'll see:

```
API Endpoint: https://abc123xyz.execute-api.us-west-2.amazonaws.com/development
```

**Save this URL** - you'll need it for frontend configuration.

### Step 4: Verify Deployment

Test the API:

```bash
# Test signup endpoint
curl https://YOUR-API-URL/auth/signup \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "test@example.com",
    "password": "Test1234!",
    "displayName": "Test User"
  }'
```

Expected response:
```json
{
  "message": "Account created. Please check your email to verify your account.",
  "userId": "...",
  "email": "test@example.com"
}
```

## Frontend Deployment

### Step 1: Configure Environment

```bash
cd passbook  # Root directory

# Create environment file
cp .env.example .env.local

# Edit .env.local with your API URL
nano .env.local
```

Update `.env.local`:
```env
EXPO_PUBLIC_API_URL=https://YOUR-API-URL.execute-api.us-west-2.amazonaws.com/development
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Build and Deploy Web App

#### Option A: Deploy to GitHub Pages

```bash
# Build web version
npm run build:web

# Deploy to GitHub Pages (manual)
# The web-build/ directory contains the static site

# Or use the GitHub Action (automatic)
git push origin main
# GitHub Actions will automatically deploy to GitHub Pages
```

#### Option B: Deploy to Custom Hosting

```bash
# Build web version
npm run build:web

# Upload web-build/ directory to your hosting provider
# (Netlify, Vercel, S3 + CloudFront, etc.)
```

### Step 4: Configure GitHub Pages (if using)

1. Go to repository **Settings** → **Pages**
2. Set **Source** to `gh-pages` branch
3. Your app will be available at: `https://YOUR-USERNAME.github.io/passbook/`

### Step 5: Build Mobile Apps (Optional)

#### Android Build

```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Configure project
eas build:configure

# Build APK/AAB
eas build --platform android

# Submit to Google Play Store
eas submit --platform android
```

#### iOS Build (requires macOS)

```bash
# Build for iOS
eas build --platform ios

# Submit to App Store
eas submit --platform ios
```

## Environment Management

### Development Environment

```bash
# Deploy backend
cd backend
./deploy-sam.sh development us-west-2

# Run frontend locally
cd ..
npm start
# Press 'w' for web, 'i' for iOS, 'a' for Android
```

### Staging Environment

```bash
# Deploy backend to staging
cd backend
./deploy-sam.sh staging us-west-2

# Update frontend .env.staging
EXPO_PUBLIC_API_URL=https://staging-api-url/staging

# Build with staging config
npm run build:web -- --profile staging
```

### Production Environment

```bash
# Deploy backend to production
cd backend
./deploy-sam.sh production us-west-2

# Update frontend .env.production
EXPO_PUBLIC_API_URL=https://production-api-url/production

# Build for production
npm run build:web -- --profile production
```

## Monitoring and Maintenance

### View Logs

```bash
# View Lambda logs
sam logs --stack-name passbook-development --tail

# View specific function logs
aws logs tail /aws/lambda/passbook-development-signup --follow
```

### View Metrics

```bash
# CloudWatch dashboard
aws cloudwatch get-dashboard --dashboard-name passbook-development

# API Gateway metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApiGateway \
  --metric-name Count \
  --dimensions Name=ApiName,Value=passbook-development-api \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-01T23:59:59Z \
  --period 3600 \
  --statistics Sum
```

### Update Backend Code

```bash
cd backend

# Make code changes
# ...

# Redeploy (only changed functions are updated)
./deploy-sam.sh development us-west-2
```

### Update Frontend Code

```bash
# Make code changes
# ...

# Rebuild and deploy
npm run build:web
# Commit and push for automatic deployment via GitHub Actions
```

## Backup and Recovery

### Manual Backup

```bash
# Backup DynamoDB tables
aws dynamodb create-backup \
  --table-name passbook-development-families \
  --backup-name families-backup-$(date +%Y%m%d-%H%M%S)

aws dynamodb create-backup \
  --table-name passbook-development-transactions \
  --backup-name transactions-backup-$(date +%Y%m%d-%H%M%S)
```

### Restore from Backup

```bash
# List backups
aws dynamodb list-backups --table-name passbook-development-families

# Restore
aws dynamodb restore-table-from-backup \
  --target-table-name passbook-development-families-restored \
  --backup-arn arn:aws:dynamodb:us-west-2:123456789:table/passbook-development-families/backup/01234567890
```

## Teardown

### Delete All Resources

```bash
# Delete CloudFormation stack (deletes everything)
aws cloudformation delete-stack --stack-name passbook-development --region us-west-2

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name passbook-development --region us-west-2

# Delete deployment artifacts bucket (if needed)
aws s3 rb s3://passbook-sam-deployments-YOUR-ACCOUNT-ID-us-west-2 --force
```

## Troubleshooting

### Issue: SAM build fails

**Solution**: Make sure Docker is running
```bash
docker ps  # Should list running containers
```

### Issue: Deployment fails with "No changes to deploy"

**Solution**: This is normal if no changes were made. Use `--force-upload` to redeploy anyway.

### Issue: API returns 403 Forbidden

**Possible causes**:
1. JWT token expired (tokens expire after 15 minutes)
2. Invalid authentication token
3. CORS issue (check browser console)

**Solution**:
- Check CloudWatch logs for the Lambda function
- Verify API Gateway CORS configuration

### Issue: Email not sending

**Possible causes**:
1. Invalid SMTP credentials
2. Secrets Manager not accessible
3. Email service blocking requests

**Solution**:
```bash
# Check secrets
aws secretsmanager get-secret-value \
  --secret-id passbook/development/smtp-credentials

# Check Lambda logs
aws logs tail /aws/lambda/passbook-development-signup --follow
```

### Issue: Frontend can't connect to backend

**Possible causes**:
1. Wrong API URL in .env.local
2. API not deployed
3. CORS issue

**Solution**:
1. Verify API URL:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name passbook-development \
     --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
     --output text
   ```
2. Test API directly with curl
3. Check browser console for CORS errors

## Cost Estimation

### AWS Costs (Pay-per-use)

**Expected costs for low to moderate usage**:

- **DynamoDB**: Pay-per-request pricing
  - First 25 GB storage: Free
  - First 2.5M reads/writes per month: Free
  - Beyond free tier: ~$1.25 per million writes, $0.25 per million reads

- **Lambda**:
  - First 1M requests: Free
  - First 400,000 GB-seconds: Free
  - Beyond free tier: $0.20 per million requests

- **API Gateway**:
  - First 1M requests: Free (first 12 months)
  - Beyond: $3.50 per million requests

- **Secrets Manager**: $0.40 per secret per month

- **S3**:
  - First 5 GB: Free (first 12 months)
  - Beyond: $0.023 per GB

**Estimated monthly cost for small family deployment**: **$0-5**
**Estimated monthly cost for 100 families**: **$15-30**

## Security Best Practices

1. **Never commit credentials** - Use Secrets Manager and environment variables
2. **Enable CloudTrail** - Audit all AWS API calls
3. **Use strong passwords** - Enforce password policies
4. **Enable MFA** - For AWS console access
5. **Regular backups** - Automated DynamoDB backups
6. **Monitor logs** - Set up CloudWatch alarms for errors
7. **Update dependencies** - Regular security updates
8. **Rate limiting** - API Gateway throttling configured
9. **Input validation** - All endpoints validate input
10. **Token expiration** - JWT tokens expire after 15 minutes

## Support

For issues and questions:
- GitHub Issues: https://github.com/vppillai/passbook/issues
- Email: support@embeddedinn.com
- Documentation: See README.md and other docs/ files
