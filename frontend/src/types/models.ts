// Type definitions for Teen Passbook entities

export type Theme = 'light' | 'dark' | 'system';
export type AccountingPeriodType = 'monthly' | 'biweekly' | 'custom';
export type AccountingPeriodStatus = 'active' | 'closed';
export type ExpenseCreator = 'teen' | 'parent';

export interface ParentAccount {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  currency: string; // ISO 4217 code, default: "CAD"
  accountingPeriodType: AccountingPeriodType;
  accountingPeriodStartDay: number; // 1-31 for monthly
  theme: Theme;
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
}

export interface ChildAccount {
  id: string;
  parentAccountId: string;
  email: string;
  passwordHash: string;
  name: string;
  currentBalance: number; // can be negative
  defaultMonthlyAllowance: number; // default: 100.00
  isActive: boolean;
  theme: Theme;
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
}

export interface Expense {
  id: string;
  childAccountId: string;
  amount: number; // positive number
  category: string;
  description: string; // max 200 characters
  date: string; // ISO date string
  accountingPeriodId: string;
  createdBy: ExpenseCreator;
  createdAt: number; // timestamp
  updatedAt: number; // timestamp
  updatedBy: string; // user ID who last edited
}

export interface FundAddition {
  id: string;
  childAccountId: string;
  amount: number; // positive number
  reason: string; // max 200 characters
  date: string; // ISO date string
  accountingPeriodId: string;
  addedBy: string; // parent account ID
  createdAt: number; // timestamp
}

export interface AccountingPeriod {
  id: string;
  parentAccountId: string;
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  status: AccountingPeriodStatus;
  createdAt: number; // timestamp
  closedAt: number | null; // timestamp when closed
}

export interface AccountingPeriodBalance {
  id: string;
  childAccountId: string;
  accountingPeriodId: string;
  openingBalance: number;
  totalFunds: number;
  totalExpenses: number;
  closingBalance: number;
  createdAt: number; // timestamp
}

export interface Category {
  id: string;
  name: string;
  icon: string; // emoji or icon identifier
  colorHex: string;
  sortOrder: number;
}

// Auth-related types
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  type: 'parent' | 'child';
  parentAccountId?: string; // only for child accounts
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface SignupData {
  email: string;
  password: string;
  name: string;
  currency?: string;
}

