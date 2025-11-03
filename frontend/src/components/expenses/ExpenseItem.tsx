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
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 transition-all">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-3 mb-2">
            {category && (
              <div
                className="p-2 rounded-lg"
                style={{ backgroundColor: `${category.colorHex}15` }}
              >
                <CategoryIcon
                  icon={category.icon}
                  className="w-5 h-5"
                  color={category.colorHex}
                />
              </div>
            )}
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">{expense.description}</h3>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            {category?.name || expense.category}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500">
            {formatDateForDisplay(expense.date)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {formatCurrency(expense.amount, currency)}
          </p>
          {onEdit && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => onEdit(expense)}
            >
              Edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

