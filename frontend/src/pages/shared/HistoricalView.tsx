import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Layout } from '../../components/common/Layout';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { PeriodSelector } from '../../components/shared/PeriodSelector';
import { ExpenseList } from '../../components/expenses/ExpenseList';
import { db } from '../../services/storage/db';
import { periodService } from '../../services/periods/period.service';
import type { ChildAccount } from '../../types/models';

export const HistoricalView = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(null);
  const [childAccount, setChildAccount] = useState<ChildAccount | null>(null);
  const [parentAccountId, setParentAccountId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string>('CAD');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadInitialData();
    }
  }, [user]);

  const loadInitialData = async () => {
    if (!user) return;

    setLoading(true);
    try {
      let parentId: string;

      if (user.type === 'child') {
        const childAccount = await db.childAccounts.get(user.id);
        if (!childAccount) {
          setLoading(false);
          return;
        }
        parentId = childAccount.parentAccountId;
        setChildAccount(childAccount);
      } else {
        // For parent view, use first child
        const children = await db.childAccounts
          .where('parentAccountId')
          .equals(user.id)
          .toArray();
        if (children.length === 0) {
          setLoading(false);
          return;
        }
        parentId = user.id;
        setChildAccount(children[0]);
      }

      setParentAccountId(parentId);

      // Load parent account to get currency
      const parentAccount = await db.parentAccounts.get(parentId);
      if (parentAccount) {
        setCurrency(parentAccount.currency);
      }

      // Get active period as default
      const activePeriod = await periodService.getActivePeriod(parentId);
      if (activePeriod) {
        setSelectedPeriodId(activePeriod.id);
      }
    } catch (error) {
      console.error('Failed to load initial data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Historical Data" showBack onBack={() => navigate(-1)}>
        <LoadingSpinner size="lg" className="py-12" />
      </Layout>
    );
  }

  if (!childAccount || !parentAccountId) {
    return (
      <Layout title="Historical Data" showBack onBack={() => navigate(-1)}>
        <div className="text-center text-gray-600 dark:text-gray-400 py-8">
          No account data available
        </div>
      </Layout>
    );
  }

  return (
    <Layout title="Historical Data" showBack onBack={() => navigate(-1)}>
      <div className="space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
          <PeriodSelector
            parentAccountId={parentAccountId}
            selectedPeriodId={selectedPeriodId}
            onSelect={setSelectedPeriodId}
          />
        </div>

        {selectedPeriodId && (
          <ExpenseList
            childAccountId={childAccount.id}
            accountingPeriodId={selectedPeriodId}
            currency={currency}
          />
        )}
      </div>
    </Layout>
  );
};

