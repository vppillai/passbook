# Passbook MVP - Quick Start Guide

**Feature**: Family Allowance Management System
**Last Updated**: 2025-11-07

## Overview

Passbook is a cross-platform family allowance management application built with:
- **Frontend**: React Native with React Native Web (TypeScript)
- **Backend**: AWS Serverless (Lambda, DynamoDB, API Gateway)
- **Platforms**: Web (PWA), iOS, Android

## Prerequisites

### Development Tools
- Node.js 18+ and npm 8+
- Git
- AWS CLI v2
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`
- Python 3.11 (for Lambda development)

### Platform-Specific Requirements
- **iOS**: macOS with Xcode 14+
- **Android**: Android Studio with SDK 26+
- **Web**: Modern browser (Chrome, Firefox, Safari, Edge)

### AWS Account
- AWS account with appropriate permissions
- Configured AWS CLI: `aws configure`
- Region: us-west-2 (configurable)

## Quick Setup

### 1. Clone Repository
```bash
git clone https://github.com/vppillai/passbook.git
cd passbook
```

### 2. Install Frontend Dependencies
```bash
npm install
```

### 3. Configure Environment
Create `.env.local` file in project root:
```env
# API Configuration
EXPO_PUBLIC_API_URL=http://localhost:3000/v1
EXPO_PUBLIC_API_KEY=your-local-api-key

# AWS Configuration (for local development)
AWS_REGION=us-west-2
AWS_PROFILE=passbook-dev

# Email Service (optional for local)
SMTP_HOST=smtp.zoho.in
SMTP_PORT=587
SMTP_USER=your-email@domain.com
SMTP_PASSWORD=your-password
```

### 4. Deploy Backend Infrastructure
```bash
# Navigate to backend directory
cd backend

# Install Python dependencies
pip install -r requirements.txt

# Deploy CloudFormation stack
./deploy.sh development
```

This creates:
- API Gateway REST API
- Lambda functions for auth, accounts, transactions
- DynamoDB tables for data storage
- Secrets Manager for credentials

### 5. Start Development

#### Web Development
```bash
# Run React Native Web
npm run web
```
Opens at http://localhost:19006

#### Mobile Development
```bash
# Start Expo development server
npm start

# iOS Simulator (macOS only)
npm run ios

# Android Emulator
npm run android
```

#### Backend Development
```bash
cd backend

# Run tests
pytest

# Deploy function updates
./deploy-function.sh auth-handler
```

## Project Structure

```
passbook/
├── src/                    # React Native source
│   ├── components/         # Reusable UI components
│   ├── screens/           # App screens
│   ├── services/          # API and storage services
│   └── navigation/        # Navigation configuration
├── backend/               # AWS Lambda backend
│   ├── infrastructure/    # CloudFormation templates
│   └── src/              # Lambda function code
└── platform/             # Platform-specific code
```

## Key Development Commands

### Frontend
```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Tests
npm test

# Build for web
npm run build:web

# Build for mobile
eas build --platform ios
eas build --platform android
```

### Backend
```bash
# Unit tests
pytest tests/unit

# Integration tests
pytest tests/integration

# Deploy all
./deploy.sh development

# Deploy specific function
./deploy-function.sh expense-handler
```

## Common Development Tasks

### Adding a New Screen
1. Create component in `src/screens/`
2. Add to navigation in `src/navigation/`
3. Connect to store if needed
4. Add tests in `__tests__/`

### Adding an API Endpoint
1. Define in `backend/infrastructure/api.yaml`
2. Create Lambda handler in `backend/src/lambdas/`
3. Update OpenAPI spec in `contracts/`
4. Deploy with `./deploy.sh`

### Working with Offline Storage
```typescript
// Example: Save expense offline
import { offlineStorage } from '@services/storage';

await offlineStorage.saveExpense({
  amount: 10.99,
  category: 'snacks',
  description: 'Ice cream',
  date: new Date()
});

// Sync when online
await offlineStorage.sync();
```

### Testing Authentication
```typescript
// Login as parent
const response = await authService.login({
  email: 'parent@example.com',
  password: 'testpass123'
});

// Login as child
const response = await authService.login({
  username: 'child1',
  password: 'pass123'
});
```

## Debugging Tips

### React Native Debugger
- Shake device or press Cmd+D (iOS) / Cmd+M (Android)
- Enable "Debug JS Remotely"
- Use React DevTools

### AWS CloudWatch
```bash
# View Lambda logs
aws logs tail /aws/lambda/passbook-auth-handler --follow

# View API Gateway logs
aws logs tail /aws/apigateway/passbook-api --follow
```

### Common Issues

**CORS Errors**
- Check API Gateway CORS configuration
- Ensure headers in Lambda responses

**Authentication Failures**
- Verify JWT secret in Secrets Manager
- Check token expiration (15 minutes)

**Offline Sync Issues**
- Clear IndexedDB/AsyncStorage
- Check sync queue in storage service

## Deployment

### Web (GitHub Pages)
```bash
npm run deploy:web
```

### Mobile App Stores
```bash
# Build and submit iOS
eas build --platform ios --auto-submit

# Build and submit Android
eas build --platform android --auto-submit
```

### Backend Updates
```bash
cd backend
./deploy.sh production
```

## Security Notes

- Never commit `.env` files
- Use AWS Secrets Manager for production secrets
- Rotate API keys regularly
- Follow JWT best practices (short expiration)

## Resources

- [API Documentation](contracts/openapi.yaml)
- [Data Model](data-model.md)
- [Feature Specification](spec.md)
- [Research Decisions](research.md)
- [React Native Docs](https://reactnative.dev)
- [Expo Docs](https://docs.expo.dev)
- [AWS Lambda Docs](https://docs.aws.amazon.com/lambda)

## Getting Help

1. Check existing issues on GitHub
2. Review documentation in `/docs`
3. Ask in project discussions
4. Contact: support@embeddedinn.com

## Contributing

1. Create feature branch from `main`
2. Follow TypeScript/Python style guides
3. Write tests for new features
4. Update documentation
5. Submit PR with description

---

**Next Steps**:
1. Complete environment setup
2. Deploy backend infrastructure
3. Start with User Story 1: Parent Account Setup
4. Run through quickstart validation
