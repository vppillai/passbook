# Feature Specification: Teen Passbook

**Feature Branch**: `001-teen-passbook`  
**Created**: 2025-11-02  
**Status**: Draft  
**Input**: User description: "Currency is CAD, but selectable when the parent sets up the account. a parent creates the account and adds kids account into it. the kids get a seperate login after the parent sets it up. parents can add funds and expenses. kids can add expenses. when entering expenses, the type must be selectable from a dropdown. examples are snacks, toys, crafts, games. default fund is $100 and is for a month. current month is the primary visible in the interface. But, previous months should be selectable from the menu to see past months. once an entry is made, it should also be possible to edit it to fix errors etc. parents view should include mechanism to select child and then view details of current and previous months. dark and lite modes should be supported. for the time being, we will use an email based login . there is no need for email validation since we dont want to setup an email backend to send codes. there should be a mechanism to export reports between dates, current month, etc as an excel sheet or pdf . this can be part of a menu since we dont want to clutter the minimalist frontend. the default frontend should show a current balance at the page in bigger font and it should stay sticky  as they scroll through the list of expenses. the expense entries should include date, item, amount and sorted by date. previous months should be selectable from the menu to see, but default is current period. the accounting period can be changed by the parent but default is from start of the month to end of the month . parents should be able to go add additional funds to the kids account any time. parents should be able to start a new account period any time."

## Clarifications

### Session 2025-11-02

- Q: Which visualization approach for spending analysis? → A: Both pie chart and line graph
- Q: Where should the "Add Expense" button be positioned? → A: Floating action button (FAB) at bottom right
- Q: What time granularity for spending trends graph? → A: User-selectable (daily/weekly/monthly), default daily with weekly aggregation
- Q: Where should visualizations be displayed? → A: Hidden in menu, accessed via "View Analytics"
- Q: What happens when balance goes negative? → A: Allow with warning, notify parent of positive/negative balance when adding funds
- Q: GitHub Pages hosting configuration? → A: Standard GitHub Pages (username.github.io/passbook) with custom domain support

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Parent Account Setup & Child Management (Priority: P1)

A parent discovers the Teen Passbook app and wants to set up an account for their family. They create their parent account, select their preferred currency (defaulting to CAD), and add one or more child accounts. Each child receives their own login credentials to access their individual passbook.

**Why this priority**: This is the foundational functionality - without parent account creation and child account setup, no other features can be used. This establishes the hierarchical account structure essential to the app.

**Independent Test**: Can be fully tested by creating a parent account, adding child accounts, and verifying that both parent and children can log in with their respective credentials.

**Acceptance Scenarios**:

1. **Given** a new user accessing the app, **When** they create a parent account with email and password, **Then** they can log in and see the parent dashboard
2. **Given** a logged-in parent, **When** they add a child account with name and login credentials, **Then** the child account is created and can log in independently
3. **Given** a parent setting up their account, **When** they select a currency, **Then** all monetary values in their family's accounts display in that currency

---

### User Story 2 - Teen Expense Tracking (Priority: P1)

A teenager logs into their account and records their daily expenses using a prominent add button. They select a category from a dropdown (like snacks, toys, crafts, or games), enter the amount spent, and add a description. They can see their current balance prominently displayed, scroll through their expense history for the current month, and access spending insights through a "View Analytics" menu option that shows a pie chart with category breakdown and a line graph with spending trends over time.

**Why this priority**: This is the core functionality that delivers the primary value - helping teens track their spending and learn budgeting. Without this, the app doesn't fulfill its main purpose.

**Independent Test**: Can be tested by logging in as a child, adding multiple expenses with different categories, and verifying the balance updates correctly and expenses appear in the sorted list.

**Acceptance Scenarios**:

1. **Given** a logged-in teen with a $100 monthly allowance, **When** they add a $10 expense for snacks, **Then** their balance shows $90 and the expense appears in their list
2. **Given** a teen viewing their expenses, **When** they realize they entered an amount incorrectly, **Then** they can edit the expense and see their balance update
3. **Given** a teen adding an expense, **When** they select the category dropdown, **Then** they see predefined categories including snacks, toys, crafts, and games
4. **Given** a teen on their dashboard, **When** they look for the add expense button, **Then** they see a floating action button at the bottom right corner of the screen
5. **Given** a teen with multiple expenses across categories, **When** they access "View Analytics" from the menu and view the pie chart, **Then** they see their spending breakdown by category for the current period
6. **Given** a teen wanting to analyze spending trends, **When** they access "View Analytics" from the menu and view the line graph, **Then** they see spending patterns with selectable time granularity (daily/weekly/monthly), defaulting to daily with weekly aggregation
7. **Given** a teen with $5 balance attempting to add a $10 expense, **When** they submit the expense, **Then** they see a warning that their balance will go negative but the expense is still recorded

---

### User Story 3 - Parent Fund Management & Monitoring (Priority: P2)

A parent logs in to add funds to their child's account, view their child's spending patterns, and monitor their financial behavior. They can switch between multiple children if they have more than one, add both funds and expenses on behalf of their children, and see current and historical data.

**Why this priority**: While important for parental oversight and fund management, the app can deliver value with just Stories 1 & 2. This enhances parental control and teaching opportunities.

**Independent Test**: Can be tested by logging in as a parent, adding funds to a child's account, adding an expense on their behalf, and switching between multiple children to view their individual data.

**Acceptance Scenarios**:

1. **Given** a parent viewing their dashboard, **When** they select a specific child, **Then** they see that child's current balance and expense list
2. **Given** a parent wanting to add allowance, **When** they add $50 to their child's account, **Then** the child's balance increases by $50
3. **Given** a parent with multiple children, **When** they switch between children, **Then** they see each child's individual financial data
4. **Given** a parent adding funds to a child with negative balance, **When** they initiate the fund addition, **Then** they see a notification showing the current negative balance before confirming

---

### User Story 4 - Historical Data & Reporting (Priority: P3)

Users can view previous months' data, export reports for specific date ranges, and analyze spending patterns over time. Parents can generate reports for tax purposes or allowance planning, while teens can review their spending habits.

**Why this priority**: This provides valuable insights and record-keeping but isn't essential for basic functionality. The app can operate effectively with just current month viewing.

**Independent Test**: Can be tested by navigating to previous months, generating reports for different date ranges, and exporting them in Excel or PDF format.

**Acceptance Scenarios**:

1. **Given** a user with several months of data, **When** they navigate to a previous month, **Then** they see all expenses and the ending balance for that month
2. **Given** a parent needing expense records, **When** they export a report for the current month, **Then** they receive a downloadable Excel or PDF file with all transactions
3. **Given** a user wanting to analyze spending, **When** they export a custom date range report, **Then** the report includes all transactions within those dates

---

### User Story 5 - Customization & Preferences (Priority: P3)

Users can customize their experience with dark/light mode themes. Parents can modify the accounting period (default is calendar month) to align with their family's financial schedule, and start new accounting periods as needed.

**Why this priority**: These are quality-of-life improvements that enhance user experience but aren't critical for core functionality. The app works fine with defaults.

**Independent Test**: Can be tested by toggling between dark/light modes, changing accounting period dates, and starting a new period to verify data resets appropriately.

**Acceptance Scenarios**:

1. **Given** a user preferring dark mode, **When** they toggle the theme setting, **Then** the entire interface switches to dark mode
2. **Given** a parent wanting bi-weekly accounting, **When** they change the accounting period, **Then** new periods follow the custom schedule
3. **Given** a parent wanting to reset, **When** they start a new accounting period, **Then** the current balance resets while preserving historical data

---

### Edge Cases

- What happens when a child's balance goes negative? → Expense is allowed with warning notification shown to teen
- How does the system handle concurrent edits to the same expense?
- What occurs if a parent deletes a child account with existing data?
- How are timezone differences handled for families across time zones?
- What happens when switching currencies mid-period?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support hierarchical accounts with one parent account managing multiple child accounts
- **FR-002**: System MUST authenticate users via email and password without email verification
- **FR-003**: Parents MUST be able to create, edit, and manage child accounts
- **FR-004**: System MUST support multiple currencies with CAD as default
- **FR-005**: Teens MUST be able to add and edit their own expenses
- **FR-006**: Parents MUST be able to add both funds and expenses to child accounts
- **FR-007**: Expenses MUST include date, amount, category (from predefined list), and description
- **FR-008**: System MUST display current balance prominently with sticky positioning during scroll
- **FR-009**: Expense list MUST be sorted by date (most recent first)
- **FR-010**: System MUST support viewing current and previous accounting periods
- **FR-011**: System MUST allow parents to customize accounting period dates
- **FR-012**: System MUST support dark and light theme modes
- **FR-013**: System MUST allow data export in Excel and PDF formats
- **FR-014**: Default monthly allowance MUST be set to $100 (in selected currency)
- **FR-015**: System MUST allow parents to start new accounting periods on demand
- **FR-016**: System MUST preserve historical data when starting new periods
- **FR-017**: System MUST provide a "View Analytics" option in the menu that displays a pie chart showing expense breakdown by category for the current accounting period
- **FR-018**: System MUST display a line graph in the analytics view showing spending trends with user-selectable time granularity (daily/weekly/monthly), defaulting to daily with weekly aggregation option
- **FR-019**: System MUST provide a floating action button (FAB) positioned at bottom right to add new expenses
- **FR-020**: System MUST allow expenses that result in negative balance but display a warning notification to the teen
- **FR-021**: System MUST notify parents of current balance (positive or negative) when they add funds to a child account
- **FR-022**: System MUST be deployable as a static site on GitHub Pages with support for custom domain configuration

### Key Entities *(include if feature involves data)*

- **Parent Account**: Primary account holder who manages family finances, can have multiple children
- **Child Account**: Individual teen account linked to a parent, has own login and expense tracking
- **Expense**: Transaction record with date, amount, category, description, and account association
- **Fund Addition**: Parent-initiated balance increase for a child account
- **Accounting Period**: Configurable time frame for tracking expenses (default: calendar month)
- **Category**: Predefined expense types (snacks, toys, crafts, games, etc.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Parents can complete family account setup (parent + 1 child) in under 5 minutes
- **SC-002**: Teens can record an expense in under 30 seconds from login
- **SC-003**: 95% of expense entries require no corrections or edits after initial entry
- **SC-004**: Current balance remains visible 100% of the time while scrolling expense list
- **SC-005**: Report generation completes in under 3 seconds for up to 12 months of data
- **SC-006**: 90% of teen users can independently navigate and use core features without parent help
- **SC-007**: Theme switching occurs instantly without page reload or data loss
- **SC-008**: Parents can switch between children's accounts in under 2 seconds
- **SC-009**: System maintains 99.9% accuracy in balance calculations across all operations

## Assumptions

- Email addresses are unique and valid (though not verified programmatically)
- Parents are trusted to create appropriate child accounts
- All monetary amounts are in the currency selected during parent account setup
- Expense categories are sufficient for typical teen spending patterns
- Local device storage is acceptable for offline functionality
- Export functionality doesn't require complex formatting or charts
- Static hosting on GitHub Pages is sufficient (no server-side processing required)
- All authentication and data processing happens client-side
- Custom domain can be configured through GitHub Pages settings