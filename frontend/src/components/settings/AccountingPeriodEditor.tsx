import React, { useState } from 'react';
import { Input } from '../common/Input';
import { PeriodTypeSelector } from './PeriodTypeSelector';
import type { AccountingPeriodType } from '../../types/models';

interface AccountingPeriodEditorProps {
  periodType: AccountingPeriodType;
  startDay: number;
  onPeriodTypeChange: (type: AccountingPeriodType) => void;
  onStartDayChange: (day: number) => void;
}

export const AccountingPeriodEditor: React.FC<AccountingPeriodEditorProps> = ({
  periodType,
  startDay,
  onPeriodTypeChange,
  onStartDayChange,
}) => {
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Accounting Period Type
        </label>
        <PeriodTypeSelector selected={periodType} onSelect={onPeriodTypeChange} />
      </div>

      {periodType === 'monthly' && (
        <div>
          <Input
            label="Start Day of Month"
            type="number"
            min="1"
            max="31"
            value={startDay.toString()}
            onChange={(e) => {
              const day = parseInt(e.target.value, 10);
              if (day >= 1 && day <= 31) {
                onStartDayChange(day);
              }
            }}
          />
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            The accounting period will start on this day each month (1-31)
          </p>
        </div>
      )}

      {periodType === 'custom' && (
        <div className="space-y-4">
          <Input
            label="Start Date"
            type="date"
            value={customStartDate}
            onChange={(e) => setCustomStartDate(e.target.value)}
          />
          <Input
            label="End Date"
            type="date"
            value={customEndDate}
            onChange={(e) => setCustomEndDate(e.target.value)}
            min={customStartDate || undefined}
          />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Custom periods will need to be created manually. The dates above are for reference only.
          </p>
        </div>
      )}
    </div>
  );
};

