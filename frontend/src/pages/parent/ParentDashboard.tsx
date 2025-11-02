import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Layout } from '../../components/common/Layout';
import { Button } from '../../components/common/Button';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { AddChildModal } from '../../components/accounts/AddChildModal';
import { formatCurrencyWithSign } from '../../utils/currency';
import { db } from '../../services/storage/db';
import type { ChildAccount } from '../../types/models';

export const ParentDashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [children, setChildren] = useState<ChildAccount[]>([]);
  const [currency, setCurrency] = useState<string>('CAD');
  const [loading, setLoading] = useState(true);
  const [showAddChildModal, setShowAddChildModal] = useState(false);

  useEffect(() => {
    if (user?.type === 'parent') {
      loadChildren();
    }
  }, [user]);

  const loadChildren = async () => {
    if (user?.type !== 'parent') return;

    try {
      // Load parent account to get currency
      const parentAccount = await db.parentAccounts.get(user.id);
      if (parentAccount) {
        setCurrency(parentAccount.currency);
      }

      const childAccounts = await db.childAccounts
        .where('parentAccountId')
        .equals(user.id)
        .toArray();
      setChildren(childAccounts);
    } catch (error) {
      console.error('Failed to load children:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Layout title="Parent Dashboard">
        <LoadingSpinner size="lg" className="py-12" />
      </Layout>
    );
  }

  return (
    <Layout title="Parent Dashboard">
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Children's Accounts
          </h2>
          <Button onClick={() => setShowAddChildModal(true)}>Add Child</Button>
        </div>

        {children.length === 0 ? (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400 mb-4">No children added yet.</p>
            <Button onClick={() => setShowAddChildModal(true)}>Add Your First Child</Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {children.map((child) => (
              <div
                key={child.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 hover:shadow-lg transition-shadow"
              >
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
                  {child.name}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-4">{child.email}</p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Balance</p>
                    <p
                      className={`text-2xl font-bold ${
                        child.currentBalance < 0
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-gray-900 dark:text-gray-100'
                      }`}
                    >
                      {formatCurrencyWithSign(child.currentBalance, currency)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      // Navigate to child detail view (to be implemented)
                      navigate(`/parent/child/${child.id}`);
                    }}
                  >
                    View
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddChildModal
        isOpen={showAddChildModal}
        onClose={() => setShowAddChildModal(false)}
        onSuccess={loadChildren}
      />
    </Layout>
  );
};

