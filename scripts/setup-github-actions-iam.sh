#!/bin/bash

# Passbook GitHub Actions IAM Setup Script
# This script creates an IAM user with necessary permissions for GitHub Actions deployment

set -e

echo "🚀 Passbook GitHub Actions IAM Setup"
echo "===================================="
echo ""

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "AWS Account ID: $AWS_ACCOUNT_ID"
echo ""

# IAM user name
IAM_USER="github-actions-passbook"

# Create IAM policy document
POLICY_FILE=$(mktemp)
cat > "$POLICY_FILE" << 'EOF'
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:CreateStack",
                "cloudformation:UpdateStack",
                "cloudformation:DeleteStack",
                "cloudformation:DescribeStacks",
                "cloudformation:DescribeStackEvents",
                "cloudformation:DescribeStackResources",
                "cloudformation:GetTemplate",
                "cloudformation:GetTemplateSummary",
                "cloudformation:ListStacks",
                "cloudformation:ValidateTemplate",
                "cloudformation:CreateChangeSet",
                "cloudformation:DescribeChangeSet",
                "cloudformation:ExecuteChangeSet",
                "cloudformation:DeleteChangeSet"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "s3:CreateBucket",
                "s3:ListBucket",
                "s3:GetBucketLocation",
                "s3:GetObject",
                "s3:PutObject",
                "s3:DeleteObject",
                "s3:GetBucketPolicy",
                "s3:PutBucketPolicy",
                "s3:GetBucketVersioning",
                "s3:PutBucketVersioning"
            ],
            "Resource": [
                "arn:aws:s3:::passbook-sam-deployments-*",
                "arn:aws:s3:::passbook-sam-deployments-*/*",
                "arn:aws:s3:::aws-sam-cli-managed-default-*",
                "arn:aws:s3:::aws-sam-cli-managed-default-*/*"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "lambda:CreateFunction",
                "lambda:UpdateFunctionCode",
                "lambda:UpdateFunctionConfiguration",
                "lambda:GetFunction",
                "lambda:GetFunctionConfiguration",
                "lambda:DeleteFunction",
                "lambda:ListFunctions",
                "lambda:AddPermission",
                "lambda:RemovePermission",
                "lambda:GetPolicy",
                "lambda:TagResource",
                "lambda:UntagResource",
                "lambda:ListTags",
                "lambda:PublishVersion",
                "lambda:CreateAlias",
                "lambda:UpdateAlias",
                "lambda:DeleteAlias",
                "lambda:GetAlias"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "apigateway:*"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "dynamodb:CreateTable",
                "dynamodb:UpdateTable",
                "dynamodb:DeleteTable",
                "dynamodb:DescribeTable",
                "dynamodb:ListTables",
                "dynamodb:TagResource",
                "dynamodb:UntagResource",
                "dynamodb:DescribeTimeToLive",
                "dynamodb:UpdateTimeToLive",
                "dynamodb:DescribeContinuousBackups",
                "dynamodb:UpdateContinuousBackups"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "iam:GetRole",
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:PutRolePolicy",
                "iam:GetRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:PassRole",
                "iam:TagRole",
                "iam:UntagRole"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:CreateSecret",
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret",
                "secretsmanager:UpdateSecret",
                "secretsmanager:DeleteSecret",
                "secretsmanager:TagResource",
                "secretsmanager:UntagResource"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "logs:CreateLogGroup",
                "logs:DescribeLogGroups",
                "logs:DeleteLogGroup",
                "logs:PutRetentionPolicy",
                "logs:TagLogGroup",
                "logs:UntagLogGroup"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "events:PutRule",
                "events:DescribeRule",
                "events:DeleteRule",
                "events:PutTargets",
                "events:RemoveTargets",
                "events:TagResource",
                "events:UntagResource"
            ],
            "Resource": "*"
        }
    ]
}
EOF

echo "📝 Creating IAM user: $IAM_USER"
if aws iam get-user --user-name "$IAM_USER" &>/dev/null; then
    echo "✓ User already exists"
else
    aws iam create-user --user-name "$IAM_USER"
    echo "✓ User created"
fi
echo ""

echo "📋 Creating/updating IAM policy"
POLICY_ARN=$(aws iam list-policies --query "Policies[?PolicyName=='PassbookGitHubActionsPolicy'].Arn" --output text)

if [ -z "$POLICY_ARN" ]; then
    POLICY_ARN=$(aws iam create-policy \
        --policy-name PassbookGitHubActionsPolicy \
        --policy-document "file://$POLICY_FILE" \
        --query 'Policy.Arn' \
        --output text)
    echo "✓ Policy created: $POLICY_ARN"
else
    # Update existing policy by creating a new version
    aws iam create-policy-version \
        --policy-arn "$POLICY_ARN" \
        --policy-document "file://$POLICY_FILE" \
        --set-as-default &>/dev/null || echo "✓ Policy already up to date"
    echo "✓ Policy exists: $POLICY_ARN"
fi
echo ""

echo "🔗 Attaching policy to user"
if aws iam get-attached-user-policies --user-name "$IAM_USER" | grep -q "$POLICY_ARN"; then
    echo "✓ Policy already attached"
else
    aws iam attach-user-policy \
        --user-name "$IAM_USER" \
        --policy-arn "$POLICY_ARN"
    echo "✓ Policy attached"
fi
echo ""

echo "🔑 Creating access key"
# Check if access key already exists
EXISTING_KEYS=$(aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[].AccessKeyId' --output text)

if [ -n "$EXISTING_KEYS" ]; then
    echo "⚠️  Warning: User already has access key(s):"
    echo "$EXISTING_KEYS"
    echo ""
    read -p "Do you want to create a new access key? (existing keys won't be deleted) [y/N]: " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping access key creation"
        echo ""
        echo "✅ Setup complete!"
        echo ""
        echo "Use existing access keys or run this script again to create new ones."
        rm "$POLICY_FILE"
        exit 0
    fi
fi

ACCESS_KEY=$(aws iam create-access-key --user-name "$IAM_USER" --output json)
ACCESS_KEY_ID=$(echo "$ACCESS_KEY" | jq -r .AccessKey.AccessKeyId)
SECRET_ACCESS_KEY=$(echo "$ACCESS_KEY" | jq -r .AccessKey.SecretAccessKey)

echo "✓ Access key created"
echo ""

# Cleanup
rm "$POLICY_FILE"

echo "✅ Setup complete!"
echo ""
echo "=========================================="
echo "GitHub Secrets Configuration"
echo "=========================================="
echo ""
echo "Add these secrets to your GitHub repository:"
echo ""
echo "AWS_ACCESS_KEY_ID:"
echo "$ACCESS_KEY_ID"
echo ""
echo "AWS_SECRET_ACCESS_KEY:"
echo "$SECRET_ACCESS_KEY"
echo ""
echo "AWS_ACCOUNT_ID:"
echo "$AWS_ACCOUNT_ID"
echo ""
echo "=========================================="
echo ""
echo "⚠️  IMPORTANT: Save these credentials securely!"
echo "You won't be able to retrieve the secret access key again."
echo ""
echo "To set these secrets using GitHub CLI:"
echo ""
echo "  gh secret set AWS_ACCESS_KEY_ID --body \"$ACCESS_KEY_ID\""
echo "  gh secret set AWS_SECRET_ACCESS_KEY --body \"$SECRET_ACCESS_KEY\""
echo "  gh secret set AWS_ACCOUNT_ID --body \"$AWS_ACCOUNT_ID\""
echo ""
echo "Or set them manually at:"
echo "https://github.com/YOUR_USERNAME/passbook/settings/secrets/actions"
echo ""

