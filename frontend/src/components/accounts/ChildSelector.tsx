import { useState, useEffect } from 'react';
import { db } from '../../services/storage/db';
import { formatCurrencyWithSign } from '../../utils/currency';
import type { ChildAccount } from '../../types/models';

interface ChildSelectorProps {
  parentAccountId: string;
  selectedChildId: string | null;
  currency?: string;
  onSelect: (childId: string) => void;
}

export const ChildSelector = ({
  parentAccountId,
  selectedChildId,
  currency = 'CAD',
  onSelect,
}: ChildSelectorProps) => {
  const [children, setChildren] = useState<ChildAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadChildren();
  }, [parentAccountId]);

  const loadChildren = async () => {
    try {
      const childAccounts = await db.childAccounts
        .where('parentAccountId')
        .equals(parentAccountId)
        .toArray();
      setChildren(childAccounts);
      // Auto-select first child if none selected
      if (!selectedChildId && childAccounts.length > 0) {
        onSelect(childAccounts[0].id);
      }
    } catch (error) {
      console.error('Failed to load children:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-600 dark:text-gray-400">Loading...</div>;
  }

  if (children.length === 0) {
    return <div className="text-sm text-gray-600 dark:text-gray-400">No children found</div>;
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
        Select Child
      </label>
      <div className="grid grid-cols-1 gap-2">
        {children.map((child) => (
          <button
            key={child.id}
            type="button"
            onClick={() => onSelect(child.id)}
            className={`p-4 rounded-lg border-2 transition-all text-left ${
              selectedChildId === child.id
                ? 'border-primary-600 bg-primary-50 dark:bg-primary-900'
                : 'border-gray-300 dark:border-gray-600 hover:border-primary-400'
            }`}
          >
            <div className="font-semibold text-gray-900 dark:text-gray-100">{child.name}</div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Balance: {formatCurrencyWithSign(child.currentBalance, currency)}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

