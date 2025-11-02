import { formatCurrencyWithSign } from '../../utils/currency';

interface BalanceDisplayProps {
  balance: number;
  currency?: string;
}

export const BalanceDisplay = ({ balance, currency = 'CAD' }: BalanceDisplayProps) => {
  const isNegative = balance < 0;

  return (
    <div className="sticky top-16 z-30 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm py-4 mb-4">
      <div className="text-center">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">Current Balance</p>
        <p
          className={`text-4xl font-bold ${
            isNegative
              ? 'text-red-600 dark:text-red-400'
              : 'text-gray-900 dark:text-gray-100'
          }`}
          aria-live="polite"
          aria-atomic="true"
        >
          {formatCurrencyWithSign(balance, currency)}
        </p>
      </div>
    </div>
  );
};

