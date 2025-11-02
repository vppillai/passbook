import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Layout } from '../../components/common/Layout';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { PieChart } from '../../components/reports/PieChart';
import { LineGraph } from '../../components/reports/LineGraph';
import { TimeGranularitySelector } from '../../components/reports/TimeGranularitySelector';
import { analyticsService } from '../../services/analytics/analytics.service';
import type { CategoryBreakdown, SpendingTrend, TimeGranularity } from '../../services/analytics/analytics.service';
import { periodService } from '../../services/periods/period.service';
import { db } from '../../services/storage/db';

export const Analytics = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [categoryBreakdown, setCategoryBreakdown] = useState<CategoryBreakdown[]>([]);
  const [spendingTrends, setSpendingTrends] = useState<SpendingTrend[]>([]);
  const [currency, setCurrency] = useState<string>('CAD');
  const [granularity, setGranularity] = useState<TimeGranularity>('daily');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadAnalytics();
    }
  }, [user, granularity]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAnalytics = async () => {
    if (!user) return;

    setLoading(true);
    try {
      let childAccountId: string;
      let parentAccountId: string;

      if (user.type === 'child') {
        const childAccount = await db.childAccounts.get(user.id);
        if (!childAccount) {
          setLoading(false);
          return;
        }
        childAccountId = childAccount.id;
        parentAccountId = childAccount.parentAccountId;
      } else {
        // For parent view, we'd need to select a child - for now, use first child
        const children = await db.childAccounts
          .where('parentAccountId')
          .equals(user.id)
          .toArray();
        if (children.length === 0) {
          setLoading(false);
          return;
        }
        childAccountId = children[0].id;
        parentAccountId = user.id;
      }

      // Load parent account to get currency
      const parentAccount = await db.parentAccounts.get(parentAccountId);
      if (parentAccount) {
        setCurrency(parentAccount.currency);
      }

      // Get active period
      const activePeriod = await periodService.getActivePeriod(parentAccountId);
      const periodId = activePeriod?.id;

      if (periodId) {
        const [breakdown, trends] = await Promise.all([
          analyticsService.getCategoryBreakdown(childAccountId, periodId),
          analyticsService.getSpendingTrends(childAccountId, periodId, granularity),
        ]);

        setCategoryBreakdown(breakdown);
        setSpendingTrends(trends);
      } else {
        setCategoryBreakdown([]);
        setSpendingTrends([]);
      }
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Analytics" showBack onBack={() => navigate(-1)}>
        <LoadingSpinner size="lg" className="py-12" />
      </Layout>
    );
  }

  return (
    <Layout title="View Analytics" showBack onBack={() => navigate(-1)}>
      <div className="space-y-8">
        {/* Category Breakdown */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Spending by Category
          </h2>
          {categoryBreakdown.length > 0 ? (
            <PieChart data={categoryBreakdown} currency={currency} />
          ) : (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400">
              No spending data available for the current period.
            </div>
          )}
        </div>

        {/* Spending Trends */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              Spending Trends
            </h2>
            <TimeGranularitySelector
              selected={granularity}
              onChange={(newGranularity) => {
                setGranularity(newGranularity);
              }}
            />
          </div>
          {spendingTrends.length > 0 ? (
            <LineGraph data={spendingTrends} granularity={granularity} currency={currency} />
          ) : (
            <div className="text-center py-8 text-gray-600 dark:text-gray-400">
              No spending data available for the current period.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

