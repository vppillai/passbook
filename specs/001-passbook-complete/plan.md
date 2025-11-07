# Implementation Plan: Passbook - Complete Family Allowance Management System

**Branch**: `001-passbook-complete` | **Date**: 2025-11-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-passbook-complete/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Cross-platform family allowance management application enabling parents to provide digital allowances to children while teaching financial discipline. The system features secure multi-parent account management, real-time expense tracking with categorization, comprehensive analytics, and offline functionality. Built with React Native for unified mobile/web deployment and AWS serverless backend for cost-effective scaling.

## Technical Context

**Language/Version**: TypeScript 5.x (React Native), Python 3.11 (AWS Lambda)
**Primary Dependencies**: React Native 0.72+, React Native Web, Expo SDK 49+, AWS SDK
**Storage**: AWS DynamoDB (backend), IndexedDB/AsyncStorage (client offline cache)
**Testing**: Jest + React Native Testing Library (frontend), pytest (backend Lambda)
**Target Platform**: Web (PWA), iOS 13+, Android 8+ (API 26+), AWS Lambda (backend)
**Project Type**: mobile - React Native with web support + serverless API
**Performance Goals**: <2s analytics render, <5s PDF generation, instant expense entry
**Constraints**: Offline-capable, <100ms API response p95, secure JWT auth, COPPA compliant
**Scale/Scope**: Initial 100 family accounts, ~20 screens, 3 platforms from single codebase

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- ✅ **Security-First Architecture**: JWT auth, email verification, secure password resets, session invalidation
- ✅ **Multi-Platform Parity**: React Native with React Native Web for unified codebase across all platforms
- ✅ **Infrastructure as Code**: All AWS resources defined via CloudFormation templates
- ✅ **Open-Source Deployability**: Comprehensive documentation planned, secrets via environment variables
- ✅ **Offline-First Architecture**: IndexedDB (web) and AsyncStorage (mobile) for offline functionality
- ✅ **Financial Education Focus**: Clean UI design, prominent balance display, professional reports
- ✅ **Pay-Per-Use Economics**: AWS Lambda, DynamoDB, API Gateway - all consumption-based pricing

**GATE RESULT**: All constitution principles satisfied. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/001-passbook-complete/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# Frontend - React Native with Web support
src/
├── components/          # Shared React Native components
│   ├── auth/           # Login, signup, password reset
│   ├── dashboard/      # Balance display, quick actions
│   ├── expenses/       # Expense list, add expense form
│   ├── analytics/      # Charts (pie, line), reports
│   └── common/         # Buttons, inputs, modals
├── screens/            # App screens/pages
│   ├── ParentScreens/  # Parent-specific views
│   ├── ChildScreens/   # Child-specific views
│   └── SharedScreens/  # Shared views (settings, profile)
├── services/           # API services, storage, auth
├── store/              # State management (Context/Zustand)
├── utils/              # Helpers, formatters, validators
├── types/              # TypeScript interfaces
└── navigation/         # React Navigation config

platform/               # Platform-specific implementations
├── web/               # PWA service worker, web-specific
├── ios/               # iOS-specific code (if needed)
└── android/           # Android-specific code (if needed)

# Backend - AWS Serverless
backend/
├── infrastructure/     # CloudFormation templates
│   ├── api.yaml       # API Gateway definition
│   ├── database.yaml  # DynamoDB tables
│   ├── auth.yaml      # Cognito/auth resources
│   └── main.yaml      # Master stack template
├── src/
│   ├── lambdas/       # Lambda function code
│   │   ├── auth/      # Authentication handlers
│   │   ├── accounts/  # Account management
│   │   ├── expenses/  # Expense CRUD operations
│   │   ├── analytics/ # Report generation
│   │   └── email/     # Email service (Zoho SMTP)
│   ├── models/        # Data models
│   └── utils/         # Shared utilities
└── tests/             # Backend tests

# Mobile app builds
ios/                    # iOS native code (Expo managed)
android/               # Android native code (Expo managed)
web/                   # Web build configuration

# Root configuration files
package.json           # React Native dependencies
app.json              # Expo configuration
```

**Structure Decision**: React Native with React Native Web for unified mobile/web frontend, AWS serverless backend with Lambda functions and DynamoDB. Platform-specific code isolated in dedicated directories while maximizing code sharing across all platforms.

## Complexity Tracking

> No violations - all constitution principles satisfied.

## Phase 1 Constitution Re-check

After completing the design phase, all constitution principles remain satisfied:

- ✅ **Security-First**: JWT auth, email verification, API keys, rate limiting all specified in OpenAPI
- ✅ **Multi-Platform Parity**: Single React Native codebase confirmed for all platforms
- ✅ **Infrastructure as Code**: CloudFormation templates structured in backend/infrastructure/
- ✅ **Open-Source Deployability**: Quickstart guide provides complete setup instructions
- ✅ **Offline-First**: IndexedDB/AsyncStorage architecture defined in data model
- ✅ **Financial Education Focus**: UI components structured for clear financial visualization
- ✅ **Pay-Per-Use Economics**: All AWS services remain consumption-based

**GATE RESULT**: Design phase complete. All principles satisfied. Ready for task generation.
