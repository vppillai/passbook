import { db } from './db';
import type { Expense } from '../../types/models';

export const expenseStorage = {
  async getById(id: string): Promise<Expense | undefined> {
    return db.expenses.get(id);
  },

  async getByChildId(childAccountId: string): Promise<Expense[]> {
    const expenses = await db.expenses.where('childAccountId').equals(childAccountId).toArray();
    // Sort by date descending (most recent first), then by creation time descending
    return expenses.sort((a, b) => {
      const dateComparison = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateComparison === 0) {
        return b.createdAt - a.createdAt;
      }
      return dateComparison;
    });
  },

  async getByPeriod(accountingPeriodId: string): Promise<Expense[]> {
    const expenses = await db.expenses.where('accountingPeriodId').equals(accountingPeriodId).toArray();
    // Sort by date descending (most recent first), then by creation time descending
    return expenses.sort((a, b) => {
      const dateComparison = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateComparison === 0) {
        return b.createdAt - a.createdAt;
      }
      return dateComparison;
    });
  },

  async getByChildAndPeriod(childAccountId: string, accountingPeriodId: string): Promise<Expense[]> {
    const expenses = await db.expenses
      .where('[childAccountId+date]')
      .between([childAccountId, 0], [childAccountId, Date.now()], true, true)
      .filter(expense => expense.accountingPeriodId === accountingPeriodId)
      .toArray();

    // Sort by date descending (most recent first), then by creation time descending
    return expenses.sort((a, b) => {
      const dateComparison = new Date(b.date).getTime() - new Date(a.date).getTime();
      if (dateComparison === 0) {
        return b.createdAt - a.createdAt;
      }
      return dateComparison;
    });
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

