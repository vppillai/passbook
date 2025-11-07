# Requirements Analysis: Passbook Project

This document compares the existing implementation with the requirements.md to identify gaps and missing details.

## ✅ Features Already Captured in Requirements

1. **Account Management**
   - Parent account creation with email verification
   - Child account creation
   - Email-based authentication
   - Password reset flow

2. **Fund Management**
   - Parents can add funds
   - Funding periods (mentioned but needs detail)
   - Ad-hoc fund additions

3. **Expense Tracking**
   - Amount, description, category
   - Predefined categories (snacks, food, games, sports, school, crafts, toys, etc.)
   - Parents and children can add expenses

4. **Analytics**
   - Pie chart for category breakdown
   - Period selection for analytics

5. **Currency & Timezone**
   - Currency selection (default CAD, displayed as $)
   - Timezone selection

6. **Backend Infrastructure**
   - AWS CloudFormation
   - Pay-per-use services
   - us-west-2 region (configurable)
   - GitHub Actions deployment

7. **Frontend**
   - GitHub Pages hosting
   - Responsive design
   - Modern, minimalistic UI
   - SVG icons (no emojis)
   - Child-friendly but not childish

## ❌ Missing Details in Requirements

### 1. Account Management Details

**Missing:**
- **Username system**: Requirements mention "username should be unique within the family account" but current implementation uses email only. Need to clarify if username is separate from email or if email serves as username.
- **Additional parent invitation flow**: Mentioned but not detailed:
  - How invitation is sent
  - What happens when second parent accepts
  - How account manager rights are granted
  - Whether second parent can invite more parents
- **Child account editing**: Requirements say "parents should be able to edit the username and password of the kids account" but doesn't specify:
  - Where this is done (settings page?)
  - Whether child can edit their own username
  - Password change workflow for children

**Current Implementation:**
- Uses email as login identifier (no separate username)
- No multi-parent support implemented
- Child accounts can be created but editing capabilities not fully specified

### 2. Email Verification & Activation

**Missing:**
- **Account manager activation**: "email based activation before they can proceed with account setup" - needs detail:
  - What email is sent?
  - What happens when link is clicked?
  - What setup steps follow activation?
- **Parent invitation**: Needs detail:
  - Email template content
  - Activation link format
  - What happens if invitation expires
  - How to resend invitation

**Current Implementation:**
- Password reset email flow exists
- Account activation flow not fully implemented

### 3. Funding Period Details

**Missing:**
- **Funding period display**: "A funding period can be set for the child to easily see how long there is until additional funds will be added" - needs detail:
  - Where is this displayed?
  - How is the period configured?
  - What happens when period ends (auto-notification?)
- **Daily reminder**: "parents/managers gets a daily reminder when the funds have gone below 1" - needs detail:
  - Email reminder or in-app notification?
  - How is "below 1" calculated (per child or total)?
  - Can reminders be disabled?
  - What time of day are reminders sent?

**Current Implementation:**
- Accounting periods exist (monthly, biweekly, custom)
- No funding period countdown display
- No daily reminder system implemented

### 4. Analytics Details

**Missing:**
- **Category table**: Requirements say "following the pie chart, a table should show actual amounts in the categories" - not implemented
- **Period selector**: Requirements mention period selection but don't specify:
  - Where the selector appears
  - Default period (current accounting period)
  - Whether historical periods can be selected
- **Line graph**: Not mentioned in requirements but exists in implementation
- **Time granularity**: Not mentioned (daily/weekly/monthly selector exists)

**Current Implementation:**
- Pie chart exists
- Line graph exists (not in requirements)
- Time granularity selector exists (not in requirements)
- Category table after pie chart: **MISSING**
- Period selector in analytics: **MISSING** (only shows current period)

### 5. Expense Entry Details

**Missing:**
- **Incomplete sentence**: Line 21 says "When the child adds an expense, they should be able to select" but doesn't complete the thought
- **Expense editing**: Not mentioned but exists in implementation
- **Negative balance handling**: Not mentioned but exists (warning shown)

**Current Implementation:**
- Expense editing exists
- Negative balance warnings exist
- Date selection exists

### 6. Export & Reporting

**Missing:**
- **Export formats**: Excel and PDF mentioned but needs detail:
  - What data is included?
  - Can exports be filtered by date range?
  - Where is export accessed from?
- **Report content**: Needs specification:
  - Summary totals?
  - Category breakdown?
  - Fund additions included?

**Current Implementation:**
- Excel export exists
- PDF export exists
- Date range selection exists
- Summary, expenses, and fund additions included

### 7. Accounting Period Details

**Missing:**
- **Period types**: Requirements mention "funding period" but don't specify accounting period types (monthly, biweekly, custom)
- **Period management**: Not detailed:
  - How to start new period
  - What happens to balance when period ends
  - Historical period viewing
- **Default period**: Mentioned but not specified (default is monthly, starting on day 1)

**Current Implementation:**
- Monthly, biweekly, custom period types exist
- New period creation exists
- Historical period viewing exists
- Balance tracking per period exists

### 8. Backend Infrastructure Details

**Missing:**
- **Specific AWS services**: Requirements mention "lambda functions, API gateways, dynamo tables, secrets" but needs detail:
  - Which services are required vs optional?
  - DynamoDB table structure?
  - API Gateway endpoints?
- **Email service details**: Zoho SMTP mentioned but needs:
  - Specific server settings
  - Port numbers
  - Security requirements
  - Alternative providers support
- **Configuration management**: "unified project level configuration file" - needs detail:
  - File format (JSON, YAML, .env?)
  - What settings are included?
  - How frontend consumes this?

**Current Implementation:**
- CloudFormation templates exist
- Lambda functions (auth-service, email-service)
- DynamoDB tables defined
- Secrets Manager integration
- SMTP configuration in Secrets Manager

### 9. Frontend Details

**Missing:**
- **PWA features**: Not mentioned but exists:
  - Service worker
  - Offline functionality
  - App installation
- **Theme system**: Dark/light mode mentioned but "system" preference not mentioned
- **Offline support**: Not mentioned but IndexedDB storage exists
- **Balance display**: "clearly shown on login" - needs detail:
  - Where exactly is it displayed?
  - Is it sticky during scroll?
  - What format (large font, prominent position)?

**Current Implementation:**
- PWA fully implemented
- Service worker exists
- IndexedDB for offline storage
- Theme system (light/dark/system)
- Balance display exists but needs verification of "sticky" requirement

### 10. Security Details

**Missing:**
- **JWT details**: "Use jwt and other modern web technologies" - needs:
  - Token expiration time
  - Refresh token strategy
  - Token storage method
- **API security**: Not detailed:
  - Rate limiting?
  - API keys?
  - CORS configuration?
- **Data encryption**: Not mentioned:
  - At rest encryption?
  - In transit encryption?
  - Password hashing algorithm?

**Current Implementation:**
- JWT tokens (15-minute expiration mentioned in API spec)
- API keys in API Gateway
- Rate limiting configured
- Password hashing (bcrypt)
- CORS configured

### 11. Deployment Details

**Missing:**
- **GitHub Actions workflow**: Mentioned but not detailed:
  - What triggers deployment?
  - What steps are included?
  - Environment-specific deployments?
- **Frontend configuration sync**: "sync-frontend-config.sh" mentioned but not explained
- **Testing requirements**: "Comprehensive backend tests" mentioned but not detailed:
  - Unit tests?
  - Integration tests?
  - E2E tests?
  - Coverage requirements?

**Current Implementation:**
- GitHub Actions workflows exist
- Deployment scripts exist
- E2E tests exist (Playwright)
- Backend tests not fully implemented

### 12. Documentation Requirements

**Missing:**
- **Architecture documentation**: Mentioned but not specified:
  - What diagrams are needed?
  - What level of detail?
- **Deployment documentation**: Needs detail:
  - Step-by-step instructions?
  - Troubleshooting guide?
  - Prerequisites list?

**Current Implementation:**
- README.md exists
- DEPLOYMENT.md exists
- Architecture diagrams in README
- Backend README exists

## 🔧 Recommendations

1. **Complete the incomplete sentence** on line 21 about expense selection
2. **Add detailed specifications** for:
   - Email verification/activation flows
   - Multi-parent invitation system
   - Funding period countdown display
   - Daily reminder system
   - Category table in analytics
   - Period selector in analytics
3. **Clarify username vs email** - decide if separate username field is needed
4. **Add missing features** that exist but aren't documented:
   - Line graph analytics
   - Time granularity selector
   - Expense editing
   - Negative balance warnings
   - PWA features
   - Offline support
   - Historical period viewing
5. **Specify UI/UX details**:
   - Balance display location and behavior
   - Navigation structure
   - Menu organization
6. **Add technical specifications**:
   - API endpoints
   - Data models
   - Security measures
   - Testing requirements

## 📋 Next Steps

1. Review this analysis
2. Update requirements.md with missing details
3. Clarify ambiguous requirements
4. Add specifications for features that exist but aren't documented
5. Remove or update requirements that don't match implementation (if starting fresh)
