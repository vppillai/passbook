import { useTheme } from '../../contexts/theme.context';
import type { Theme } from '../../types/models';

interface ThemeIconProps {
  className?: string;
}

const SunIcon = ({ className = "w-6 h-6" }: ThemeIconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);

const MoonIcon = ({ className = "w-6 h-6" }: ThemeIconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);

const MonitorIcon = ({ className = "w-6 h-6" }: ThemeIconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
    <line x1="8" y1="21" x2="16" y2="21"/>
    <line x1="12" y1="17" x2="12" y2="21"/>
  </svg>
);

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();

  const themes: { value: Theme; label: string; icon: (props: ThemeIconProps) => JSX.Element }[] = [
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonIcon },
    { value: 'system', label: 'System', icon: MonitorIcon },
  ];

  return (
    <div>
      <label className="block text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
        Theme Preference
      </label>
      <div className="grid grid-cols-3 gap-2">
        {themes.map((themeOption) => {
          const IconComponent = themeOption.icon;
          return (
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
              <div className="flex justify-center mb-1">
                <IconComponent className="w-6 h-6 text-gray-700 dark:text-gray-300" />
              </div>
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {themeOption.label}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

