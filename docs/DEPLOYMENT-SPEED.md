# Backend Deployment Speed Improvements

## Current Status
- **Average deployment time**: 5-6 minutes
- **Already optimized**: Pip caching, SAM build caching

## Additional Optimizations

### 1. Use `sam build --use-container --parallel` ⚡
**Savings: 30-50% faster builds**

Update `deploy-sam.sh`:
```bash
sam build --use-container --parallel \
  --cached \
  --template infrastructure/complete-stack.yaml
```

### 2. Enable Lambda Layer for Dependencies 📦
**Savings: 1-2 minutes per deployment**

Create a Lambda Layer for common dependencies (boto3, bcrypt, etc.):
- Dependencies only rebuild when requirements.txt changes
- Lambdas are smaller and deploy faster

```yaml
PassbookDependenciesLayer:
  Type: AWS::Serverless::LayerVersion
  Properties:
    LayerName: !Sub 'passbook-${Environment}-dependencies'
    ContentUri: dependencies/
    CompatibleRuntimes:
      - python3.11
    RetentionPolicy: Retain
  Metadata:
    BuildMethod: python3.11
```

### 3. Use SAM Accelerate for Development 🚀
**Savings: Skip CloudFormation - seconds instead of minutes**

For rapid iteration:
```bash
sam sync --stack-name passbook-development --watch
```

This bypasses CloudFormation and syncs code directly to Lambda.

### 4. Reduce Lambda Package Size 📉
**Savings: Faster uploads**

Current optimizations:
```python
# In template
Environment:
  Variables:
    PYTHONDONTWRITEBYTECODE: "1"  # Skip .pyc files
```

Additional:
- Exclude test files from deployment
- Use `.samignore` file

### 5. Parallel Lambda Builds
**Already implemented via SAM caching**

### 6. Use CloudFormation ChangeSet Review
**Savings: Skip unnecessary updates**

```bash
sam deploy --no-execute-changeset  # Review first
sam deploy --execute-changeset     # Then apply
```

### 7. Local Testing Before Deploy 🧪
**Savings: Catch errors before deployment**

```bash
# Start local API
sam local start-api

# Test specific function
sam local invoke CreateChildFunction -e events/create-child.json
```

## Recommended Workflow

### For Development (Fastest)
```bash
# Use SAM Accelerate - bypasses CloudFormation
sam sync --stack-name passbook-development --watch
```

### For CI/CD (Current)
```bash
# Use cached builds with parallel processing
sam build --cached --parallel --use-container
sam deploy --no-confirm-changeset
```

### For Production
```bash
# Full build with review
sam build --use-container
sam deploy --confirm-changeset  # Manual approval
```

## Implementation Priority

1. **✅ DONE**: Pip caching, SAM build caching
2. **HIGH**: Add `--parallel` flag to sam build
3. **MEDIUM**: Create Lambda Layer for dependencies
4. **LOW**: Use sam sync for development (developer preference)

## Expected Results

| Optimization | Time Saved | Effort |
|-------------|-----------|--------|
| Pip caching | 10-30s | ✅ Done |
| SAM build cache | 1-3min | ✅ Done |
| Parallel builds | 30-60s | Easy |
| Lambda Layer | 1-2min | Medium |
| SAM Accelerate | 3-4min | Easy (dev only) |

**Total potential savings: 5-8 minutes** (for a ~6 minute deployment, this could bring it down to ~1-2 minutes for code-only changes)

## Quick Win Implementation

Update `backend/deploy-sam.sh` now:

```bash
#!/bin/bash
set -e

export SAM_CLI_TELEMETRY=0
ENVIRONMENT=${1:-development}
REGION=${2:-us-west-2}

echo "🚀 Building SAM application with optimizations..."
sam build \
  --use-container \
  --parallel \
  --cached \
  --template infrastructure/complete-stack.yaml

echo "📦 Deploying to ${ENVIRONMENT}..."
sam deploy \
  --template-file .aws-sam/build/template.yaml \
  --stack-name "passbook-${ENVIRONMENT}" \
  --region "${REGION}" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides Environment="${ENVIRONMENT}" \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset

echo "✅ Deployment complete!"
```

