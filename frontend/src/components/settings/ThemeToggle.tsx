import { useTheme } from '../../contexts/theme.context';
import type { Theme } from '../../types/models';

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();

  const themes: { value: Theme; label: string; icon: string }[] = [
    { value: 'light', label: 'Light', icon: '☀️' },
    { value: 'dark', label: 'Dark', icon: '🌙' },
    { value: 'system', label: 'System', icon: '💻' },
  ];

  return (
    <div>
      <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
        Theme Preference
      </label>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((themeOption) => (
          <button
            key={themeOption.value}
            type="button"
            onClick={() => setTheme(themeOption.value)}
            className={`p-4 rounded-lg border-2 transition-all ${
              theme === themeOption.value
                ? 'border-primary-600 bg-primary-50 dark:bg-primary-900'
                : 'border-gray-300 dark:border-gray-600 hover:border-primary-400'
            }`}
          >
            <div className="text-2xl mb-1">{themeOption.icon}</div>
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {themeOption.label}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

