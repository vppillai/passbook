import { useOffline } from '../../hooks/useOffline';

export const OfflineIndicator = () => {
  const isOffline = useOffline();

  if (!isOffline) return null;

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2">
      <div className="max-w-7xl mx-auto flex items-center space-x-2 text-sm text-yellow-800 dark:text-yellow-200">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
            clipRule="evenodd"
          />
        </svg>
        <span>You're offline. Changes will sync when connection is restored.</span>
      </div>
    </div>
  );
};

