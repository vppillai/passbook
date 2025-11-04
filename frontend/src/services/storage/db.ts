import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  ParentAccount,
  ChildAccount,
  Expense,
  FundAddition,
  AccountingPeriod,
  AccountingPeriodBalance,
  PasswordResetToken,
} from '../../types/models';

export class PassbookDatabase extends Dexie {
  parentAccounts!: Table<ParentAccount, string>;
  childAccounts!: Table<ChildAccount, string>;
  expenses!: Table<Expense, string>;
  fundAdditions!: Table<FundAddition, string>;
  accountingPeriods!: Table<AccountingPeriod, string>;
  accountingPeriodBalances!: Table<AccountingPeriodBalance, string>;
  passwordResetTokens!: Table<PasswordResetToken, string>;

  constructor() {
    super('PassbookDB');

    // Define schema - version 3 adds password reset tokens
    this.version(3).stores({
      parentAccounts: 'id, email',
      childAccounts: 'id, parentAccountId, email',
      expenses: 'id, childAccountId, accountingPeriodId, date, [childAccountId+date], [childAccountId+accountingPeriodId]',
      fundAdditions: 'id, childAccountId, accountingPeriodId, date, [childAccountId+date], [childAccountId+accountingPeriodId]',
      accountingPeriods: 'id, parentAccountId, status, [parentAccountId+status], startDate, endDate',
      accountingPeriodBalances: 'id, childAccountId, accountingPeriodId',
      passwordResetTokens: 'id, token, email, expiresAt, [token+used]',
    });

    // Version 4: Add passwordChangedAt field for security
    this.version(4)
      .stores({
        parentAccounts: 'id, email',
        childAccounts: 'id, parentAccountId, email',
        expenses: 'id, childAccountId, accountingPeriodId, date, [childAccountId+date], [childAccountId+accountingPeriodId]',
        fundAdditions: 'id, childAccountId, accountingPeriodId, date, [childAccountId+date], [childAccountId+accountingPeriodId]',
        accountingPeriods: 'id, parentAccountId, status, [parentAccountId+status], startDate, endDate',
        accountingPeriodBalances: 'id, childAccountId, accountingPeriodId',
        passwordResetTokens: 'id, token, email, expiresAt, [token+used]',
      })
      .upgrade(async (tx) => {
        // Migrate existing accounts: set passwordChangedAt to createdAt for existing accounts
        const now = Date.now();
        await tx.table('parentAccounts').toCollection().modify((account) => {
          account.passwordChangedAt = account.passwordChangedAt || account.createdAt || now;
        });
        await tx.table('childAccounts').toCollection().modify((account) => {
          account.passwordChangedAt = account.passwordChangedAt || account.createdAt || now;
        });
      });
  }
}

export const db = new PassbookDatabase();

