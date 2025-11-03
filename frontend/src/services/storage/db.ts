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
  }
}

export const db = new PassbookDatabase();

