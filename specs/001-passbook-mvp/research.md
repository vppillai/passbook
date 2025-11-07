# Research & Technical Decisions: Passbook MVP

**Feature**: Family Allowance Management System  
**Date**: 2025-11-07  
**Status**: Complete

## Executive Summary

All technical decisions have been made based on the requirements analysis and constitution principles. No unresolved clarifications remain. The chosen stack optimizes for cross-platform code sharing, serverless economics, and educational user experience.

## Key Technical Decisions

### 1. Frontend Framework

**Decision**: React Native with React Native Web  
**Rationale**: 
- Single codebase for iOS, Android, and Web (constitution: Multi-Platform Parity)
- Mature ecosystem with extensive component libraries
- Strong TypeScript support for type safety
- React Native Web enables PWA deployment to GitHub Pages
- Expo SDK simplifies development and deployment

**Alternatives considered**:
- Flutter: Less mature web support, Dart learning curve
- Ionic: Performance concerns on mobile, less native feel
- Native development: 3x development effort, against constitution

### 2. Backend Architecture

**Decision**: AWS Serverless (Lambda + DynamoDB + API Gateway)  
**Rationale**:
- Pay-per-use aligns with constitution (no fixed costs)
- Auto-scaling handles variable load
- DynamoDB provides fast NoSQL storage for simple data model
- CloudFormation enables Infrastructure as Code
- Managed services reduce operational overhead

**Alternatives considered**:
- Traditional server (EC2): Fixed costs violate constitution
- Firebase: Vendor lock-in concerns for open-source project
- Supabase: Less mature, limited AWS integration

### 3. Authentication Strategy

**Decision**: JWT with 15-minute expiration + API keys  
**Rationale**:
- Short-lived tokens enhance security (constitution: Security-First)
- Stateless authentication scales well
- API keys provide additional layer of protection
- Email verification via Zoho SMTP for parent accounts
- Username/password for children (simpler, age-appropriate)

**Alternatives considered**:
- AWS Cognito: Adds complexity, harder to self-host
- OAuth only: Overkill for children accounts
- Session-based: Requires sticky sessions, complicates serverless

### 4. Offline Storage

**Decision**: IndexedDB (web) + AsyncStorage (mobile)  
**Rationale**:
- Native to each platform for best performance
- Sufficient for expense tracking data volumes
- Well-supported by React Native ecosystem
- Enables full offline functionality per constitution

**Alternatives considered**:
- SQLite everywhere: Overhead for simple key-value needs
- Redux Persist only: Limited query capabilities
- No offline: Violates constitution requirements

### 5. Data Synchronization

**Decision**: Queue-based sync with conflict resolution  
**Rationale**:
- Handles intermittent connectivity gracefully
- Last-write-wins for simplicity (appropriate for allowance tracking)
- Queued operations ensure no data loss
- Automatic sync on connection restoration

**Alternatives considered**:
- CRDT: Overcomplicated for this use case
- Manual sync: Poor user experience
- Real-time sync: Unnecessary battery drain

### 6. Chart Libraries

**Decision**: Victory Native  
**Rationale**:
- Works across React Native and Web
- Declarative API matches React patterns
- Good performance for pie and line charts
- Customizable for professional appearance

**Alternatives considered**:
- Chart.js: Web-only, requires separate mobile solution
- React Native Chart Kit: Less feature-rich
- D3.js: Overkill for simple charts

### 7. PDF Generation

**Decision**: @react-pdf/renderer  
**Rationale**:
- Pure JavaScript, works on all platforms
- Programmatic API for professional layouts
- No external service dependencies
- Supports complex bank statement formatting

**Alternatives considered**:
- Server-side generation: Requires backend resources
- HTML to PDF: Inconsistent results across platforms
- External API: Privacy concerns, costs

### 8. Development & Build Tools

**Decision**: Expo with EAS Build  
**Rationale**:
- Simplifies React Native development
- Over-the-air updates for quick fixes
- Managed workflow reduces configuration
- EAS Build handles app store deployments

**Alternatives considered**:
- Bare React Native: More complex setup
- Fastlane only: Requires more configuration
- Manual builds: Error-prone, not scalable

## Performance Targets Validation

- **Analytics render <2s**: Victory Native meets this with optimized rendering
- **PDF generation <5s**: Client-side generation achieves this for 1000 transactions
- **API response <100ms p95**: Lambda warm starts + DynamoDB achieve this
- **Instant expense entry**: Local-first architecture ensures immediate feedback

## Security Considerations

- JWT secrets stored in AWS Secrets Manager
- SMTP credentials in Secrets Manager (not in code)
- API Gateway rate limiting prevents abuse
- Input validation on both client and server
- HTTPS everywhere, certificate pinning for mobile
- COPPA compliance through minimal data collection

## Deployment Architecture

- **Web**: GitHub Pages with GitHub Actions CI/CD
- **Mobile**: EAS Build with automated store submissions
- **Backend**: CloudFormation with GitHub Actions deployment
- **Monitoring**: CloudWatch for all AWS resources

## Open Source Considerations

- All credentials externalized to environment variables
- CloudFormation templates parameterized for easy customization
- Documentation includes full deployment guide
- No proprietary dependencies that prevent self-hosting

## Cost Projections

Based on AWS pricing (us-west-2):
- 100 families, moderate usage: ~$10-20/month
- 1000 families, heavy usage: ~$100-200/month
- Linear scaling with pay-per-use model

## Next Steps

All technical decisions are finalized. Ready to proceed with:
1. Data model definition
2. API contract generation  
3. Quickstart documentation
4. Agent context updates

