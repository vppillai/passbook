import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '../types/models';
import { authService } from '../services/auth/auth.service';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  loginParent: (email: string, password: string) => Promise<void>;
  loginChild: (email: string, password: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for stored session
    const storedUserId = localStorage.getItem('userId');
    const storedUserType = localStorage.getItem('userType');
    
    if (storedUserId && storedUserType) {
      loadUser(storedUserId, storedUserType as 'parent' | 'child');
    } else {
      setLoading(false);
    }
  }, []);

  const loadUser = async (userId: string, userType: 'parent' | 'child') => {
    try {
      if (userType === 'parent') {
        const parentAccount = await authService.getParentAccountById(userId);
        if (parentAccount) {
          setUser({
            id: parentAccount.id,
            email: parentAccount.email,
            name: parentAccount.name,
            type: 'parent',
          });
        }
      } else {
        const childAccount = await authService.getChildAccountById(userId);
        if (childAccount) {
          setUser({
            id: childAccount.id,
            email: childAccount.email,
            name: childAccount.name,
            type: 'child',
            parentAccountId: childAccount.parentAccountId,
          });
        }
      }
    } catch (error) {
      console.error('Failed to load user:', error);
      localStorage.removeItem('userId');
      localStorage.removeItem('userType');
    } finally {
      setLoading(false);
    }
  };

  const loginParent = async (email: string, password: string) => {
    const authUser = await authService.loginParent({ email, password });
    setUser(authUser);
    localStorage.setItem('userId', authUser.id);
    localStorage.setItem('userType', 'parent');
  };

  const loginChild = async (email: string, password: string) => {
    const authUser = await authService.loginChild({ email, password });
    setUser(authUser);
    localStorage.setItem('userId', authUser.id);
    localStorage.setItem('userType', 'child');
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('userId');
    localStorage.removeItem('userType');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        loginParent,
        loginChild,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};

