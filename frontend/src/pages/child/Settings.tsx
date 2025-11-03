import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/auth.context';
import { ThemeToggle } from '../../components/settings/ThemeToggle';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { childStorage } from '../../services/storage/child.storage';
import type { ChildAccount } from '../../types/models';

export const ChildSettings: React.FC = () => {
  const { user } = useAuth();
  const [child, setChild] = useState<ChildAccount | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.type === 'child') {
      loadChildAccount();
    }
  }, [user]);

  const loadChildAccount = async () => {
    if (!user || user.type !== 'child') return;
    try {
      const account = await childStorage.getById(user.id);
      if (account) {
        setChild(account);
      }
    } catch (error) {
      console.error('Failed to load child account:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner size="lg" className="py-12" />;
  }

  if (!child) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Settings</h2>
        <p className="text-gray-600 dark:text-gray-400">
          Manage your account preferences
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Appearance
        </h3>
        <ThemeToggle />
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">
          Account Information
        </h3>
        <div className="space-y-2 text-sm">
          <div>
            <span className="text-gray-600 dark:text-gray-400">Name:</span>{' '}
            <span className="font-medium text-gray-900 dark:text-gray-100">{child.name}</span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Email:</span>{' '}
            <span className="font-medium text-gray-900 dark:text-gray-100">{child.email}</span>
          </div>
          <div>
            <span className="text-gray-600 dark:text-gray-400">Default Monthly Allowance:</span>{' '}
            <span className="font-medium text-gray-900 dark:text-gray-100">
              ${child.defaultMonthlyAllowance.toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

