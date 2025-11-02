import type { TimeGranularity } from '../../services/analytics/analytics.service';

interface TimeGranularitySelectorProps {
  selected: TimeGranularity;
  onChange: (granularity: TimeGranularity) => void;
}

export const TimeGranularitySelector = ({ selected, onChange }: TimeGranularitySelectorProps) => {
  const options: { value: TimeGranularity; label: string }[] = [
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
  ];

  return (
    <div className="flex space-x-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            selected === option.value
              ? 'bg-primary-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
};

