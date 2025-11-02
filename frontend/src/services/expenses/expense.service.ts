import { v4 as uuidv4 } from 'uuid';
import { db } from '../storage/db';
import type { Expense, ExpenseCreator } from '../../types/models';
import { validateAmount, sanitizeDescription } from '../../utils/validation';
import { periodService } from '../periods/period.service';

export interface CreateExpenseData {
  childAccountId: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  createdBy: ExpenseCreator;
}

export class ExpenseService {
  async createExpense(data: CreateExpenseData): Promise<Expense> {
    // Validation
    const amountValidation = validateAmount(data.amount);
    if (!amountValidation.valid) {
      throw new Error(amountValidation.message || 'Invalid amount');
    }

    // Get active accounting period for the parent
    const childAccount = await db.childAccounts.get(data.childAccountId);
    if (!childAccount) {
      throw new Error('Child account not found');
    }

    let activePeriod = await periodService.getActivePeriod(childAccount.parentAccountId);
    if (!activePeriod) {
      activePeriod = await periodService.createDefaultPeriod(childAccount.parentAccountId);
    }

    const expense: Expense = {
      id: uuidv4(),
      childAccountId: data.childAccountId,
      amount: data.amount,
      category: data.category,
      description: sanitizeDescription(data.description),
      date: data.date,
      accountingPeriodId: activePeriod.id,
      createdBy: data.createdBy,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      updatedBy: data.childAccountId,
    };

    await db.expenses.add(expense);

    // Update child account balance
    await db.childAccounts.update(data.childAccountId, {
      currentBalance: childAccount.currentBalance - data.amount,
      updatedAt: Date.now(),
    });

    return expense;
  }

  async updateExpense(expenseId: string, updates: Partial<CreateExpenseData>, updatedBy: string): Promise<Expense> {
    const existing = await db.expenses.get(expenseId);
    if (!existing) {
      throw new Error('Expense not found');
    }

    // If amount changed, update balance
    if (updates.amount !== undefined) {
      const amountValidation = validateAmount(updates.amount);
      if (!amountValidation.valid) {
        throw new Error(amountValidation.message || 'Invalid amount');
      }

      const childAccount = await db.childAccounts.get(existing.childAccountId);
      if (!childAccount) {
        throw new Error('Child account not found');
      }

      // Revert old amount and apply new amount
      const balanceChange = existing.amount - updates.amount;
      await db.childAccounts.update(existing.childAccountId, {
        currentBalance: childAccount.currentBalance + balanceChange,
        updatedAt: Date.now(),
      });
    }

    const updated: Expense = {
      ...existing,
      ...(updates.amount !== undefined && { amount: updates.amount }),
      ...(updates.category !== undefined && { category: updates.category }),
      ...(updates.description !== undefined && { description: sanitizeDescription(updates.description) }),
      ...(updates.date !== undefined && { date: updates.date }),
      updatedAt: Date.now(),
      updatedBy,
    };

    await db.expenses.update(expenseId, updated);
    return updated;
  }

  async deleteExpense(expenseId: string): Promise<void> {
    const expense = await db.expenses.get(expenseId);
    if (!expense) {
      throw new Error('Expense not found');
    }

    // Revert balance change
    const childAccount = await db.childAccounts.get(expense.childAccountId);
    if (childAccount) {
      await db.childAccounts.update(expense.childAccountId, {
        currentBalance: childAccount.currentBalance + expense.amount,
        updatedAt: Date.now(),
      });
    }

    await db.expenses.delete(expenseId);
  }

  async getExpensesByChild(childAccountId: string): Promise<Expense[]> {
    return db.expenses.where('childAccountId').equals(childAccountId).toArray();
  }

  async getExpensesByPeriod(accountingPeriodId: string): Promise<Expense[]> {
    return db.expenses.where('accountingPeriodId').equals(accountingPeriodId).toArray();
  }
}

export const expenseService = new ExpenseService();

