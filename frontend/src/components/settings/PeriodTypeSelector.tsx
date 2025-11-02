import React from 'react';
import type { AccountingPeriodType } from '../../types/models';

interface PeriodTypeSelectorProps {
  selected: AccountingPeriodType;
  onSelect: (type: AccountingPeriodType) => void;
}

export const PeriodTypeSelector: React.FC<PeriodTypeSelectorProps> = ({
  selected,
  onSelect,
}) => {
  const options: { value: AccountingPeriodType; label: string; description: string }[] = [
    { value: 'monthly', label: 'Monthly', description: 'Calendar month (1st to last day)' },
    { value: 'biweekly', label: 'Bi-weekly', description: 'Every 2 weeks' },
    { value: 'custom', label: 'Custom', description: 'Define your own period' },
  ];

  return (
    <div className="space-y-2">
      {options.map((option) => (
        <button
          key={option.value}
          onClick={() => onSelect(option.value)}
          className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
            selected === option.value
              ? 'border-primary-600 bg-primary-50 dark:bg-primary-900'
              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
          }`}
        >
          <div className="font-medium text-gray-900 dark:text-gray-100">{option.label}</div>
          <div className="text-sm text-gray-500 dark:text-gray-400">{option.description}</div>
        </button>
      ))}
    </div>
  );
};

