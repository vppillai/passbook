# Email Service Deployment Guide

This guide explains how to deploy and configure the email service for password reset functionality.

## AWS Secrets Manager Setup

The Zoho SMTP password is stored in AWS Secrets Manager for security.

### Secret Details

- **Secret Name**: `allowance-passbook/{environment}/zoho-smtp-password`
- **Contains**:
  ```json
  {
    "password": "pcP3p67YeZgu",
    "host": "smtp.zoho.in",
    "port": "587",
    "secure": "false",
    "user": "support@embeddedinn.com"
  }
  ```

### Method 1: Via CloudFormation (Recommended)

The secret is automatically created when you deploy the CloudFormation stack:

```bash
cd aws/scripts
./deploy.sh -e production -r us-east-1
```

The CloudFormation template (`main-template.yaml`) includes the `ZohoSmtpPasswordSecret` resource.

### Method 2: Via AWS CLI (Manual)

If you need to create or update the secret manually:

```bash
cd aws/scripts
./create-smtp-secret.sh production
# or
./update-smtp-secret.sh production pcP3p67YeZgu
```

### Method 3: Direct AWS CLI

```bash
# Create/update secret directly
aws secretsmanager create-secret \
  --name "allowance-passbook/production/zoho-smtp-password" \
  --secret-string '{
    "password": "pcP3p67YeZgu",
    "host": "smtp.zoho.in",
    "port": "587",
    "secure": "false",
    "user": "support@embeddedinn.com"
  }' \
  --description "Zoho SMTP password for sending password reset emails" \
  --tags Key=Project,Value=allowance-passbook Key=Environment,Value=production
```

## Lambda Function Deployment

### 1. Create Lambda Function

```bash
# Package the function
cd aws/examples
zip -r email-function.zip lambda-email-function.js
npm install nodemailer
zip -r email-function.zip node_modules/
```

### 2. Deploy via AWS CLI

```bash
aws lambda create-function \
  --function-name allowance-passbook-production-email-sender \
  --runtime nodejs18.x \
  --role arn:aws:iam::ACCOUNT_ID:role/allowance-passbook-production-lambda-role \
  --handler lambda-email-function.handler \
  --zip-file fileb://email-function.zip \
  --environment Variables={
    ZOHO_SMTP_SECRET_NAME=allowance-passbook/production/zoho-smtp-password,
    ENVIRONMENT=production
  } \
  --timeout 30 \
  --memory-size 256
```

### 3. Connect to API Gateway

Create an API Gateway endpoint that invokes this Lambda function at `/api/email/send`.

## Testing

### Test Secret Access

```bash
aws secretsmanager get-secret-value \
  --secret-id "allowance-passbook/production/zoho-smtp-password" \
  --query SecretString \
  --output text
```

### Test Lambda Function

```bash
aws lambda invoke \
  --function-name allowance-passbook-production-email-sender \
  --payload '{
    "body": "{
      \"to\": \"test@example.com\",
      \"resetToken\": \"test-token\",
      \"accountType\": \"parent\",
      \"baseUrl\": \"https://vppillai.github.io/passbook\"
    }"
  }' \
  response.json

cat response.json
```

## Security Best Practices

1. **Never commit passwords** to git
2. **Use Secrets Manager** instead of environment variables
3. **Rotate passwords** regularly
4. **Limit access** - Only Lambda functions need read access
5. **Enable logging** - CloudWatch Logs for audit trail

## Cost Considerations

- **Secrets Manager**: $0.40 per secret per month
- **API calls**: $0.05 per 10,000 API calls
- **For typical usage**: ~$0.50/month total

## Troubleshooting

### Secret Not Found

```bash
# Check if secret exists
aws secretsmanager describe-secret \
  --secret-id "allowance-passbook/production/zoho-smtp-password"

# List all secrets
aws secretsmanager list-secrets \
  --filters Key=name,Values=allowance-passbook
```

### Lambda Can't Access Secret

1. Verify IAM role has `secretsmanager:GetSecretValue` permission
2. Check the secret ARN in the IAM policy
3. Ensure Lambda is in the same region as the secret

### Email Not Sending

1. Check Lambda CloudWatch logs
2. Verify SMTP credentials are correct
3. Test SMTP connection locally: `npm run test:smtp`
4. Check Zoho Mail settings for SMTP access

