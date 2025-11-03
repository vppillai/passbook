import { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { CategoryPicker } from './CategoryPicker';
import { expenseService } from '../../services/expenses/expense.service';
import type { CreateExpenseData } from '../../services/expenses/expense.service';
import type { Expense } from '../../types/models';
import { PREDEFINED_CATEGORIES } from '../../data/categories';
import { getCurrentDate, formatDateForInput } from '../../utils/date';
import { validateAmount } from '../../utils/validation';
import { useAuth } from '../../contexts/auth.context';

interface ExpenseFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  childAccountId: string;
  expense?: Expense | null;
  onSuccess: () => void;
  onDelete?: (expense: Expense) => void;
}

export const ExpenseFormModal = ({
  isOpen,
  onClose,
  childAccountId,
  expense,
  onSuccess,
  onDelete,
}: ExpenseFormModalProps) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    amount: expense?.amount || 0,
    category: expense?.category || PREDEFINED_CATEGORIES[0].id,
    description: expense?.description || '',
    date: expense ? formatDateForInput(expense.date) : getCurrentDate(),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Update form data when expense prop changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setFormData({
        amount: expense?.amount || 0,
        category: expense?.category || PREDEFINED_CATEGORIES[0].id,
        description: expense?.description || '',
        date: expense ? formatDateForInput(expense.date) : getCurrentDate(),
      });
      setErrors({});
    }
  }, [expense, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    const amountValidation = validateAmount(formData.amount);
    if (!amountValidation.valid) {
      setErrors({ amount: amountValidation.message || 'Invalid amount' });
      return;
    }

    if (!formData.description.trim()) {
      setErrors({ description: 'Description is required' });
      return;
    }

    setErrors({});
    setLoading(true);

    try {
      const data: CreateExpenseData = {
        childAccountId,
        amount: formData.amount,
        category: formData.category,
        description: formData.description,
        date: formData.date,
        createdBy: user?.type === 'parent' ? 'parent' : 'child',
      };

      if (expense) {
        await expenseService.updateExpense(expense.id, data, user?.id || '');
      } else {
        await expenseService.createExpense(data);
      }

      onSuccess();
      onClose();
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Failed to save expense' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={expense ? 'Edit Expense' : 'Add Expense'}
      size="md"
    >
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

        <CategoryPicker
          selectedCategory={formData.category}
          onSelect={(categoryId) => {
            setFormData({ ...formData, category: categoryId });
          }}
        />

        <Input
          type="text"
          label="Description"
          value={formData.description}
          onChange={(e) => {
            setFormData({ ...formData, description: e.target.value });
            setErrors({ ...errors, description: '' });
          }}
          error={errors.description}
          disabled={loading}
          required
          maxLength={200}
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
          {expense && onDelete && (
            <Button
              type="button"
              variant="danger"
              onClick={() => onDelete(expense)}
              className="flex-1"
              disabled={loading}
            >
              Delete
            </Button>
          )}
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading ? 'Saving...' : expense ? 'Update' : 'Add Expense'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

