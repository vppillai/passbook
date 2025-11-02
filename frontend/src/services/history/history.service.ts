import { db } from '../storage/db';
import type { Expense, FundAddition, AccountingPeriod } from '../../types/models';

export class HistoryService {
  async getPeriods(parentAccountId: string): Promise<AccountingPeriod[]> {
    return db.accountingPeriods
      .where('parentAccountId')
      .equals(parentAccountId)
      .reverse()
      .sortBy('startDate');
  }

  async getExpensesForPeriod(periodId: string): Promise<Expense[]> {
    return db.expenses
      .where('accountingPeriodId')
      .equals(periodId)
      .reverse()
      .sortBy('date');
  }

  async getFundAdditionsForPeriod(periodId: string): Promise<FundAddition[]> {
    return db.fundAdditions
      .where('accountingPeriodId')
      .equals(periodId)
      .reverse()
      .sortBy('date');
  }

  async getExpensesByDateRange(
    childAccountId: string,
    startDate: number,
    endDate: number
  ): Promise<Expense[]> {
    return db.expenses
      .where('[childAccountId+date]')
      .between([childAccountId, startDate], [childAccountId, endDate], true, true)
      .reverse()
      .sortBy('date');
  }

  async getFundAdditionsByDateRange(
    childAccountId: string,
    startDate: number,
    endDate: number
  ): Promise<FundAddition[]> {
    return db.fundAdditions
      .where('[childAccountId+date]')
      .between([childAccountId, startDate], [childAccountId, endDate], true, true)
      .reverse()
      .sortBy('date');
  }
}

export const historyService = new HistoryService();

