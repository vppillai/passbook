# Data Model: Allowance Passbook

**Date**: 2025-11-02  
**Feature**: Allowance expense tracking with parent-child account management

## Entity Definitions

### ParentAccount

Primary account holder who manages the family's financial tracking.

**Fields**:
- `id`: string (UUID) - Unique identifier
- `email`: string - Login email (unique)
- `passwordHash`: string - Encrypted password
- `name`: string - Parent's display name
- `currency`: string - Selected currency code (default: "CAD")
- `accountingPeriodType`: enum ["monthly", "biweekly", "custom"] - Period type (default: "monthly")
- `accountingPeriodStartDay`: number - Day of month/period start (default: 1)
- `theme`: enum ["light", "dark", "system"] - UI theme preference
- `createdAt`: timestamp - Account creation date
- `updatedAt`: timestamp - Last modification date

**Validation Rules**:
- Email must be valid format
- Password minimum 8 characters
- Currency must be valid ISO 4217 code
- accountingPeriodStartDay must be 1-31 for monthly

**Relationships**:
- Has many ChildAccounts (1:N)
- Has many AccountingPeriods (1:N)

### ChildAccount

Individual child account linked to a parent account.

**Fields**:
- `id`: string (UUID) - Unique identifier
- `parentAccountId`: string (UUID) - Link to parent account
- `email`: string - Login email (unique)
- `passwordHash`: string - Encrypted password
- `name`: string - Child's display name
- `currentBalance`: number - Current available balance
- `defaultMonthlyAllowance`: number - Default allowance (default: 100.00)
- `isActive`: boolean - Account active status
- `theme`: enum ["light", "dark", "system"] - UI theme preference
- `createdAt`: timestamp - Account creation date
- `updatedAt`: timestamp - Last modification date

**Validation Rules**:
- Email must be unique across all accounts
- currentBalance can be negative (overdraft)
- defaultMonthlyAllowance must be >= 0

**Relationships**:
- Belongs to one ParentAccount (N:1)
- Has many Expenses (1:N)
- Has many FundAdditions (1:N)
- Has many AccountingPeriodBalances (1:N)

### Expense

Transaction record for money spent.

**Fields**:
- `id`: string (UUID) - Unique identifier
- `childAccountId`: string (UUID) - Which child's expense
- `amount`: number - Amount spent (positive number)
- `category`: string - Expense category
- `description`: string - Item/service description
- `date`: date - Date of expense
- `accountingPeriodId`: string (UUID) - Which period this belongs to
- `createdBy`: enum ["child", "parent"] - Who created the entry
- `createdAt`: timestamp - Entry creation time
- `updatedAt`: timestamp - Last edit time
- `updatedBy`: string (UUID) - ID of user who last edited

**Validation Rules**:
- Amount must be > 0
- Category must be from allowed list
- Date cannot be in future
- Description max 200 characters

**Relationships**:
- Belongs to one ChildAccount (N:1)
- Belongs to one AccountingPeriod (N:1)

### FundAddition

Record of money added to a child's account.

**Fields**:
- `id`: string (UUID) - Unique identifier
- `childAccountId`: string (UUID) - Recipient child account
- `amount`: number - Amount added (positive number)
- `reason`: string - Reason for addition
- `date`: date - Date of addition
- `accountingPeriodId`: string (UUID) - Which period this belongs to
- `addedBy`: string (UUID) - Parent account ID
- `createdAt`: timestamp - Entry creation time

**Validation Rules**:
- Amount must be > 0
- Reason max 200 characters
- Only parents can create fund additions

**Relationships**:
- Belongs to one ChildAccount (N:1)
- Belongs to one AccountingPeriod (N:1)
- Created by one ParentAccount (N:1)

### AccountingPeriod

Configurable time frame for tracking expenses.

**Fields**:
- `id`: string (UUID) - Unique identifier
- `parentAccountId`: string (UUID) - Which family this belongs to
- `startDate`: date - Period start date
- `endDate`: date - Period end date
- `status`: enum ["active", "closed"] - Period status
- `createdAt`: timestamp - Period creation time
- `closedAt`: timestamp - When period was closed (nullable)

**Validation Rules**:
- Only one active period per family
- startDate must be before endDate
- Cannot modify closed periods

**Relationships**:
- Belongs to one ParentAccount (N:1)
- Has many Expenses (1:N)
- Has many FundAdditions (1:N)
- Has many AccountingPeriodBalances (1:N)

### AccountingPeriodBalance

Snapshot of a child's balance for a specific period.

**Fields**:
- `id`: string (UUID) - Unique identifier
- `childAccountId`: string (UUID) - Which child
- `accountingPeriodId`: string (UUID) - Which period
- `openingBalance`: number - Balance at period start
- `totalFunds`: number - Sum of fund additions
- `totalExpenses`: number - Sum of expenses
- `closingBalance`: number - Balance at period end
- `createdAt`: timestamp - Snapshot creation time

**Validation Rules**:
- closingBalance = openingBalance + totalFunds - totalExpenses
- One record per child per period

**Relationships**:
- Belongs to one ChildAccount (N:1)
- Belongs to one AccountingPeriod (N:1)

### Category

Predefined expense categories.

**Fields**:
- `id`: string - Category identifier
- `name`: string - Display name
- `icon`: string - Icon identifier (optional)
- `colorHex`: string - Display color (optional)
- `sortOrder`: number - Display order

**Predefined Categories**:
```javascript
[
  { id: "snacks", name: "Snacks", icon: "🍿", colorHex: "#FFA500", sortOrder: 1 },
  { id: "toys", name: "Toys", icon: "🧸", colorHex: "#FF69B4", sortOrder: 2 },
  { id: "crafts", name: "Crafts", icon: "🎨", colorHex: "#9370DB", sortOrder: 3 },
  { id: "games", name: "Games", icon: "🎮", colorHex: "#00CED1", sortOrder: 4 },
  { id: "books", name: "Books", icon: "📚", colorHex: "#228B22", sortOrder: 5 },
  { id: "clothes", name: "Clothes", icon: "👕", colorHex: "#DC143C", sortOrder: 6 },
  { id: "entertainment", name: "Entertainment", icon: "🎬", colorHex: "#FF4500", sortOrder: 7 },
  { id: "sports", name: "Sports", icon: "⚽", colorHex: "#1E90FF", sortOrder: 8 },
  { id: "school", name: "School", icon: "🎒", colorHex: "#FFD700", sortOrder: 9 },
  { id: "other", name: "Other", icon: "📦", colorHex: "#808080", sortOrder: 10 }
]
```

## State Transitions

### AccountingPeriod States

```
[Created] → active → closed
```

- Created as "active" when parent starts new period
- Automatically closed when new period starts
- Cannot reopen closed periods

### Expense Lifecycle

```
[Created] → [Edited]* → [Historical]
```

- Can be edited multiple times while period is active
- Becomes read-only when period closes
- Edit history tracked via updatedAt/updatedBy

## Data Integrity Rules

### Balance Calculations

1. **Current Balance Update**:
   - On expense creation: `currentBalance = currentBalance - expense.amount`
   - On expense edit: `currentBalance = currentBalance + oldAmount - newAmount`
   - On fund addition: `currentBalance = currentBalance + fundAddition.amount`

2. **Period Balance Snapshot**:
   - Created when period closes
   - Immutable once created
   - Used for historical reporting

### Concurrency Handling

1. **Optimistic Updates**: UI updates immediately, rollback on failure
2. **Conflict Resolution**: Last-write-wins with audit trail
3. **Balance Lock**: Atomic balance updates to prevent race conditions

### Data Retention

1. **Active Data**: All current period data readily accessible
2. **Historical Data**: Previous 24 months kept in active storage
3. **Archive Data**: Older than 24 months can be exported before removal
4. **Deletion**: Soft delete with 30-day recovery window

## Indexes for Performance

### Primary Indexes

- `ParentAccount.email` - Unique index for login
- `ChildAccount.email` - Unique index for login
- `Expense.childAccountId + date` - Compound index for expense queries
- `AccountingPeriod.parentAccountId + status` - Find active period

### Secondary Indexes

- `Expense.accountingPeriodId` - Period-based queries
- `FundAddition.childAccountId + date` - Fund history queries
- `AccountingPeriodBalance.childAccountId` - Historical balance queries

## Privacy & Security

### Encryption

- Passwords: bcrypt with cost factor 12
- Sensitive data at rest: AES-256 encryption
- Data in transit: TLS 1.3 minimum

### Access Control

- Parents: Full access to family data
- Children: Own account data only
- No cross-family data access

### Audit Trail

All modifications tracked with:
- User ID who made change
- Timestamp of change
- Previous value (for critical fields)

## Migration Strategy

### Version Management

- Schema version tracked in metadata
- Backward compatible changes preferred
- Migration scripts for breaking changes

### IndexedDB Migrations

```javascript
// Example migration
db.version(2).stores({
  expenses: '++id, childAccountId, [childAccountId+date], accountingPeriodId',
  // Added compound index for performance
});
```
