import React, { useState, useEffect } from 'react';
import type { ChildAccount } from '../../types/models';
import { balanceService } from '../../services/balance/balance.service';

interface ChildFinancialSummaryProps {
  child: ChildAccount;
  currency: string;
  accountingPeriodId: string;
}

export const ChildFinancialSummary: React.FC<ChildFinancialSummaryProps> = ({
  child,
  currency,
  accountingPeriodId,
}) => {
  const [summary, setSummary] = useState<{
    openingBalance: number;
    totalFunds: number;
    totalExpenses: number;
    currentBalance: number;
  } | null>(null);

  useEffect(() => {
    loadSummary();
  }, [child.id, accountingPeriodId]);

  const loadSummary = async () => {
    try {
      const info = await balanceService.getBalanceInfo(child.id, accountingPeriodId);
      setSummary(info);
    } catch (error) {
      console.error('Failed to load summary:', error);
    }
  };

  if (!summary) {
    return <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">
        Financial Summary for {child.name}
      </h3>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">Opening Balance</p>
          <p className="text-lg font-semibold text-gray-900 dark:text-white">
            {formatCurrency(summary.openingBalance)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Funds Added</p>
          <p className="text-lg font-semibold text-green-600 dark:text-green-400">
            +{formatCurrency(summary.totalFunds)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Expenses</p>
          <p className="text-lg font-semibold text-red-600 dark:text-red-400">
            -{formatCurrency(summary.totalExpenses)}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400">Current Balance</p>
          <p
            className={`text-lg font-semibold ${
              summary.currentBalance < 0
                ? 'text-red-600 dark:text-red-400'
                : 'text-green-600 dark:text-green-400'
            }`}
          >
            {formatCurrency(summary.currentBalance)}
          </p>
        </div>
      </div>
    </div>
  );
};

