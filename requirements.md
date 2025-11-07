## Features and workflow

This is a web based application that parents can use to provide allowances to children and track usage. The child can then login to their account and enter categorized expenses into the passbook. The available balance is clearly shown on login in a prominent position (large font, sticky during scroll). This is a tool to manage allowances as well as teach kids financial discipline.

### Account Management

An account manager parent creates a family account and can then add other members into it. Other members could be another parent or kids. The other parent also gets account manager rights and becomes account manager. A family name and description should be set when the family account is created. This can be edited later from the settings screen.

Account manager including additional parent logins should be based on verified email addresses. When the account manager creates an account, they should get an email based activation before they can proceed with account setup. The activation email should contain a secure link that expires within 24 hours. When clicked, the link activates the account and allows the user to complete setup (set name, password, currency, timezone). When a parent is invited into the account by the account manager they should get an email invitation with a secure activation link. They then click on it to activate and setup their account to join the family account. The invitation link should expire within 7 days and can be resent by the account manager if needed.

Account manager sets up a username and password for kids account.It can be either email address based or a seperate username based login. If username based login is used, each kids username should be unique within the family account but need not be universally unique. The parents should be able to edit the username ,display name and password of the kids account from a child account management screen in the parent dashboard. If email address based login is used, the email address should be unique just like any other email address.

An email verification based password reset flow should be implemented for parent accounts as it is done with all standard web based applications. If a password is reset, all active sessions on other devices should be invalidated for security. The password reset email should contain a secure token that expires within 1 hour. Children accounts password reset can be done without email verification by the account manager. If a child account uses email address based login, the password reset should be done via email verification and the child should be able to reset their password without the account manager's intervention.

### Fund Management

Parents adds funds. A funding period can be set for the child to easily see how long there is until additional funds will be added and also an indication of how frequently re-funding happens. The funding period countdown should be displayed prominently on the child's dashboard showing days remaining until next scheduled funding. Refunding does not happen automatically. Additional funds can be added any time ad-hoc. The parents/managers gets a daily reminder via email when the funds have gone below $1 (or equivalent in selected currency) for any child account. The reminder should be sent once per day at a configurable time (default: 9 AM in account timezone) and can be disabled per child account if desired.

### Currency and Timezone

The default currency is CAD, but we use the $ symbol to display brevity. But the manager must be able to select the currency when they create the account and also change it from a settings screen. The currency selection should support all major ISO 4217 currency codes. The timezone of operation should also be selected based on the system from which the account is being created, but should be changeable later from the settings screen. All dates and times should be displayed in the selected timezone.

### Expense Management

Expense addition should capture amount, description and category. Categories should include but not limited to snacks, food, games, sports, school, crafts, toys, books, clothes, entertainment, and other. When the child adds an expense, they should be able to select the category from a dropdown, enter the amount, add a description, and select the date (defaults to today). Expenses can be edited after creation to fix errors. If an expense would result in a negative balance, a warning should be shown to the child but the expense should still be allowed. The expense list should be sorted by date (most recent first). When in negetive / overdraft, it should be highlighted every time a new expense is added.

Account manager and parents should be able to add an expense item into any child account. Parents should also be able to edit expenses they created on behalf of children.

### Analytics and Reporting

Parents and children should be able to see analytics of expenses. For specific child accounts analytics shows what category the money was spent in, using a pie chart. The default period is the current accounting period, but a period should be selectable via a dropdown to see the analytics for any historical period. Following the pie chart, a table should show actual amounts in the categories with columns for category name, amount spent, and percentage of total.

In addition to the pie chart, a line graph should display spending trends over time. The line graph should support time granularity selection (daily, weekly, monthly) with daily as the default. The graph should show spending patterns to help identify trends.

Reports can be exported in Excel (.xlsx) or PDF format. The export should include:
- Summary with total expenses, total funds added, and net balance
- Detailed expense list with date, category, description, and amount
- Fund additions list with date, amount, and reason
- Category breakdown

Exports can be generated for the current period or a custom date range selected by the user. The export functionality should be accessible from a menu option to keep the interface uncluttered.

The pdf report must look like a professional bank statement report with a header, footer and page numbers. reports for a child and for the whole family must be generatable.

### Accounting Periods

The system should support configurable accounting periods. The default period type is weekly (starting on monday), but parents should be able to configure:
- Monthly periods (with configurable start day 1-31)
- Biweekly periods
- Custom periods (manually defined start and end dates)

Parents should be able to start a new accounting period at any time. When a new period starts, the current period is automatically closed. Historical periods should be viewable and accessible for analytics and reporting. The current balance carries forward to the new period, but historical data is preserved for each closed period.

## General

Use gh tool to talk to github

Use GitHub project vppillai/passbook

Ensure secrets are not leaking but this should not come at the expense of too many manual steps involved in deployment. Use local .env files, AWS Secrets Manager, GitHub secrets and protected variables etc.

Use JWT and other modern web technologies when applicable to ensure security. JWT tokens should have short expiration times (15 minutes) and be stored securely. API keys should be used as an additional security layer for backend API calls. Rate limiting should be implemented to prevent abuse.

Create a comprehensive documentation of architecture, frontend, backend and deployment steps. Documentation should include:
- Architecture diagrams using mermaid and ascii diagrams showing system components and data flow
- API documentation with endpoint specifications
- Database schema and data models
- Security measures and best practices
- Step-by-step deployment instructions
- Troubleshooting guide
- Configuration reference

Ensure someone cloning our repo has clean and concise documentation to deploy something themselves if they don't want to use our deployment. We want to make this an open-source tool that anyone can clone, and easily deploy in their AWS and GitHub.

## Backend

Backend uses AWS, but make sure you use only pay as you use services so that we include cost only for resources we use. All services should be pay-per-request with no fixed monthly costs.

Use us-west-2 region as the default. But keep it configurable via the project configuration file.

The backend should be entirely using CloudFormation based infrastructure as code. Apply infrastructure as code best practices. The backend should be deployed using AWS CloudFormation so that there is a single place to deploy and teardown resources for the project. This includes:
- Lambda functions (auth-service, email-service)
- API Gateway (REST API with CORS support)
- DynamoDB tables (parent-accounts, child-accounts, expenses, fund-additions, accounting-periods, accounting-period-balances)
- Secrets Manager (for SMTP credentials, JWT secrets)
- CloudWatch (for logging and monitoring)
- IAM roles and policies (least privilege principle)
- s3 buckets for periodic backup of data

When creating resources, ensure they have a "passbook" tag applied to identify them from AWS console and tools. Additional tags should include: Project, Environment, Owner, CostCenter, DataClassification.

When backend infra code changes, it should deploy backend updates with GitHub workflow and actions. Implement scripts that actions can then use for the deployment. This way, we can also use those scripts locally to test. The deployment scripts should:
- Validate CloudFormation templates
- Deploy stack updates
- Handle rollback on failure
- Update frontend configuration with new API endpoints
- Support multiple environments (development, staging, production)

Comprehensive backend tests should be implemented to ensure quality. This includes:
- Unit tests for Lambda functions
- Integration tests for API endpoints
- End-to-end tests for critical workflows
- Test coverage should be maintained at a reasonable level (target: 70%+)

Use Zoho email SMTP in the backend when required. The SMTP configuration should be stored in AWS Secrets Manager with the following structure:
```json
{
  "host": "smtp.zoho.in",
  "port": "587",
  "secure": "false",
  "user": "your-smtp-username@domain.com",
  "password": "your-smtp-password",
  "from": "your-from-email@domain.com"
}
```

**⚠️ DEPLOYMENT-SPECIFIC CONFIGURATION (SENSITIVE - DO NOT COMMIT TO PUBLIC REPOS)**

For this specific deployment, the actual SMTP credentials are:
```json
{
  "host": "smtp.zoho.in",
  "port": "587",
  "secure": "false",
  "user": "support@embeddedinn.com",
  "password": "pcP3p67YeZgu",
  "from": "support@embeddedinn.com"
}
```

**Security Note**: These credentials are stored in AWS Secrets Manager and should NOT be committed to version control. If sharing this repository publicly, remove this section or use placeholders.

If another developer wants to deploy this in their system they should provide a different email address, password and server configuration. It should be easy for them to update this in a unified project level configuration file (JSON or YAML format) that is consumed during CloudFormation deployment.

When backend stack changes it could result in URL and some other parameter changes. There should be a good configuration file mechanism that the frontend can consume during deployment. The frontend should read configuration from environment variables or a config file that is generated during the build process.

## Frontend

When backend stack changes it could result in URL and some other parameter changes. The front-end should be built in a configurable and parametrized manner to absorb these changes seamlessly during deployment. This will also make it easy for others to consume this open source project and deploy it in their own system. Configuration should be managed through environment variables (VITE_* prefix) that are injected at build time.

Parensts should be able to opt in to get push notifications for new expenses, fund additions, account balance alerts, etc. children should be able to opt in to get push notifications for new expenses, fund additions, account balance alerts, etc.


Hosting is to be done with GitHub Pages. The deployment should be automated via GitHub Actions that builds and deploys on push to main branch.

The Web app must be responsive and work on mobile and desktop. It should be built as a Progressive Web App (PWA) with:
- Service worker for offline functionality
- App manifest for installation
- Offline data storage using IndexedDB
- Background sync capabilities
- Push notification support

Even though the app is a PWA, when a password reset is performed on other devices, the app should not continue wo working with previous password. It should force a login with the new password.

The look and feel of the application should be modern, minimalistic and sleek. Do not use emojis for icons. Instead use standardized SVG icons available for free. The layout should not look cluttered. Additional information can be structured into menus that can be launched from the primary view or tiles. When using animations, do not be overly flashy. Use subtle ones.

The frontend should support theme customization:
- Light mode
- Dark mode
- System preference (follows device/browser setting)

The frontend should be built to be child friendly since the child account users will be pre-teens or teens. But don't make it look childish. This is a tool to teach kids financial discipline and also to set them up for future banking applications. At the same time, it should not be too complex to drive them away.

### Frontend Technical Requirements

- Framework: React 18 with TypeScript
- Build tool: Vite
- State management: Context API or similar lightweight solution
- Storage: IndexedDB (via Dexie) for offline data persistence
- Routing: React Router
- Styling: Tailwind CSS or similar utility-first framework
- Charts: Chart.js or similar for analytics visualizations
- Form validation: Client-side validation with clear error messages
- Accessibility: WCAG 2.1 AA compliance where possible

### Key UI Components

- Balance display: Prominently shown at top of dashboard, sticky during scroll, large font
- Expense list: Sorted by date (most recent first), shows date, category, description, amount
- Floating Action Button (FAB): Bottom right corner for adding expenses
- Navigation menu: Accessible from primary view, contains analytics, reports, settings
- Period selector: Dropdown or calendar view for selecting accounting periods
- Category picker: Dropdown with icons and colors for expense categories
