import { db } from '../storage/db';
import type { Expense } from '../../types/models';
import { PREDEFINED_CATEGORIES } from '../../data/categories';

export interface CategoryBreakdown {
  categoryId: string;
  categoryName: string;
  amount: number;
  percentage: number;
  icon: string;
  colorHex: string;
}

export interface SpendingTrend {
  date: string;
  amount: number;
  label: string;
}

export type TimeGranularity = 'daily' | 'weekly' | 'monthly';

export class AnalyticsService {
  async getCategoryBreakdown(
    childAccountId: string,
    accountingPeriodId?: string
  ): Promise<CategoryBreakdown[]> {
    let expenses: Expense[];

    if (accountingPeriodId) {
      expenses = await db.expenses
        .where('[childAccountId+accountingPeriodId]')
        .equals([childAccountId, accountingPeriodId])
        .toArray();
    } else {
      expenses = await db.expenses.where('childAccountId').equals(childAccountId).toArray();
    }

    // Group by category
    const categoryMap = new Map<string, number>();

    expenses.forEach((expense) => {
      const current = categoryMap.get(expense.category) || 0;
      categoryMap.set(expense.category, current + expense.amount);
    });

    const total = Array.from(categoryMap.values()).reduce((sum, amount) => sum + amount, 0);

    const breakdown: CategoryBreakdown[] = Array.from(categoryMap.entries())
      .map(([categoryId, amount]) => {
        const category = PREDEFINED_CATEGORIES.find((c) => c.id === categoryId);
        return {
          categoryId,
          categoryName: category?.name || categoryId,
          amount,
          percentage: total > 0 ? (amount / total) * 100 : 0,
          icon: category?.icon || '📦',
          colorHex: category?.colorHex || '#808080',
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return breakdown;
  }

  async getSpendingTrends(
    childAccountId: string,
    accountingPeriodId: string,
    granularity: TimeGranularity = 'daily'
  ): Promise<SpendingTrend[]> {
    const expenses = await db.expenses
      .where('childAccountId')
      .equals(childAccountId)
      .toArray();

    // Filter by accounting period
    const periodExpenses = expenses.filter(
      (exp) => exp.accountingPeriodId === accountingPeriodId
    );

    if (periodExpenses.length === 0) {
      return [];
    }

    // Group by time period
    const trendMap = new Map<string, number>();

    periodExpenses.forEach((expense) => {
      const date = new Date(expense.date);
      let key: string;

      switch (granularity) {
        case 'daily':
          key = expense.date;
          break;
        case 'weekly': {
          // Get week start (Sunday)
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          weekStart.setHours(0, 0, 0, 0);
          key = weekStart.toISOString().split('T')[0];
          break;
        }
        case 'monthly': {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        }
        default:
          key = expense.date;
      }

      const current = trendMap.get(key) || 0;
      trendMap.set(key, current + expense.amount);
    });

    // Convert to array and sort by date
    const trends: SpendingTrend[] = Array.from(trendMap.entries())
      .map(([date, amount]) => {
        // Get label from first expense with this key
        const sampleExpense = periodExpenses.find((exp) => {
          const expDate = new Date(exp.date);
          switch (granularity) {
            case 'daily':
              return exp.date === date;
            case 'weekly': {
              const weekStart = new Date(expDate);
              weekStart.setDate(expDate.getDate() - expDate.getDay());
              weekStart.setHours(0, 0, 0, 0);
              return weekStart.toISOString().split('T')[0] === date;
            }
            case 'monthly':
              return `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}` === date;
            default:
              return false;
          }
        });

        let label = date;
        if (sampleExpense) {
          const expDate = new Date(sampleExpense.date);
          switch (granularity) {
            case 'daily':
              label = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              break;
            case 'weekly': {
              const weekStart = new Date(expDate);
              weekStart.setDate(expDate.getDate() - expDate.getDay());
              weekStart.setHours(0, 0, 0, 0);
              label = `Week of ${weekStart.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              })}`;
              break;
            }
            case 'monthly':
              label = expDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
              break;
          }
        }

        return { date, amount, label };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return trends;
  }
}

export const analyticsService = new AnalyticsService();

