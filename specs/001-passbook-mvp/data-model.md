# Data Model: Passbook MVP

**Feature**: Family Allowance Management System  
**Date**: 2025-11-07  
**Backend**: AWS DynamoDB (NoSQL)

## Overview

The data model uses DynamoDB's single-table design pattern for cost efficiency and performance. Each entity includes audit fields for tracking changes and supporting data recovery.

## Entity Definitions

### 1. Family Account

**Table**: `passbook-families`  
**Purpose**: Central organizing unit for parents and children

```typescript
interface FamilyAccount {
  // Keys
  familyId: string;          // UUID, Partition Key
  SK: "FAMILY";              // Sort Key (constant for family record)
  
  // Attributes
  familyName: string;        // Display name for the family
  description?: string;      // Optional family description
  currency: string;          // ISO 4217 code (e.g., "CAD", "USD")
  timezone: string;          // IANA timezone (e.g., "America/Toronto")
  
  // Audit
  createdAt: string;         // ISO 8601 timestamp
  createdBy: string;         // userId of creator
  updatedAt: string;         // ISO 8601 timestamp
  updatedBy: string;         // userId of last updater
  
  // Settings
  reminderTime: string;      // HH:MM format in family timezone
  reminderThreshold: number; // Amount below which to send reminders
}
```

### 2. Parent Account

**Table**: `passbook-families`  
**Purpose**: Account manager with administrative rights

```typescript
interface ParentAccount {
  // Keys
  familyId: string;          // Partition Key (same as family)
  SK: string;                // Sort Key: "PARENT#{userId}"
  
  // Attributes
  userId: string;            // UUID for this parent
  email: string;             // Unique email address
  displayName: string;       // Name shown in UI
  passwordHash: string;      // Bcrypt hash
  
  // Status
  status: "pending" | "active" | "suspended";
  emailVerified: boolean;
  
  // Invitations
  invitedBy?: string;        // userId of inviting parent
  invitationToken?: string;  // For pending invitations
  invitationExpiry?: string; // ISO 8601 timestamp
  
  // Audit
  createdAt: string;         // ISO 8601 timestamp
  lastLoginAt?: string;      // ISO 8601 timestamp
  passwordChangedAt: string; // ISO 8601 timestamp
}

// GSI: email-index
// PK: email
// Allows lookup by email for login and uniqueness check
```

### 3. Child Account

**Table**: `passbook-families`  
**Purpose**: Limited-privilege account for expense tracking

```typescript
interface ChildAccount {
  // Keys
  familyId: string;          // Partition Key
  SK: string;                // Sort Key: "CHILD#{userId}"
  
  // Attributes
  userId: string;            // UUID for this child
  username?: string;         // Optional username (unique within family)
  email?: string;            // Optional email (for email-based login)
  displayName: string;       // Child's display name
  passwordHash: string;      // Bcrypt hash
  
  // Financial
  currentBalance: number;    // Current balance in currency units
  overdraftLimit: number;    // How negative balance can go (default: 0)
  
  // Settings
  fundingPeriod?: {
    type: "weekly" | "biweekly" | "monthly" | "custom";
    nextFundingDate?: string;  // ISO 8601 date
    amount?: number;           // Expected funding amount
  };
  
  // Notifications
  notificationsEnabled: boolean;
  deviceTokens?: string[];   // Push notification tokens
  
  // Audit
  createdAt: string;         // ISO 8601 timestamp
  createdBy: string;         // Parent userId who created
  lastActivityAt?: string;   // ISO 8601 timestamp
  
  // Status
  status: "active" | "suspended";
}

// GSI: username-family-index (sparse)
// PK: familyId
// SK: username
// Allows username uniqueness check within family
```

### 4. Fund Addition

**Table**: `passbook-transactions`  
**Purpose**: Record of money added to child account

```typescript
interface FundAddition {
  // Keys
  childUserId: string;       // Partition Key
  SK: string;                // Sort Key: "FUND#{timestamp}#{transactionId}"
  
  // Attributes
  transactionId: string;     // UUID
  familyId: string;          // For access control
  amount: number;            // Positive amount added
  currency: string;          // Currency code (denormalized)
  reason: string;            // Description of funding
  
  // Metadata
  addedBy: string;           // Parent userId
  addedAt: string;           // ISO 8601 timestamp
  
  // Accounting
  periodId?: string;         // Links to accounting period
  balanceAfter: number;      // Balance after this transaction
}
```

### 5. Expense

**Table**: `passbook-transactions`  
**Purpose**: Spending transaction reducing balance

```typescript
interface Expense {
  // Keys
  childUserId: string;       // Partition Key
  SK: string;                // Sort Key: "EXPENSE#{date}#{transactionId}"
  
  // Attributes
  transactionId: string;     // UUID
  familyId: string;          // For access control
  amount: number;            // Positive amount spent
  currency: string;          // Currency code (denormalized)
  category: ExpenseCategory; // Enumerated categories
  description: string;       // What was purchased
  expenseDate: string;       // ISO 8601 date (user-provided)
  
  // Metadata
  recordedBy: string;        // userId (child or parent)
  recordedAt: string;        // ISO 8601 timestamp
  isParentRecorded: boolean; // True if parent added on behalf
  
  // Editing
  lastEditedBy?: string;     // userId of editor
  lastEditedAt?: string;     // ISO 8601 timestamp
  editHistory?: EditRecord[];// Array of previous values
  
  // Accounting
  periodId?: string;         // Links to accounting period
  balanceAfter: number;      // Balance after this transaction
  wasOverdraft: boolean;     // True if resulted in negative balance
}

type ExpenseCategory = 
  | "snacks" | "food" | "games" | "sports" 
  | "school" | "crafts" | "toys" | "books" 
  | "clothes" | "entertainment" | "other";

interface EditRecord {
  editedBy: string;
  editedAt: string;
  previousValues: {
    amount?: number;
    category?: ExpenseCategory;
    description?: string;
    expenseDate?: string;
  };
}
```

### 6. Accounting Period

**Table**: `passbook-families`  
**Purpose**: Time boundaries for financial tracking

```typescript
interface AccountingPeriod {
  // Keys
  familyId: string;          // Partition Key
  SK: string;                // Sort Key: "PERIOD#{startDate}"
  
  // Attributes
  periodId: string;          // UUID
  type: "weekly" | "biweekly" | "monthly" | "custom";
  startDate: string;         // ISO 8601 date
  endDate: string;           // ISO 8601 date
  status: "active" | "closed";
  
  // Summary data (denormalized for performance)
  childSummaries: {
    [childUserId: string]: {
      startingBalance: number;
      totalFunded: number;
      totalExpenses: number;
      endingBalance: number;
      expensesByCategory: {
        [category: string]: number;
      };
      transactionCount: number;
    };
  };
  
  // Audit
  closedAt?: string;         // ISO 8601 timestamp
  closedBy?: string;         // userId who closed period
}
```

### 7. Email Verification

**Table**: `passbook-auth`  
**Purpose**: Track email verification tokens

```typescript
interface EmailVerification {
  // Keys
  token: string;             // Partition Key (secure random)
  SK: "EMAIL_VERIFY";        // Sort Key (constant)
  
  // Attributes
  email: string;             // Email being verified
  userId: string;            // User requesting verification
  type: "activation" | "passwordReset" | "invitation";
  
  // Expiry
  expiresAt: string;         // ISO 8601 timestamp
  createdAt: string;         // ISO 8601 timestamp
  
  // TTL
  ttl: number;               // Unix timestamp for DynamoDB TTL
}
```

## Access Patterns

### Primary Queries

1. **Get family by ID**: Query `familyId = X, SK = "FAMILY"`
2. **List family members**: Query `familyId = X, SK begins_with "PARENT"` or `"CHILD"`
3. **Get transactions for child**: Query `childUserId = X` with date range
4. **Login by email**: Query GSI `email = X`
5. **Check username uniqueness**: Query GSI `familyId = X, username = Y`

### Write Patterns

1. **Add expense**: Write to transactions table, update child balance atomically
2. **Add funds**: Write to transactions table, update child balance atomically  
3. **Close period**: Update period record, create new active period
4. **Invite parent**: Write parent record with pending status, create verification token

## Indexes

### Primary Table: passbook-families
- **Partition Key**: familyId
- **Sort Key**: SK
- **GSI**: email-index (for parent login)
- **GSI**: username-family-index (sparse, for child username uniqueness)

### Transactions Table: passbook-transactions  
- **Partition Key**: childUserId
- **Sort Key**: SK
- **LSI**: family-date-index (familyId, expenseDate)

### Auth Table: passbook-auth
- **Partition Key**: token
- **Sort Key**: SK
- **TTL**: ttl field for automatic cleanup

## Data Integrity

1. **Balance Consistency**: Use DynamoDB transactions for atomic updates
2. **Username Uniqueness**: Enforced via conditional writes on GSI
3. **Email Uniqueness**: Enforced via conditional writes on GSI
4. **Foreign Keys**: Application-level validation (no FK constraints in NoSQL)
5. **Audit Trail**: All mutations include who/when metadata

## Migration Considerations

1. **Schema Evolution**: Add new attributes without breaking existing records
2. **Index Changes**: Can add GSIs without downtime
3. **Data Export**: Use DynamoDB Streams for change data capture
4. **Backup**: Point-in-time recovery enabled on all tables

