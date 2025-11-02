# Allowance Passbook - AWS Infrastructure

This directory contains AWS CloudFormation templates and deployment scripts for the optional cloud sync backend of the Allowance Passbook application.

## 🏗️ Architecture Overview

The Allowance Passbook follows a **pay-per-use** architecture with zero fixed costs:

- **Frontend**: Hosted on GitHub Pages (Free)
- **Backend**: Optional AWS services (Pay-per-use only)
- **Storage**: DynamoDB (On-demand billing)
- **API**: API Gateway (Pay per request)
- **Compute**: Lambda (Pay per invocation)

## 📁 Directory Structure

```
aws/
├── cloudformation/
│   ├── templates/
│   │   └── main-template.yaml      # Complete infrastructure template
│   └── parameters/
│       ├── development.json        # Dev environment parameters
│       ├── staging.json            # Staging environment parameters
│       └── production.json         # Production environment parameters
├── scripts/
│   ├── deploy.sh                   # Deployment script
│   └── teardown.sh                 # Safe teardown script
└── README.md                       # This file
```

## 🚀 Quick Start

### Prerequisites

1. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```

2. **Proper AWS permissions** for:
   - CloudFormation (full access)
   - DynamoDB (create/manage tables)
   - IAM (create roles/policies)
   - API Gateway (create/manage APIs)
   - Lambda (create/manage functions)
   - CloudWatch (create alarms/dashboards)

### Deploy Infrastructure

```bash
# Navigate to scripts directory
cd aws/scripts

# Deploy development environment
./deploy.sh -e development -r us-east-1

# Deploy staging environment
./deploy.sh -e staging -r us-west-2

# Deploy production (with confirmation prompts)
./deploy.sh -e production -r us-east-1
```

### Teardown Infrastructure

```bash
# Teardown development (safe)
./teardown.sh -e development

# Teardown staging with dry run first
./teardown.sh -e staging --dry-run
./teardown.sh -e staging

# Teardown production (requires explicit confirmation)
./teardown.sh -e production
```

## 🏷️ Comprehensive Tagging Strategy

All AWS resources are tagged with:

### Standard Tags
- **Project**: `allowance-passbook`
- **Environment**: `development|staging|production`
- **ManagedBy**: `CloudFormation`
- **Owner**: Team/person responsible
- **CostCenter**: Billing allocation
- **Service**: `allowance-passbook-backend`

### Additional Tags
- **DeployedBy**: User who ran the deployment
- **DeploymentDate**: ISO timestamp of deployment
- **DataClassification**: `sensitive|personal|public`
- **BackupPolicy**: `daily|weekly|none`
- **AlertType**: `cost-control|error-monitoring`

### Resource-Specific Tags
- **DynamoDB Tables**: Include `DataClassification` and `BackupPolicy`
- **CloudWatch Alarms**: Include `AlertType`
- **API Gateway**: Include CORS and rate limiting info

## 💰 Cost Management

### Built-in Cost Controls

1. **Hard Limits**
   - API Gateway: Configurable daily request limits per API key
   - Lambda: Concurrent execution limits
   - DynamoDB: On-demand billing with predictable costs

2. **Monitoring & Alerts**
   - Billing alarm at $1 (warning)
   - Billing alarm at $5 (critical)
   - High error rate alarm
   - Throttling alerts

3. **Resource Optimization**
   - DynamoDB: On-demand billing (no provisioned capacity)
   - Lambda: Right-sized memory allocation
   - API Gateway: Built-in caching and throttling

### Expected Costs

| Usage Level | Monthly Requests | Expected Cost |
|-------------|------------------|---------------|
| Personal/Family (1-5 users) | 1K - 10K | $0 (Free Tier) |
| Small Group (10-50 users) | 50K - 100K | $0 - $0.50 |
| Medium Group (100-500 users) | 500K - 1M | $2 - $10 |

### Cost Protection

```bash
# Check current billing
aws cloudwatch get-metric-statistics \
  --namespace AWS/Billing \
  --metric-name EstimatedCharges \
  --start-time $(date -d '1 month ago' -u +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Maximum \
  --dimensions Name=Currency,Value=USD
```

## 🔧 Environment Configuration

### Development Environment
- **Purpose**: Local development and testing
- **Limits**: Conservative (5 concurrent Lambdas, 5K requests/day)
- **Monitoring**: Basic (no detailed dashboard)
- **Data Protection**: No backup, no termination protection

### Staging Environment
- **Purpose**: Pre-production testing
- **Limits**: Moderate (8 concurrent Lambdas, 8K requests/day)
- **Monitoring**: Full monitoring with dashboard
- **Data Protection**: No backup, basic termination protection

### Production Environment
- **Purpose**: Live application
- **Limits**: Higher (20 concurrent Lambdas, 50K requests/day)
- **Monitoring**: Full monitoring with detailed dashboard
- **Data Protection**: Point-in-time recovery, termination protection

## 🔐 Security Features

### Built-in Security (No Extra Cost)

1. **API Gateway**
   - Rate limiting and throttling
   - API key management
   - Request/response validation
   - CORS configuration

2. **IAM**
   - Least-privilege Lambda execution roles
   - Resource-specific permissions
   - No cross-environment access

3. **DynamoDB**
   - Encryption at rest (default)
   - VPC endpoints support
   - Fine-grained access control

### Security Best Practices

- **Environment Isolation**: Separate stacks per environment
- **Resource Naming**: Consistent naming with environment prefix
- **Access Control**: Environment-specific IAM roles
- **Monitoring**: CloudWatch alarms for unusual activity

## 📋 Deployment Scripts

### deploy.sh

**Features:**
- Environment validation
- Template validation
- Cost estimation
- Dry-run mode
- Production safety checks
- Automatic rollback on failure

**Usage:**
```bash
# Basic deployment
./deploy.sh -e development

# Advanced deployment with options
./deploy.sh -e production -r us-east-1 --dry-run

# Force deployment without waiting
./deploy.sh -e staging --no-wait
```

### teardown.sh

**Features:**
- Data protection checks
- Termination protection handling
- Multi-confirmation for production
- Dry-run mode
- Safe resource cleanup

**Usage:**
```bash
# Safe teardown with data check
./teardown.sh -e development

# Dry run first
./teardown.sh -e staging --dry-run

# Force teardown (skip confirmations)
./teardown.sh -e development --force --no-backup
```

## 🔍 Monitoring & Troubleshooting

### CloudWatch Dashboards

The deployment creates monitoring dashboards with:
- API Gateway metrics (requests, latency, errors)
- DynamoDB metrics (read/write capacity, throttling)
- Lambda metrics (invocations, duration, errors)
- Cost tracking and billing alerts

### Key Metrics to Monitor

1. **API Gateway**
   - `Count`: Total requests
   - `4XXError`: Client errors
   - `5XXError`: Server errors
   - `Latency`: Response time

2. **DynamoDB**
   - `ConsumedReadCapacityUnits`
   - `ConsumedWriteCapacityUnits`
   - `ThrottledRequests`

3. **Lambda**
   - `Invocations`
   - `Errors`
   - `Duration`
   - `Throttles`

### Troubleshooting Common Issues

#### High Costs
1. Check CloudWatch billing alarms
2. Review API Gateway usage patterns
3. Verify DynamoDB read/write patterns
4. Check for Lambda timeout issues

#### Performance Issues
1. Monitor API Gateway latency
2. Check Lambda cold starts
3. Review DynamoDB throttling
4. Verify regional deployment

#### Deployment Failures
1. Validate CloudFormation template
2. Check IAM permissions
3. Verify parameter file format
4. Review CloudFormation events

## 🌍 Multi-Region Deployment

### Region Selection

Choose regions based on:
- **User Location**: Minimize latency
- **Cost**: Some regions cost more
- **Compliance**: Data residency requirements
- **Availability**: All services available

### Recommended Regions

- **US East (N. Virginia)**: us-east-1 (cheapest, default)
- **US West (Oregon)**: us-west-2 (good for west coast)
- **Europe (Ireland)**: eu-west-1 (GDPR compliance)
- **Asia Pacific (Sydney)**: ap-southeast-2 (APAC users)

### Deploy to Multiple Regions

```bash
# Deploy to primary region
./deploy.sh -e production -r us-east-1

# Deploy to secondary region
./deploy.sh -e production -r us-west-2
```

## 🔄 CI/CD Integration

### GitHub Actions Integration

```yaml
# .github/workflows/aws-deploy.yml
name: Deploy AWS Infrastructure
on:
  push:
    branches: [main]
    paths: ['aws/**']

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1
      - name: Deploy Infrastructure
        run: |
          cd aws/scripts
          ./deploy.sh -e production -r us-east-1
```

## 📚 Additional Resources

- [AWS CloudFormation Documentation](https://docs.aws.amazon.com/cloudformation/)
- [DynamoDB On-Demand Pricing](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- [API Gateway Pricing](https://aws.amazon.com/api-gateway/pricing/)
- [Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
- [AWS Free Tier](https://aws.amazon.com/free/)

## 🆘 Support

### Getting Help

1. **AWS Documentation**: Check service-specific docs
2. **CloudFormation Console**: View stack events and resources
3. **CloudWatch Logs**: Check Lambda function logs
4. **AWS Support**: Use support case for technical issues

### Emergency Procedures

#### High Costs Alert
1. Check billing dashboard immediately
2. Identify the service causing high costs
3. Use emergency cost controls:
   ```bash
   # Reduce API Gateway quotas
   aws apigateway update-usage-plan --usage-plan-id <id> --patch-ops op=replace,path=/quota/limit,value=100

   # Reduce Lambda concurrency
   aws lambda put-provisioned-concurrency-config --function-name <function> --qualifier $LATEST --provisioned-concurrency 1
   ```

#### Complete Service Shutdown
```bash
# Emergency teardown (use with caution)
./teardown.sh -e production --force --no-backup
```

---

**Remember**: The Allowance Passbook is designed to be **cost-effective** with built-in **cost protection**. Most users will never exceed the AWS free tier!