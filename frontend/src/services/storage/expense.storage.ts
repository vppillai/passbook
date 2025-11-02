import { db } from './db';
import type { Expense } from '../../types/models';

export const expenseStorage = {
  async getById(id: string): Promise<Expense | undefined> {
    return db.expenses.get(id);
  },

  async getByChildId(childAccountId: string): Promise<Expense[]> {
    return db.expenses.where('childAccountId').equals(childAccountId).sortBy('date');
  },

  async getByPeriod(accountingPeriodId: string): Promise<Expense[]> {
    return db.expenses.where('accountingPeriodId').equals(accountingPeriodId).sortBy('date');
  },

  async getByChildAndPeriod(childAccountId: string, accountingPeriodId: string): Promise<Expense[]> {
    return db.expenses
      .where('[childAccountId+date]')
      .between([childAccountId, 0], [childAccountId, Date.now()], true, true)
      .filter(expense => expense.accountingPeriodId === accountingPeriodId)
      .sortBy('date');
  },

  async create(expense: Expense): Promise<string> {
    return db.expenses.add(expense);
  },

  async update(id: string, updates: Partial<Expense>): Promise<number> {
    return db.expenses.update(id, { ...updates, updatedAt: Date.now() });
  },

  async delete(id: string): Promise<void> {
    return db.expenses.delete(id);
  },
};

