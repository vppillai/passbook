# Email Service - Quick Start

## ✅ What's Been Implemented

1. **AWS Secrets Manager** - Zoho SMTP password stored securely
2. **Lambda Function** - Complete email sending service (`aws/lambda/email-service/`)
3. **API Gateway** - HTTP endpoint at `/api/email/send`
4. **CloudFormation** - Full infrastructure as code
5. **Frontend Integration** - Configurable API endpoint via `VITE_EMAIL_API_URL`

## 🚀 Quick Deployment

### 1. Deploy Infrastructure

```bash
cd aws/scripts
./deploy.sh -e production -r us-east-1
```

### 2. Deploy Lambda Code

```bash
cd aws/lambda/email-service
npm install
./package-lambda.sh
cd ../../scripts
./deploy-lambda.sh production us-east-1
```

### 3. Get API URL

```bash
aws cloudformation describe-stacks \
  --stack-name allowance-passbook-production \
  --query 'Stacks[0].Outputs[?OutputKey==`EmailServiceEndpoint`].OutputValue' \
  --output text
```

### 4. Configure Frontend

Add to `.env.production`:

```
VITE_EMAIL_API_URL=https://<api-id>.execute-api.us-east-1.amazonaws.com/v1/api/email/send
```

## 📁 File Structure

```
aws/
├── cloudformation/
│   └── templates/
│       └── main-template.yaml          # Infrastructure (Lambda, API Gateway, Secrets)
├── lambda/
│   └── email-service/
│       ├── index.js                    # Lambda function code
│       ├── package.json                # Dependencies
│       └── package-lambda.sh          # Packaging script
├── scripts/
│   ├── deploy-lambda.sh                # Deploy Lambda code
│   ├── create-smtp-secret.sh           # Create secret
│   └── update-smtp-secret.sh           # Update secret
├── DEPLOYMENT-COMPLETE.md               # Full deployment guide
└── README-EMAIL-SERVICE.md              # This file
```

## 🔧 Testing

### Test Lambda Directly

```bash
aws lambda invoke \
  --function-name allowance-passbook-production-email-service \
  --payload '{"body":"{\"to\":\"test@example.com\",\"resetToken\":\"test\",\"accountType\":\"parent\",\"baseUrl\":\"https://vppillai.github.io/passbook\"}"}' \
  response.json
```

### Test API Gateway

```bash
curl -X POST https://<api-id>.execute-api.us-east-1.amazonaws.com/v1/api/email/send \
  -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","resetToken":"test","accountType":"parent","baseUrl":"https://vppillai.github.io/passbook"}'
```

## 📝 Next Steps

See `DEPLOYMENT-COMPLETE.md` for detailed instructions, troubleshooting, and security checklist.

