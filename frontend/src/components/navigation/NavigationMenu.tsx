import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Modal } from '../common/Modal';

interface NavigationMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

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
    icon: '📊',
  });

  menuItems.push({
    label: 'Historical Data',
    path: '/shared/historical',
    icon: '📅',
  });

  if (user?.type === 'parent') {
    menuItems.push({
      label: 'Export Reports',
      path: '/shared/reports',
      icon: '📤',
    });
  }

  menuItems.push({
    label: 'Settings',
    path: '/shared/settings',
    icon: '⚙️',
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Menu" size="sm">
      <div className="space-y-2">
        {menuItems.map((item) => (
          <button
            key={item.path}
            onClick={() => handleNavigation(item.path)}
            className="w-full flex items-center space-x-3 p-4 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors text-left"
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
};

