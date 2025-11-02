# Complete Email Service Deployment Guide

This guide covers the complete deployment of the email service for password reset functionality.

## Overview

The email service consists of:
1. **AWS Secrets Manager** - Stores Zoho SMTP password securely
2. **Lambda Function** - Handles email sending
3. **API Gateway** - Provides HTTP endpoint for the frontend
4. **Frontend Integration** - Updated email service to call API

## Prerequisites

- AWS CLI installed and configured
- AWS account with appropriate permissions
- Zoho SMTP password: `[REDACTED - Set via environment variable or AWS Secrets Manager]`
- Node.js installed (for Lambda packaging)

## Step-by-Step Deployment

### Step 1: Deploy CloudFormation Stack

This creates all infrastructure including:
- Secrets Manager secret (with password already stored)
- Lambda function (placeholder code)
- API Gateway with `/api/email/send` endpoint
- IAM roles and permissions

```bash
cd aws/scripts
./deploy.sh -e production -r us-east-1
```

**Note**: The Lambda function will initially have placeholder code. You'll deploy the actual code in Step 2.

### Step 2: Package and Deploy Lambda Function Code

```bash
cd aws/lambda/email-service
npm install
./package-lambda.sh

# Deploy the packaged function
cd ../../scripts
./deploy-lambda.sh production us-east-1
```

Or manually:

```bash
cd aws/lambda/email-service
npm install --production
zip -r function.zip index.js node_modules/

aws lambda update-function-code \
  --function-name allowance-passbook-production-email-service \
  --zip-file fileb://function.zip \
  --region us-east-1
```

### Step 3: Get API Gateway URL

After CloudFormation deployment, get the API endpoint:

```bash
aws cloudformation describe-stacks \
  --stack-name allowance-passbook-production \
  --query 'Stacks[0].Outputs[?OutputKey==`EmailServiceEndpoint`].OutputValue' \
  --output text
```

Or find it in the AWS Console:
- API Gateway → allowance-passbook-production-api → Stages → v1
- Look for the Invoke URL and append `/api/email/send`

### Step 4: Configure Frontend

Add the API endpoint to your frontend environment:

**Option A: Environment Variable (Recommended)**

Create `.env.production` in `frontend/`:

```bash
VITE_EMAIL_API_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/v1/api/email/send
```

Replace `<api-id>` with your actual API Gateway ID.

**Option B: Build-time Configuration**

Add to `vite.config.ts`:

```typescript
export default defineConfig({
  // ... existing config
  define: {
    'import.meta.env.VITE_EMAIL_API_URL': JSON.stringify(
      process.env.VITE_EMAIL_API_URL || 'https://your-api-id.execute-api.us-east-1.amazonaws.com/v1/api/email/send'
    ),
  },
});
```

### Step 5: Test the Complete Flow

1. **Test Lambda Function Directly**:

```bash
aws lambda invoke \
  --function-name allowance-passbook-production-email-service \
  --payload '{
    "body": "{\"to\":\"test@example.com\",\"resetToken\":\"test-token-123\",\"accountType\":\"parent\",\"baseUrl\":\"https://vppillai.github.io/passbook\"}"
  }' \
  response.json

cat response.json
```

2. **Test API Gateway Endpoint**:

```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/v1/api/email/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test@example.com",
    "resetToken": "test-token-123",
    "accountType": "parent",
    "baseUrl": "https://vppillai.github.io/passbook"
  }'
```

3. **Test from Frontend**:

- Go to Login page
- Click "Forgot password?"
- Enter email address
- Check email inbox for password reset link

## Architecture Diagram

```
Frontend (GitHub Pages)
  ↓ HTTPS POST
API Gateway (/api/email/send)
  ↓ Invoke
Lambda Function (Email Service)
  ↓ Get Secret
Secrets Manager (Zoho SMTP Password)
  ↓ Send Email
Zoho SMTP Server (smtp.zoho.in:587)
```

## Cost Breakdown

| Service | Cost |
|---------|------|
| Secrets Manager | $0.40/month per secret |
| Lambda | $0.20 per 1M requests |
| API Gateway | $3.50 per 1M requests |
| **Total (low usage)** | ~$0.50/month |

For typical usage (100-1000 emails/month):
- Lambda: ~$0.00 (free tier covers)
- API Gateway: ~$0.00 (free tier covers)
- Secrets Manager: $0.40/month
- **Total: ~$0.40/month**

## Monitoring

### CloudWatch Logs

View Lambda function logs:

```bash
aws logs tail /aws/lambda/allowance-passbook-production-email-service --follow
```

### CloudWatch Metrics

Monitor:
- Lambda invocations and errors
- API Gateway requests and latency
- Secrets Manager API calls

## Troubleshooting

### Lambda Function Not Working

1. Check CloudWatch logs for errors
2. Verify secret exists: `aws secretsmanager describe-secret --secret-id "allowance-passbook/production/zoho-smtp-password"`
3. Verify IAM role has Secrets Manager permissions
4. Test SMTP locally: `npm run test:smtp` in `frontend/`

### API Gateway 500 Error

1. Check Lambda function logs
2. Verify Lambda permission allows API Gateway to invoke
3. Check CORS configuration
4. Test Lambda directly (bypass API Gateway)

### Email Not Received

1. Check spam/junk folder
2. Verify recipient email is correct
3. Check Zoho Mail logs (if available)
4. Test SMTP connection: `npm run test:smtp`
5. Verify SMTP password in Secrets Manager

### CORS Errors in Browser

1. Ensure API Gateway has CORS enabled
2. Check response headers include `Access-Control-Allow-Origin: *`
3. Verify OPTIONS method is configured in API Gateway

## Security Checklist

- ✅ Password stored in AWS Secrets Manager (not in code)
- ✅ Lambda has least-privilege IAM role
- ✅ API Gateway uses HTTPS
- ✅ CORS configured appropriately
- ✅ No sensitive data in logs
- ✅ Email tokens expire after 1 hour

## Next Steps

1. **Add Rate Limiting**: Configure API Gateway throttling
2. **Add API Keys**: Require API key for email service
3. **Add Monitoring**: Set up CloudWatch alarms
4. **Add Retry Logic**: Handle transient SMTP failures
5. **Add Email Templates**: Create more email templates

## Rollback Procedure

If something goes wrong:

1. **Revert Frontend Changes**:
   ```bash
   git revert <commit-hash>
   ```

2. **Delete API Gateway Endpoint** (if needed):
   ```bash
   aws apigateway delete-rest-api --rest-api-id <api-id>
   ```

3. **Delete Lambda Function**:
   ```bash
   aws lambda delete-function --function-name allowance-passbook-production-email-service
   ```

4. **Keep Secrets Manager**: Don't delete the secret (can be reused)

## Support

For issues or questions:
1. Check CloudWatch logs
2. Review this documentation
3. Test SMTP connection locally
4. Verify AWS credentials and permissions

