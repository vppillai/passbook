import { useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../../contexts/auth.context';
import { Button } from './Button';
import { NavigationMenu } from '../navigation/NavigationMenu';
import { OfflineIndicator } from './OfflineIndicator';

interface LayoutProps {
  children: ReactNode;
  title?: string;
  showBack?: boolean;
  onBack?: () => void;
  showMenu?: boolean;
}

export const Layout = ({ children, title, showBack, onBack, showMenu = true }: LayoutProps) => {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <OfflineIndicator />
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-4">
              {showBack && onBack && (
                <button
                  onClick={onBack}
                  className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                  aria-label="Back"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
              )}
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100" id="page-title">
                {title || 'Teen Passbook'}
              </h1>
            </div>
            {user && (
              <div className="flex items-center space-x-4">
                {showMenu && (
                  <button
                    onClick={() => setMenuOpen(true)}
                    className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white p-2"
                    aria-label="Menu"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                  </button>
                )}
                <span className="text-sm text-gray-600 dark:text-gray-400">{user.name}</span>
                <Button variant="outline" size="sm" onClick={logout}>
                  Logout
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
      {showMenu && <NavigationMenu isOpen={menuOpen} onClose={() => setMenuOpen(false)} />}
    </div>
  );
};

