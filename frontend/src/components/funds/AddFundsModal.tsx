import { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { fundService } from '../../services/funds/fund.service';
import type { CreateFundAdditionData } from '../../services/funds/fund.service';
import { validateAmount } from '../../utils/validation';
import { formatCurrencyWithSign } from '../../utils/currency';
import { useAuth } from '../../contexts/auth.context';
import { db } from '../../services/storage/db';
import type { ChildAccount } from '../../types/models';

interface AddFundsModalProps {
  isOpen: boolean;
  onClose: () => void;
  childAccountId: string;
  onSuccess: () => void;
}

export const AddFundsModal = ({ isOpen, onClose, childAccountId, onSuccess }: AddFundsModalProps) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    amount: 0,
    reason: '',
    date: '',
  });
  const [childAccount, setChildAccount] = useState<ChildAccount | null>(null);
  const [currency, setCurrency] = useState<string>('CAD');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && childAccountId) {
      loadChildAccount();
      // Set default date to today
      const today = new Date().toISOString().split('T')[0];
      setFormData((prev) => ({ ...prev, date: today }));
    }
  }, [isOpen, childAccountId]);

  const loadChildAccount = async () => {
    try {
      const account = await db.childAccounts.get(childAccountId);
      if (account) {
        setChildAccount(account);
        // Load parent account to get currency
        const parentAccount = await db.parentAccounts.get(account.parentAccountId);
        if (parentAccount) {
          setCurrency(parentAccount.currency);
        }
      } else {
        setChildAccount(null);
      }
    } catch (error) {
      console.error('Failed to load child account:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const amountValidation = validateAmount(formData.amount);
    if (!amountValidation.valid) {
      setErrors({ amount: amountValidation.message || 'Invalid amount' });
      return;
    }

    if (!formData.reason.trim()) {
      setErrors({ reason: 'Reason is required' });
      return;
    }

    if (user?.type !== 'parent') {
      setErrors({ submit: 'Only parents can add funds' });
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      const data: CreateFundAdditionData = {
        childAccountId,
        amount: formData.amount,
        reason: formData.reason,
        date: formData.date,
        addedBy: user.id,
      };

      await fundService.addFunds(data);
      onSuccess();
      onClose();
      // Reset form
      const today = new Date().toISOString().split('T')[0];
      setFormData({ amount: 0, reason: '', date: today });
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Failed to add funds' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Funds" size="md">
      {childAccount && childAccount.currentBalance < 0 && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-900/20 border-l-4 border-yellow-400 rounded">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            <strong>Current Balance:</strong> {formatCurrencyWithSign(childAccount.currentBalance, currency)}
          </p>
        </div>
      )}
      {childAccount && childAccount.currentBalance >= 0 && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border-l-4 border-blue-400 rounded">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            <strong>Current Balance:</strong> {formatCurrencyWithSign(childAccount.currentBalance, currency)}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          type="number"
          label="Amount"
          step="0.01"
          min="0.01"
          value={formData.amount || ''}
          onChange={(e) => {
            setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 });
            setErrors({ ...errors, amount: '' });
          }}
          error={errors.amount}
          disabled={loading}
          required
        />

        <Input
          type="text"
          label="Reason"
          value={formData.reason}
          onChange={(e) => {
            setFormData({ ...formData, reason: e.target.value });
            setErrors({ ...errors, reason: '' });
          }}
          error={errors.reason}
          disabled={loading}
          required
          maxLength={200}
          placeholder="e.g., Monthly allowance, Bonus for good grades"
        />

        <Input
          type="date"
          label="Date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          disabled={loading}
          required
        />

        {errors.submit && (
          <p className="text-sm text-red-600 dark:text-red-400">{errors.submit}</p>
        )}

        <div className="flex space-x-3">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading ? 'Adding Funds...' : 'Add Funds'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

