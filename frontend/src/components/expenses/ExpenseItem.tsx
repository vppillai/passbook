import type { Expense } from '../../types/models';
import { formatDateForDisplay } from '../../utils/date';
import { formatCurrency } from '../../utils/currency';
import { getCategoryById } from '../../data/categories';
import { Button } from '../common/Button';
import { CategoryIcon } from '../common/CategoryIcon';

interface ExpenseItemProps {
  expense: Expense;
  currency?: string;
  onEdit?: (expense: Expense) => void;
}

export const ExpenseItem = ({ expense, currency = 'CAD', onEdit }: ExpenseItemProps) => {
  const category = getCategoryById(expense.category);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6 hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 transition-all mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4 flex-1">
          {category && (
            <div
              className="p-3 rounded-lg flex-shrink-0"
              style={{ backgroundColor: `${category.colorHex}15` }}
            >
              <CategoryIcon
                icon={category.icon}
                className="w-6 h-6"
                color={category.colorHex}
              />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100 mb-1">
              {expense.description}
            </h3>
            <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
              <span>{category?.name || expense.category}</span>
              <span>•</span>
              <span>{formatDateForDisplay(expense.date)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center space-x-4 flex-shrink-0">
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {formatCurrency(expense.amount, currency)}
            </p>
          </div>
          {onEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(expense)}
              className="px-4 py-2"
            >
              Edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

