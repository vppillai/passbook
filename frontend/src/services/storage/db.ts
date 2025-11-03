import Dexie from 'dexie';
import type { Table } from 'dexie';
import type {
  ParentAccount,
  ChildAccount,
  Expense,
  FundAddition,
  AccountingPeriod,
  AccountingPeriodBalance,
} from '../../types/models';

export class PassbookDatabase extends Dexie {
  parentAccounts!: Table<ParentAccount, string>;
  childAccounts!: Table<ChildAccount, string>;
  expenses!: Table<Expense, string>;
  fundAdditions!: Table<FundAddition, string>;
  accountingPeriods!: Table<AccountingPeriod, string>;
  accountingPeriodBalances!: Table<AccountingPeriodBalance, string>;

  constructor() {
    super('PassbookDB');

    // Define schema - incremented version due to adding compound indexes
    this.version(2).stores({
      parentAccounts: 'id, email',
      childAccounts: 'id, parentAccountId, email',
      expenses: 'id, childAccountId, accountingPeriodId, date, [childAccountId+date], [childAccountId+accountingPeriodId]',
      fundAdditions: 'id, childAccountId, accountingPeriodId, date, [childAccountId+date], [childAccountId+accountingPeriodId]',
      accountingPeriods: 'id, parentAccountId, status, [parentAccountId+status], startDate, endDate',
      accountingPeriodBalances: 'id, childAccountId, accountingPeriodId',
    });
  }
}

export const db = new PassbookDatabase();

