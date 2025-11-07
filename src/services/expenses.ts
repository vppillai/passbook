/**
 * Expense service for managing expenses
 */
import { apiClient } from './api';
import { Expense } from '../types';
import { offlineQueue } from './offlineQueue';
import { syncService } from './syncService';

class ExpensesService {
  /**
   * Add an expense
   */
  async addExpense(data: {
    childUserId?: string;
    amount: number;
    category: string;
    description: string;
    expenseDate?: string;
  }): Promise<{
    transactionId: string;
    amount: number;
    currency: string;
    newBalance: number;
    wasOverdraft: boolean;
  }> {
    const isOnline = await syncService.isOnline();

    if (!isOnline) {
      // Queue for offline sync
      await offlineQueue.addOperation('expense', data);
      // Return optimistic response
      return {
        transactionId: `offline_${Date.now()}`,
        amount: data.amount,
        currency: 'CAD',
        newBalance: 0, // Will be updated after sync
        wasOverdraft: false,
      };
    }

    try {
      const response = await apiClient.post<{
        message: string;
        transactionId: string;
        amount: number;
        currency: string;
        newBalance: number;
        wasOverdraft: boolean;
        overdraftWarning: boolean;
      }>('/transactions/expenses', data);

      return {
        transactionId: response.transactionId,
        amount: response.amount,
        currency: response.currency,
        newBalance: response.newBalance,
        wasOverdraft: response.wasOverdraft,
      };
    } catch (error: any) {
      // If network error, queue for offline sync
      if (!error.response) {
        await offlineQueue.addOperation('expense', data);
        return {
          transactionId: `offline_${Date.now()}`,
          amount: data.amount,
          currency: 'CAD',
          newBalance: 0,
          wasOverdraft: false,
        };
      }
      throw error;
    }
  }

  /**
   * List expenses for a child
   */
  async listExpenses(childUserId?: string, options?: {
    limit?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<Expense[]> {
    const params = new URLSearchParams();
    if (childUserId) {
      params.append('childUserId', childUserId);
    }
    if (options?.limit) {
      params.append('limit', options.limit.toString());
    }
    if (options?.startDate) {
      params.append('startDate', options.startDate);
    }
    if (options?.endDate) {
      params.append('endDate', options.endDate);
    }

    const queryString = params.toString();
    const url = `/transactions/expenses${queryString ? `?${queryString}` : ''}`;

    const response = await apiClient.get<{
      expenses: Expense[];
      count: number;
    }>(url);

    return response.expenses;
  }

  /**
   * Update an expense
   */
  async updateExpense(
    transactionId: string,
    updates: {
      amount?: number;
      category?: string;
      description?: string;
      expenseDate?: string;
    }
  ): Promise<void> {
    await apiClient.put(`/transactions/expenses/${transactionId}`, updates);
  }

  /**
   * Get a specific expense
   */
  async getExpense(transactionId: string): Promise<Expense> {
    // Note: This would require a GSI on transactionId in production
    // For now, we'll get it from the list
    const expenses = await this.listExpenses();
    const expense = expenses.find(e => e.transactionId === transactionId);
    if (!expense) {
      throw new Error('Expense not found');
    }
    return expense;
  }
}

export const expensesService = new ExpensesService();
