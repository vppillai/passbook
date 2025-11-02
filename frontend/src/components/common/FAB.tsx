import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface FABProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

export const FAB = ({ children, className = '', ...props }: FABProps) => {
  return (
    <button
      className={`fixed bottom-6 right-6 w-14 h-14 bg-primary-600 hover:bg-primary-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 z-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};

