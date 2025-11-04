#!/bin/bash

# Package Lambda function for deployment
# This creates a deployment package with all dependencies

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "📦 Packaging Lambda function..."

# Install dependencies
if [ ! -d "node_modules" ]; then
    echo "📥 Installing dependencies..."
    npm install --production
fi

# Create deployment package
echo "📦 Creating deployment package..."
zip -r function.zip index.js node_modules/ package.json -x "*.git*" "*.DS_Store*" "*.zip"

echo "✅ Package created: function.zip"
echo "📏 Size: $(du -h function.zip | cut -f1)"
echo ""
echo "💡 To deploy:"
echo "   aws lambda update-function-code \\"
echo "     --function-name allowance-passbook-ENVIRONMENT-auth-service \\"
echo "     --zip-file fileb://function.zip"

