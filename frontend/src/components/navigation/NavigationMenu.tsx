import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Modal } from '../common/Modal';

interface NavigationMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

interface MenuIconProps {
  className?: string;
}

const AnalyticsIcon = ({ className = "w-6 h-6" }: MenuIconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
);

const CalendarIcon = ({ className = "w-6 h-6" }: MenuIconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

const ExportIcon = ({ className = "w-6 h-6" }: MenuIconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
);

const SettingsIcon = ({ className = "w-6 h-6" }: MenuIconProps) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
  </svg>
);

export const NavigationMenu = ({ isOpen, onClose }: NavigationMenuProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleNavigation = (path: string) => {
    navigate(path);
    onClose();
  };

  const menuItems = [];

  menuItems.push({
    label: 'View Analytics',
    path: '/shared/analytics',
    icon: AnalyticsIcon,
  });

  menuItems.push({
    label: 'Historical Data',
    path: '/shared/historical',
    icon: CalendarIcon,
  });

  if (user?.type === 'parent') {
    menuItems.push({
      label: 'Export Reports',
      path: '/shared/reports',
      icon: ExportIcon,
    });
  }

  menuItems.push({
    label: 'Settings',
    path: '/shared/settings',
    icon: SettingsIcon,
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Menu" size="sm">
      <div className="space-y-2">
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => handleNavigation(item.path)}
              className="w-full flex items-center space-x-3 p-4 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
            >
              <IconComponent className="w-6 h-6 text-gray-600 dark:text-gray-400" />
              <span className="text-gray-900 dark:text-gray-100 font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
};

