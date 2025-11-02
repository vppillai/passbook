import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { periodService } from '../../services/periods/period.service';

interface NewPeriodStarterProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  parentAccountId: string;
}

export const NewPeriodStarter: React.FC<NewPeriodStarterProps> = ({
  isOpen,
  onClose,
  onSuccess,
  parentAccountId,
}) => {
  const [startDate, setStartDate] = useState(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    return nextMonth.toISOString().split('T')[0];
  });

  const [endDate, setEndDate] = useState(() => {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 2);
    nextMonth.setDate(0);
    return nextMonth.toISOString().split('T')[0];
  });

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStartNewPeriod = async () => {
    setError('');
    setIsLoading(true);

    try {
      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp = new Date(endDate).getTime();

      if (startTimestamp >= endTimestamp) {
        setError('Start date must be before end date');
        setIsLoading(false);
        return;
      }

      await periodService.createNewPeriod(parentAccountId, startTimestamp, endTimestamp);
      
      // Reset child balances to their default allowance
      const { db } = await import('../../services/storage/db');
      const children = await db.childAccounts
        .where('parentAccountId')
        .equals(parentAccountId)
        .toArray();

      for (const child of children) {
        await db.childAccounts.update(child.id, {
          currentBalance: child.defaultMonthlyAllowance,
        });
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start new period');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Start New Accounting Period" size="md">
      <div className="space-y-4">
        <div className="bg-yellow-50 dark:bg-yellow-900 border-l-4 border-yellow-400 p-4 rounded">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            ⚠️ Starting a new period will close the current period. This action cannot be undone.
            Child balances will be reset to their default monthly allowance.
          </p>
        </div>

        <Input
          label="Start Date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />

        <Input
          label="End Date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          min={startDate}
          required
        />

        {error && (
          <div className="text-red-600 dark:text-red-400 text-sm">{error}</div>
        )}

        <div className="flex justify-end space-x-3 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={handleStartNewPeriod}
            isLoading={isLoading}
          >
            Start New Period
          </Button>
        </div>
      </div>
    </Modal>
  );
};

