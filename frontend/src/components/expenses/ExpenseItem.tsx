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
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 px-3 py-3.5 sm:px-4 sm:py-4 md:px-5 md:py-5 hover:shadow-md hover:border-gray-200 dark:hover:border-gray-600 transition-all">
      <div className="flex items-start justify-between gap-4">
        {/* Left section: Icon and Details */}
        <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
          {/* Category Icon */}
          {category && (
            <div
              className="p-2.5 sm:p-3 rounded-lg flex-shrink-0"
              style={{ backgroundColor: `${category.colorHex}15` }}
            >
              <CategoryIcon
                icon={category.icon}
                className="w-5 h-5 sm:w-6 sm:h-6"
                color={category.colorHex}
              />
            </div>
          )}
          
          {/* Text Content */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Description/Title */}
            <h3 className="font-semibold text-base sm:text-lg text-gray-900 dark:text-gray-100 leading-tight">
              {expense.description}
            </h3>
            
            {/* Metadata: Category and Date */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400 font-medium">
                  {category?.name || expense.category}
                </span>
              </div>
              <span className="hidden sm:inline text-gray-400 dark:text-gray-500">•</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                  {formatDateForDisplay(expense.date)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right section: Amount and Edit Button */}
        <div className="flex flex-col items-end gap-2.5 sm:gap-3 flex-shrink-0">
          {/* Amount */}
          <div className="text-right">
            <p className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-gray-100 whitespace-nowrap">
              {formatCurrency(expense.amount, currency)}
            </p>
          </div>
          
          {/* Edit Button */}
          {onEdit && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onEdit(expense)}
              className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm"
            >
              Edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

