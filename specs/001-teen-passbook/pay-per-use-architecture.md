# Pay-Per-Use Architecture: Teen Passbook

**Date**: 2025-11-02  
**Principle**: NO fixed monthly costs - pay only for what you use

## Overview

Teen Passbook is designed to have ZERO fixed costs. The app runs on GitHub Pages (free) and only incurs costs when optional cloud sync is used. Even then, all AWS services are strictly pay-per-use.

## Cost Breakdown

### Always Free (GitHub Pages)
- **Hosting**: $0
- **Bandwidth**: $0 (100GB/month free)
- **Storage**: $0 (1GB free)
- **SSL Certificate**: $0
- **Deployment**: $0 (GitHub Actions free tier)

### Optional Backend (Pay-Per-Use Only)

| Service | Pricing | Free Tier | Typical Usage | Monthly Cost |
|---------|---------|-----------|---------------|--------------|
| API Gateway | $3.50/million requests | 1M requests/month | 50K requests | $0 |
| Lambda | $0.20/million requests | 1M requests/month | 50K requests | $0 |
| Lambda | $0.00001667/GB-second | 400,000 GB-seconds/month | Minimal | $0 |
| DynamoDB | $0.25/million read/write | None (but very cheap) | 100K operations | $0.025 |
| CloudWatch | $0.30/GB logs | 5GB/month | Basic logging | $0 |

**Total for typical family**: $0-0.50/month (most stay in free tier)

## Security Without Fixed Costs

### ❌ What We DON'T Use (Fixed Costs)
- AWS WAF ($5/month base fee)
- AWS Cognito ($0.0055/MAU minimum)
- Custom domains with Route 53 ($0.50/month)
- Dedicated IPs or Load Balancers
- AWS Shield Advanced ($3,000/month)

### ✅ What We DO Use (Pay-Per-Use)
1. **API Gateway Built-in Features** (no extra cost)
   - Rate limiting
   - API keys
   - Request validation
   - Usage plans with quotas

2. **Lambda Authorizers** (pay per invocation)
   - Custom bot detection
   - IP tracking
   - Behavioral analysis

3. **Application-Level Security** (in Lambda functions)
   - JWT validation
   - Input sanitization
   - User-scoped queries

## Bot Protection Strategy (Zero Fixed Cost)

### Level 1: API Gateway (Free)
```yaml
throttle:
  rateLimit: 10      # requests per second
  burstLimit: 20     # burst capacity
quota:
  limit: 10000       # requests per day
  period: DAY
```

### Level 2: Lambda Authorizer ($0.0000002 per check)
```javascript
// Only runs when needed
exports.handler = async (event) => {
  // Check for bot patterns
  if (isBot(event)) throw new Error('Unauthorized');
  return generatePolicy('Allow');
};
```

### Level 3: Client-Side Challenges (Free)
```javascript
// Proof-of-work in browser
const proof = await solveChallenge();
headers['X-Proof-Of-Work'] = proof;
```

## Cost Protection Mechanisms

### 1. Hard Limits
- API Gateway: 10,000 requests/day per API key
- Lambda: Concurrent execution limit of 10
- DynamoDB: On-demand with auto-scaling limits

### 2. Monitoring (Free Tier)
```javascript
// CloudWatch alarms (10 free)
- BillingAlarm at $1
- BillingAlarm at $5
- HighErrorRate
- ThrottlingAlert
```

### 3. Circuit Breakers
```javascript
// In Lambda function
if (await isDailyBudgetExceeded()) {
  return { statusCode: 503, body: 'Service temporarily disabled' };
}
```

## Scaling Costs

| Users | Requests/Month | API Gateway | Lambda | DynamoDB | Total |
|-------|----------------|-------------|--------|----------|--------|
| 10 families | 100K | $0 | $0 | $0.025 | $0.025 |
| 100 families | 1M | $0 | $0 | $0.25 | $0.25 |
| 1000 families | 10M | $31.50 | $1.80 | $2.50 | $35.80 |

## Emergency Cost Control

If costs ever spike:

1. **Immediate**: Reduce API Gateway quotas
2. **Quick**: Disable sync features in app
3. **Nuclear**: Delete API Gateway (app continues offline)

## Implementation Guidelines

### Always
- Check AWS Free Tier status before implementing
- Use built-in features over additional services
- Monitor costs daily for first month
- Set conservative limits initially

### Never
- Add services with base monthly fees
- Use custom domains for APIs
- Enable services "just in case"
- Forget to set billing alarms

## Monthly Bill Examples

### Family of 3 (Typical)
- 3 users × 50 requests/day × 30 days = 4,500 requests
- **Cost**: $0 (all within free tier)

### Power User Family
- 5 users × 200 requests/day × 30 days = 30,000 requests  
- **Cost**: $0 (still within free tier)

### Small School (100 users)
- 100 users × 100 requests/day × 30 days = 300,000 requests
- **Cost**: ~$0.50/month

## Conclusion

The Teen Passbook architecture ensures:
- **$0 fixed costs** - no monthly commitments
- **Pay only for usage** - fair and transparent
- **Free for most families** - AWS free tier covers typical usage
- **Scalable** - costs grow linearly with usage
- **Controllable** - hard limits prevent bill shock

This approach makes the app accessible to all families regardless of budget, while still providing enterprise-grade security and reliability.
