import { useState, useEffect } from 'react';
import { db } from '../../services/storage/db';
import type { Expense } from '../../types/models';
import { ExpenseItem } from './ExpenseItem';

interface ExpenseListProps {
  childAccountId: string;
  accountingPeriodId?: string;
  currency?: string;
  onEdit?: (expense: Expense) => void;
  onDelete?: (expense: Expense) => void;
  refreshTrigger?: number; // Add refresh trigger
}

export const ExpenseList = ({ childAccountId, accountingPeriodId, currency, onEdit, onDelete, refreshTrigger }: ExpenseListProps) => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExpenses();
  }, [childAccountId, accountingPeriodId, refreshTrigger]);

  const loadExpenses = async () => {
    try {
      let query = db.expenses.where('childAccountId').equals(childAccountId);

      if (accountingPeriodId) {
        query = query.and((expense) => expense.accountingPeriodId === accountingPeriodId);
      }

      const expensesList = await query.toArray();
      // Sort by date descending (most recent first)
      expensesList.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setExpenses(expensesList);
    } catch (error) {
      console.error('Failed to load expenses:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-center text-gray-600 dark:text-gray-400 py-8">Loading expenses...</div>;
  }

  if (expenses.length === 0) {
    return (
      <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
        <p className="text-gray-600 dark:text-gray-400">No expenses yet.</p>
        <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
          Tap the + button to add your first expense
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {expenses.map((expense) => (
        <ExpenseItem
          key={expense.id}
          expense={expense}
          currency={currency}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

