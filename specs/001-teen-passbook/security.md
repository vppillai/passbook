# Security Architecture: Teen Passbook

**Date**: 2025-11-02  
**Feature**: API Security for Optional Backend Services

## Overview

The Teen Passbook app runs entirely on GitHub Pages with client-side storage. However, if cloud sync is requested, we implement multiple security layers to prevent bot attacks and abuse while using AWS-provided URLs (no custom domains) and **only pay-per-use services** (no fixed monthly costs).

## API Security Measures

### 1. Multi-Layer Authentication

**JWT + API Key**:
- JWT tokens for user authentication (15-minute expiration)
- API keys for additional application-level security
- Both required for all API calls

```javascript
// Example request headers
{
  "Authorization": "Bearer eyJhbGc...",
  "X-API-Key": "your-api-key-here"
}
```

### 2. API Gateway Throttling

**Rate Limiting**:
- **Per-user limits**: 10 requests/second, burst of 20
- **Global limits**: 1000 requests/second across all users
- **429 responses** when limits exceeded

**Implementation**:
```yaml
x-amazon-apigateway-throttle:
  rateLimit: 10
  burstLimit: 20
```

### 3. Request Validation

**Input Sanitization**:
- API Gateway validates all request bodies
- Parameter validation before Lambda execution
- Prevents malformed requests from reaching backend

### 4. API Gateway Built-in Protection (No Fixed Costs)

**Usage-Based Security Features**:
- API Gateway throttling (included in per-request price)
- API key requirement (no additional cost)
- Request validation (no additional cost)
- Usage plans with quotas (no additional cost)
- Lambda authorizers for custom logic (pay per invocation)

**API Gateway Usage Plans**:
```json
{
  "UsagePlan": {
    "Name": "BasicPlan",
    "Throttle": {
      "RateLimit": 10,
      "BurstLimit": 20
    },
    "Quota": {
      "Limit": 10000,
      "Period": "DAY"
    }
  }
}
```

**Lambda-Based Bot Detection** (Pay per invocation):
```javascript
// Simple bot detection in Lambda authorizer
exports.handler = async (event) => {
  const userAgent = event.headers['User-Agent'];
  const ip = event.sourceIp;
  
  // Check for bot patterns
  if (isSuspiciousPattern(userAgent, ip)) {
    throw new Error('Unauthorized');
  }
  
  return generatePolicy('Allow', event.methodArn);
};
```

### 5. API Key Management

**Secure Distribution**:
- API keys distributed only through app
- Keys rotated every 90 days
- Different keys for dev/staging/prod
- Keys stored encrypted in app

**Client-Side Storage**:
```javascript
// Encrypted storage in IndexedDB
const encryptedKey = await crypto.subtle.encrypt(
  { name: "AES-GCM", iv },
  derivedKey,
  encoder.encode(apiKey)
);
```

### 6. CORS Configuration

**Strict Origin Control**:
```javascript
// API Gateway CORS
{
  "AllowOrigins": [
    "https://[username].github.io",
    "https://your-custom-domain.com"
  ],
  "AllowMethods": ["GET", "POST", "PATCH"],
  "AllowHeaders": ["Authorization", "X-API-Key", "Content-Type"],
  "MaxAge": 3600
}
```

### 7. Lambda Security

**Minimal Permissions**:
- Lambda functions have least-privilege IAM roles
- Can only access specific DynamoDB tables
- No internet access unless required
- 128MB memory limit (cost optimization)

**Environment Variables**:
```javascript
// Encrypted environment variables
process.env.JWT_SECRET // Encrypted at rest
process.env.TABLE_NAME // Specific table access only
```

### 8. DynamoDB Security

**Access Patterns**:
- Row-level security with user IDs
- No cross-user data access
- Encryption at rest enabled
- Point-in-time recovery enabled

**Query Restrictions**:
```javascript
// Always filter by authenticated user
const params = {
  TableName: 'TeenPassbook',
  KeyConditionExpression: 'userId = :uid',
  ExpressionAttributeValues: {
    ':uid': authenticatedUserId
  }
};
```

### 9. Monitoring & Alerts

**CloudWatch Alarms**:
- Unusual traffic patterns
- Failed authentication spikes
- Error rate thresholds
- Cost anomalies

**Metrics to Monitor**:
- 4XX/5XX error rates
- Lambda cold starts
- API Gateway latency
- DynamoDB throttling

### 10. Bot Protection (Pay-Per-Use)

**Lambda Authorizer Approach**:
- Custom bot detection logic
- Only charged when invoked
- Can implement sophisticated patterns
- No fixed monthly costs

**Implementation**:
```javascript
// Lambda authorizer (pay per invocation)
exports.handler = async (event) => {
  const headers = event.headers;
  const sourceIp = event.sourceIp;
  
  // Check multiple signals
  const signals = {
    userAgent: headers['User-Agent'],
    acceptLanguage: headers['Accept-Language'],
    acceptEncoding: headers['Accept-Encoding'],
    requestRate: await getRecentRequests(sourceIp)
  };
  
  const botScore = calculateBotScore(signals);
  
  if (botScore > 0.7) {
    throw new Error('Unauthorized');
  }
  
  return generatePolicy('Allow', event.methodArn);
};
```

**Cost-Effective Bot Signals**:
1. **Request Headers Analysis**:
   - Missing standard browser headers
   - Suspicious user agents
   - No Accept-Language header

2. **Behavioral Patterns**:
   - Too many requests too quickly
   - Sequential ID scanning
   - No mouse/touch events (for web)

3. **API Key Patterns**:
   - Track usage per API key
   - Suspend keys with suspicious patterns
   - Rotate keys regularly

**Alternative: Client-Side Challenges**:
```javascript
// Proof-of-work in browser (free)
async function generateProofOfWork() {
  const challenge = await getChallenge();
  const proof = await solveChallenge(challenge);
  return proof; // Include in API requests
}
```

## Security Best Practices

### 1. No Custom Domain = Fewer Attack Vectors
- Using AWS-provided URLs reduces DNS attacks
- No domain hijacking risks
- SSL/TLS handled by AWS

### 2. Client-Side First
- Most operations happen locally
- Reduced API surface area
- Less data exposure

### 3. Optional Backend
- Backend only activated when needed
- Can be disabled if attacks detected
- Minimal data synchronization

### 4. Cost-Aware Security
- Security measures within free tier limits
- Pay-per-use model prevents DDoS costs
- Automatic scaling with limits

## Incident Response

### Detection
1. CloudWatch alarms trigger
2. Cost anomaly detected
3. Error rate spike

### Response
1. Reduce API Gateway quotas immediately
2. Update Lambda authorizer rules
3. Disable sync features if needed
4. Block suspicious API keys
5. Investigate patterns and update bot detection

### Recovery
1. Rotate API keys
2. Review and update rules
3. Gradual service restoration
4. Post-incident analysis

## Implementation Checklist

- [ ] Configure API Gateway throttling and usage plans
- [ ] Create Lambda authorizer for bot detection
- [ ] Implement JWT with short expiration (15 min)
- [ ] Add API key layer
- [ ] Set up daily quotas (10K requests/day)
- [ ] Configure CORS properly
- [ ] Set up CloudWatch alarms
- [ ] Test rate limiting
- [ ] Document emergency procedures
- [ ] Regular security audits

## Cost Implications

**Pay-Per-Use Security Only**:
- API Gateway: $3.50 per million requests (after free tier of 1M/month)
- Lambda Authorizer: $0.20 per million invocations (after free tier)
- DynamoDB: $0.25 per million read/write requests (on-demand)
- CloudWatch: Free tier covers basic monitoring
- No fixed monthly costs!

**Total**: $0-5/month typical usage (only pay for what you use)

**Cost Protection**:
- API Gateway throttling prevents runaway costs
- Daily quotas cap maximum spending
- CloudWatch billing alerts at $5 and $10
- All services are pay-per-request
