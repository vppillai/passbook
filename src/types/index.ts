/**
 * Base TypeScript interfaces and types for Passbook application
 */

// User Types
export type UserType = 'parent' | 'child';
export type AccountStatus = 'pending' | 'active' | 'suspended';

// Expense Categories
export type ExpenseCategory =
  | 'snacks'
  | 'food'
  | 'games'
  | 'sports'
  | 'school'
  | 'crafts'
  | 'toys'
  | 'books'
  | 'clothes'
  | 'entertainment'
  | 'other';

// Accounting Period Types
export type PeriodType = 'weekly' | 'biweekly' | 'monthly' | 'custom';

// Family Account
export interface FamilyAccount {
  familyId: string;
  familyName: string;
  description?: string;
  currency: string; // ISO 4217 code
  timezone: string; // IANA timezone
  reminderTime: string; // HH:MM format
  reminderThreshold: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

// Parent Account
export interface ParentAccount {
  userId: string;
  familyId: string;
  email: string;
  displayName: string;
  status: AccountStatus;
  emailVerified: boolean;
  invitedBy?: string;
  invitationToken?: string;
  invitationExpiry?: string;
  createdAt: string;
  lastLoginAt?: string;
  passwordChangedAt: string;
}

// Child Account
export interface ChildAccount {
  userId: string;
  familyId: string;
  username?: string;
  email?: string;
  displayName: string;
  currentBalance: number;
  overdraftLimit: number;
  fundingPeriod?: {
    type: PeriodType;
    nextFundingDate?: string;
    amount?: number;
  };
  notificationsEnabled: boolean;
  deviceTokens?: string[];
  createdAt: string;
  createdBy: string;
  lastActivityAt?: string;
  status: AccountStatus;
}

// Fund Addition
export interface FundAddition {
  transactionId: string;
  childUserId: string;
  familyId: string;
  amount: number;
  currency: string;
  reason: string;
  addedBy: string;
  addedAt: string;
  periodId?: string;
  balanceAfter: number;
}

// Expense
export interface Expense {
  transactionId: string;
  childUserId: string;
  familyId: string;
  amount: number;
  currency: string;
  category: ExpenseCategory;
  description: string;
  expenseDate: string; // ISO 8601 date
  recordedBy: string;
  recordedAt: string;
  isParentRecorded: boolean;
  lastEditedBy?: string;
  lastEditedAt?: string;
  editHistory?: EditRecord[];
  periodId?: string;
  balanceAfter: number;
  wasOverdraft: boolean;
}

export interface EditRecord {
  editedBy: string;
  editedAt: string;
  previousValues: {
    amount?: number;
    category?: ExpenseCategory;
    description?: string;
    expenseDate?: string;
  };
}

// Accounting Period
export interface AccountingPeriod {
  periodId: string;
  familyId: string;
  type: PeriodType;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed';
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
  closedAt?: string;
  closedBy?: string;
}

// Email Verification
export interface EmailVerification {
  token: string;
  email: string;
  userId: string;
  type: 'activation' | 'passwordReset' | 'invitation';
  expiresAt: string;
  createdAt: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  message?: string;
}

export interface AuthResponse {
  token: string;
  user: ParentAccount | ChildAccount;
  familyId?: string;
}

export interface LoginRequest {
  email?: string;
  username?: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  displayName: string;
}

// Analytics Types
export interface CategoryBreakdown {
  category: ExpenseCategory;
  amount: number;
  percentage: number;
}

export interface SpendingTrend {
  date: string;
  amount: number;
}

export interface AnalyticsData {
  categoryBreakdown: CategoryBreakdown[];
  spendingTrends: SpendingTrend[];
  totalExpenses: number;
  totalFunded: number;
  netBalance: number;
  period: {
    startDate: string;
    endDate: string;
  };
}

// Navigation Types
export type RootStackParamList = {
  Login: undefined;
  Signup: undefined;
  EmailVerification: { token?: string };
  FamilySetup: undefined;
  ParentDashboard: undefined;
  ChildManagement: undefined;
  AddFunds: { childUserId?: string };
  ParentManagement: undefined;
  ChildDashboard: undefined;
  AddExpense: undefined;
  ExpenseList: undefined;
  Analytics: { childUserId?: string };
  Settings: undefined;
  NotificationSettings: undefined;
  PasswordReset: { token?: string };
};

// Store Types
export interface AuthState {
  isAuthenticated: boolean;
  user: ParentAccount | ChildAccount | null;
  token: string | null;
  familyId: string | null;
}

export interface ChildrenState {
  children: ChildAccount[];
  loading: boolean;
  error: string | null;
}

export interface ExpensesState {
  expenses: Expense[];
  loading: boolean;
  error: string | null;
}
