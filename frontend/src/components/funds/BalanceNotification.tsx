interface BalanceNotificationProps {
  currentBalance: number;
  newBalance: number;
  amountAdded: number;
}

export const BalanceNotification = ({
  currentBalance,
  newBalance,
  amountAdded
}: BalanceNotificationProps) => {
  const wasNegative = currentBalance < 0;
  const isNegative = newBalance < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <div className="text-center">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
            Funds Added Successfully
          </h3>
          
          <div className="space-y-3 mb-6">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Previous Balance:</span>
              <span className={`font-semibold ${wasNegative ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                ${Math.abs(currentBalance).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Amount Added:</span>
              <span className="font-semibold text-green-600 dark:text-green-400">
                +${amountAdded.toFixed(2)}
              </span>
            </div>
            <div className="pt-2 border-t border-gray-200 dark:border-gray-700 flex justify-between">
              <span className="text-gray-900 dark:text-white font-semibold">New Balance:</span>
              <span className={`font-bold text-lg ${isNegative ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                ${Math.abs(newBalance).toFixed(2)}
              </span>
            </div>
          </div>

          {wasNegative && newBalance >= 0 && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-green-800 dark:text-green-200">
                Great! The balance is now positive.
              </p>
            </div>
          )}

          {isNegative && (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                Note: Balance is still negative.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

