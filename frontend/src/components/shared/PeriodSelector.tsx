import { useState, useEffect } from 'react';
import { periodService } from '../../services/periods/period.service';
import type { AccountingPeriod } from '../../types/models';
import { formatDateForDisplay } from '../../utils/date';

interface PeriodSelectorProps {
  parentAccountId: string;
  selectedPeriodId: string | null;
  onSelect: (periodId: string | null) => void;
}

export const PeriodSelector = ({ parentAccountId, selectedPeriodId, onSelect }: PeriodSelectorProps) => {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPeriods();
  }, [parentAccountId]);

  const loadPeriods = async () => {
    try {
      const allPeriods = await periodService.getAllPeriods(parentAccountId);
      // Sort by start date descending (most recent first)
      allPeriods.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
      setPeriods(allPeriods);
      
      // Auto-select most recent period if none selected
      if (!selectedPeriodId && allPeriods.length > 0) {
        onSelect(allPeriods[0].id);
      }
    } catch (error) {
      console.error('Failed to load periods:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-600 dark:text-gray-400">Loading periods...</div>;
  }

  return (
    <div>
      <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
        Select Period
      </label>
      <select
        value={selectedPeriodId || ''}
        onChange={(e) => onSelect(e.target.value || null)}
        className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        {periods.map((period) => (
          <option key={period.id} value={period.id}>
            {formatDateForDisplay(period.startDate)} - {formatDateForDisplay(period.endDate)} ({period.status})
          </option>
        ))}
      </select>
    </div>
  );
};

