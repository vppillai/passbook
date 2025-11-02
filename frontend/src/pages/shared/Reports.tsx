import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Layout } from '../../components/common/Layout';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { ExportMenu } from '../../components/reports/ExportMenu';
import { Button } from '../../components/common/Button';
import { formatCurrencyWithSign } from '../../utils/currency';
import { db } from '../../services/storage/db';
import { periodService } from '../../services/periods/period.service';
import { expenseService } from '../../services/expenses/expense.service';
import { fundService } from '../../services/funds/fund.service';
import type { ChildAccount, Expense, FundAddition, AccountingPeriod } from '../../types/models';
import { formatDateForDisplay } from '../../utils/date';

export const Reports = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showExportModal, setShowExportModal] = useState(false);
  const [childAccount, setChildAccount] = useState<ChildAccount | null>(null);
  const [currency, setCurrency] = useState<string>('CAD');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [fundAdditions, setFundAdditions] = useState<FundAddition[]>([]);
  const [activePeriod, setActivePeriod] = useState<AccountingPeriod | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadReportData();
    }
  }, [user]);

  const loadReportData = async () => {
    if (!user || user.type !== 'parent') return;

    setLoading(true);
    try {
      // Get first child for now (could be enhanced to select)
      const children = await db.childAccounts
        .where('parentAccountId')
        .equals(user.id)
        .toArray();

      if (children.length === 0) {
        setLoading(false);
        return;
      }

      const child = children[0];
      setChildAccount(child);

      // Load parent account to get currency
      const parentAccount = await db.parentAccounts.get(user.id);
      if (parentAccount) {
        setCurrency(parentAccount.currency);
      }

      // Get active period
      const period = await periodService.getActivePeriod(user.id);
      setActivePeriod(period);

      if (period) {
        const [expensesData, fundsData] = await Promise.all([
          expenseService.getExpensesByPeriod(period.id),
          fundService.getFundAdditionsByPeriod(period.id),
        ]);

        setExpenses(expensesData);
        setFundAdditions(fundsData);
      } else {
        // No active period, get all data
        const [expensesData, fundsData] = await Promise.all([
          expenseService.getExpensesByChild(child.id),
          fundService.getFundAdditionsByChild(child.id),
        ]);

        setExpenses(expensesData);
        setFundAdditions(fundsData);
      }
    } catch (error) {
      console.error('Failed to load report data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getPeriodLabel = (): string | undefined => {
    if (!activePeriod) return undefined;
    return `${formatDateForDisplay(activePeriod.startDate)} - ${formatDateForDisplay(activePeriod.endDate)}`;
  };

  if (loading) {
    return (
      <Layout title="Export Reports" showBack onBack={() => navigate(-1)}>
        <LoadingSpinner size="lg" className="py-12" />
      </Layout>
    );
  }

  if (!childAccount) {
    return (
      <Layout title="Export Reports" showBack onBack={() => navigate(-1)}>
        <div className="text-center text-gray-600 dark:text-gray-400 py-8">
          No child accounts found
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Export Reports" showBack onBack={() => navigate(-1)}>
      <div className="space-y-6 max-w-2xl">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            {childAccount.name} - Report
          </h2>

          <div className="space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Total Expenses:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrencyWithSign(expenses.reduce((sum, exp) => sum + exp.amount, 0), currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Total Funds Added:</span>
              <span className="font-semibold text-gray-900 dark:text-gray-100">
                {formatCurrencyWithSign(fundAdditions.reduce((sum, fund) => sum + fund.amount, 0), currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Current Balance:</span>
              <span
                className={`font-semibold ${
                  childAccount.currentBalance < 0
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-900 dark:text-gray-100'
                }`}
              >
                {formatCurrencyWithSign(childAccount.currentBalance, currency)}
              </span>
            </div>
          </div>

          <Button onClick={() => setShowExportModal(true)} className="w-full">
            Export Report
          </Button>
        </div>
      </div>

      {childAccount && (
        <ExportMenu
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          childName={childAccount.name}
          expenses={expenses}
          fundAdditions={fundAdditions}
          periodLabel={getPeriodLabel()}
          currency={currency}
        />
      )}
    </Layout>
  );
};

