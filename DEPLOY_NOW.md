# Deploy Passbook - Step by Step

**Status**: ✅ Code pushed to GitHub  
**Prerequisites**: ✅ All tools installed  
**Ready to Deploy**: YES

---

## 🚀 Deploy Backend (5-10 minutes)

### Step 1: Prepare SMTP Credentials

You need SMTP credentials for sending emails. Using Zoho Mail as configured:

**Option A: Use existing Zoho credentials**
- Email: `support@embeddedinn.com`
- Password: (from requirements.md line 139: `pcP3p67YeZgu`)

**Option B: Use your own SMTP server**
- Any SMTP service (Zoho, Gmail, SendGrid, AWS SES)

### Step 2: Deploy

```bash
cd /home/vpillai/temp/passbook/backend
./deploy-sam.sh development us-west-2
```

When prompted:
- **SMTP username**: Your email address
- **SMTP password**: Your SMTP password
- **SMTP from**: Your email address (or just press Enter)

### Step 3: Save API URL

After successful deployment, you'll see:
```
API Endpoint: https://abc123xyz.execute-api.us-west-2.amazonaws.com/development
```

**Copy this URL!** You'll need it next.

---

## 🎨 Configure & Test Frontend

### Step 4: Configure Environment

```bash
cd /home/vpillai/temp/passbook
cp .env.example .env.local
```

Edit `.env.local` and paste your API URL:
```bash
nano .env.local
# Change this:
# EXPO_PUBLIC_API_URL=https://your-api-id.execute-api.us-west-2.amazonaws.com/development
# To your actual API URL
```

### Step 5: Test API

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

Expected response: `201 Created` with message about verification email.

### Step 6: Run Frontend Locally

```bash
npm start
```

Press:
- `w` for web browser
- `a` for Android emulator
- `i` for iOS simulator

---

## ✅ Verify Deployment

### Check CloudFormation Stack

```bash
aws cloudformation describe-stacks \
  --stack-name passbook-development \
  --region us-west-2 \
  --query 'Stacks[0].StackStatus'
```

Should return: `CREATE_COMPLETE` or `UPDATE_COMPLETE`

### Check Lambda Functions

```bash
aws lambda list-functions \
  --region us-west-2 \
  --query 'Functions[?starts_with(FunctionName, `passbook-development`)].FunctionName' \
  --output table
```

Should show all 17 Lambda functions.

### Check DynamoDB Tables

```bash
aws dynamodb list-tables \
  --region us-west-2 \
  --query 'TableNames[?starts_with(@, `passbook-development`)]' \
  --output table
```

Should show 3 tables: families, transactions, auth.

### Run Backend Tests

```bash
cd /home/vpillai/temp/passbook/backend
source venv/bin/activate
PYTHONPATH=$PWD python -m pytest tests/unit/ -v
```

Expected: ✅ 32/32 tests passing

---

## 🔄 GitHub Actions Workflows

The code is now on GitHub. Workflows will run automatically on next push to main:

### Check Workflow Status

Visit: https://github.com/vppillai/passbook/actions

You should see:
- ✅ Deploy Backend (will run on backend/ changes)
- ✅ Deploy Web (will run on src/ changes)

### Configure GitHub Secrets (for workflows to work)

Go to: https://github.com/vppillai/passbook/settings/secrets/actions

Add these secrets:
1. `AWS_ACCESS_KEY_ID` - Your AWS access key
2. `AWS_SECRET_ACCESS_KEY` - Your AWS secret key
3. `SMTP_USER` - Your SMTP username
4. `SMTP_PASSWORD` - Your SMTP password
5. `SMTP_FROM` - Your from email address
6. `API_URL` - Your deployed API URL (from Step 3)
7. `API_KEY` - (optional) API key if you want additional security

---

## 🧪 Manual Testing Checklist

Once deployed, test these flows:

### Authentication Flow
```bash
# 1. Signup
curl https://YOUR-API-URL/auth/signup \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"real@email.com","password":"Test1234!","displayName":"Test User"}'

# 2. Check email for verification link
# 3. Click verification link
# 4. Login
curl https://YOUR-API-URL/auth/login \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"email":"real@email.com","password":"Test1234!"}'

# Save the token from response
```

### Family & Child Management
```bash
# Create family (use token from login)
curl https://YOUR-API-URL/families \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR-TOKEN' \
  -d '{"familyName":"Test Family","currency":"CAD","timezone":"America/Vancouver"}'

# Create child
curl https://YOUR-API-URL/children \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR-TOKEN' \
  -d '{"username":"testchild","displayName":"Test Child","password":"Child123!","initialBalance":50}'
```

### Transactions
```bash
# Add funds
curl https://YOUR-API-URL/funds \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR-TOKEN' \
  -d '{"childUserId":"CHILD-USER-ID","amount":20,"reason":"Allowance"}'

# Add expense
curl https://YOUR-API-URL/expenses \
  -X POST \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR-TOKEN' \
  -d '{"childUserId":"CHILD-USER-ID","amount":5.50,"category":"snacks","description":"Ice cream"}'
```

---

## 📊 Monitoring

### View Logs

```bash
# All Lambda logs
sam logs --stack-name passbook-development --tail

# Specific function
aws logs tail /aws/lambda/passbook-development-signup --follow
```

### Check Metrics

Visit AWS CloudWatch Console:
```
https://console.aws.amazon.com/cloudwatch/home?region=us-west-2
```

---

## 🎯 Next Steps After Deployment

### Immediate
- [ ] Deploy backend ✅
- [ ] Test API endpoints ✅
- [ ] Configure GitHub secrets ✅
- [ ] Run manual tests ✅
- [ ] Verify frontend works ✅

### Before Production
- [ ] Replace placeholder assets (icons, splash screens)
- [ ] Test email flow thoroughly
- [ ] Set up CloudWatch alarms
- [ ] Configure custom domain for API
- [ ] Set up automated backups
- [ ] Security audit
- [ ] Load testing

### Production Deployment
```bash
cd backend
./deploy-sam.sh production us-west-2
```

Then update frontend with production API URL and deploy.

---

## 🆘 Troubleshooting

### "SAM build failed"
Docker not running. Start Docker:
```bash
sudo systemctl start docker  # Linux
# or open Docker Desktop
```

### "Stack already exists"
Update instead of create:
```bash
# Delete and redeploy
aws cloudformation delete-stack --stack-name passbook-development --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name passbook-development --region us-west-2
./deploy-sam.sh development us-west-2
```

### "Email not sending"
Check SMTP credentials in Secrets Manager:
```bash
aws secretsmanager get-secret-value \
  --secret-id passbook/development/smtp-credentials \
  --region us-west-2
```

### "API returns 403/401"
- JWT token expired (expires after 15 min)
- Invalid token
- CORS issue (check browser console)

---

## 💰 Cost Monitoring

Check current AWS costs:
```bash
aws ce get-cost-and-usage \
  --time-period Start=2025-11-01,End=2025-11-07 \
  --granularity DAILY \
  --metrics UnblendedCost \
  --filter file://<(echo '{"Tags":{"Key":"Project","Values":["passbook"]}}')
```

---

## ✅ Success Criteria

Deployment is successful when:
- ✅ CloudFormation stack status is `CREATE_COMPLETE`
- ✅ All 17 Lambda functions created
- ✅ API returns `200/201` for valid requests
- ✅ DynamoDB tables created and accessible
- ✅ Secrets stored correctly
- ✅ Frontend can connect to API
- ✅ Test user can signup, verify, and login
- ✅ All backend tests passing

---

**Ready to deploy? Run the commands in Step 2! 🚀**

