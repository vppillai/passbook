import { Button } from '../common/Button';

interface MonthNavigatorProps {
  currentPeriod: {
    startDate: number;
    endDate: number;
  } | null;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export const MonthNavigator = ({
  currentPeriod,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext
}: MonthNavigatorProps) => {
  const formatPeriod = (startDate: number, endDate: number) => {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    
    return `${start.toLocaleDateString('en-US', { month: 'short' })} - ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
  };

  if (!currentPeriod) {
    return null;
  }

  return (
    <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-6">
      <Button
        variant="secondary"
        size="sm"
        onClick={onPrevious}
        disabled={!hasPrevious}
      >
        ← Previous
      </Button>
      <div className="text-center">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
          {formatPeriod(currentPeriod.startDate, currentPeriod.endDate)}
        </h3>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={onNext}
        disabled={!hasNext}
      >
        Next →
      </Button>
    </div>
  );
};

