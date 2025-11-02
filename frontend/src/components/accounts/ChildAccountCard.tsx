import type { ChildAccount } from '../../types/models';

interface ChildAccountCardProps {
  child: ChildAccount;
  isSelected: boolean;
  onSelect: () => void;
}

export const ChildAccountCard = ({ child, isSelected, onSelect }: ChildAccountCardProps) => {
  return (
    <div
      onClick={onSelect}
      className={`
        p-4 rounded-lg border-2 cursor-pointer transition-all
        ${isSelected 
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-600'
        }
      `}
    >
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {child.name}
      </h3>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
        {child.email}
      </p>
      <p className={`text-xl font-bold ${
        child.currentBalance >= 0 
          ? 'text-green-600 dark:text-green-400' 
          : 'text-red-600 dark:text-red-400'
      }`}>
        ${child.currentBalance.toFixed(2)}
      </p>
    </div>
  );
};

