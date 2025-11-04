import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { AuthUser } from '../types/models';
import { authService } from '../services/auth/auth.service';
import { authCookies } from '../utils/cookies';

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  loginParent: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  loginChild: (email: string, password: string, rememberMe?: boolean) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = () => {
    setUser(null);
    // Clear cookies
    authCookies.clearAll();
    // Also clear localStorage as fallback
    localStorage.removeItem('userId');
    localStorage.removeItem('userType');
    localStorage.removeItem('passwordChangedAt');
    localStorage.removeItem('authToken');
  };

  const loadUser = async (userId: string, userType: 'parent' | 'child') => {
    try {
      // First, try to validate JWT token from cookie (preferred) or localStorage (fallback)
      const storedToken = authCookies.getToken() || localStorage.getItem('authToken');
      
      if (storedToken) {
        const validation = await authService.validateToken(storedToken);
        if (validation.valid && validation.userId && validation.userType) {
          // Token is valid, use the data from the token
          setUser({
            id: validation.userId,
            email: validation.email || '',
            name: validation.name || '',
            type: validation.userType as 'parent' | 'child',
          });
          setLoading(false);
          return;
        } else {
          // Token invalid or expired, clear it
          authCookies.clearAll();
          localStorage.removeItem('authToken');
        }
      }

      // Fallback: Local validation (for offline support or when server is not configured)
      // Critical security check: Verify password hasn't been changed since last login
      const storedPasswordChangedAt = authCookies.getPasswordChangedAt() || localStorage.getItem('passwordChangedAt');
      const currentPasswordChangedAt = await authService.getPasswordChangedAt(userId, userType);
      
      // If password was changed (timestamp mismatch), invalidate session
      if (storedPasswordChangedAt && currentPasswordChangedAt) {
        const stored = parseInt(storedPasswordChangedAt, 10);
        const current = currentPasswordChangedAt;
        
        if (stored !== current) {
          // Password was changed on another device - invalidate this session
          console.warn('Password was changed on another device. Session invalidated.');
          logout();
          return;
        }
      }

      if (userType === 'parent') {
        const parentAccount = await authService.getParentAccountById(userId);
        if (parentAccount) {
          setUser({
            id: parentAccount.id,
            email: parentAccount.email,
            name: parentAccount.name,
            type: 'parent',
          });
        } else {
          // Account not found - invalidate session
          logout();
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
        } else {
          // Account not found - invalidate session
          logout();
        }
      }
    } catch (error) {
      console.error('Failed to load user:', error);
      logout();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check for stored session - prioritize cookies, fallback to localStorage
    const storedToken = authCookies.getToken() || localStorage.getItem('authToken');
    const storedUserId = authCookies.getUserId() || localStorage.getItem('userId');
    const storedUserType = authCookies.getUserType() || localStorage.getItem('userType');
    
    if (storedToken) {
      // Try to validate token first (will load user from token)
      loadUser(storedUserId || '', storedUserType as 'parent' | 'child');
    } else if (storedUserId && storedUserType) {
      // Fallback to local session
      loadUser(storedUserId, storedUserType as 'parent' | 'child');
    } else {
      setLoading(false);
    }
  }, []);

  const loginParent = async (email: string, password: string, rememberMe: boolean = false) => {
    const { user, token, passwordChangedAt } = await authService.loginParent({ email, password });
    setUser(user);
    
    // Store in cookies (preferred) and localStorage (fallback)
    if (token) {
      authCookies.setToken(token, rememberMe);
    }
    authCookies.setUserId(user.id, rememberMe);
    authCookies.setUserType('parent', rememberMe);
    authCookies.setPasswordChangedAt(passwordChangedAt.toString(), rememberMe);
    
    // Also store in localStorage as fallback
    localStorage.setItem('userId', user.id);
    localStorage.setItem('userType', 'parent');
    if (token) {
      localStorage.setItem('authToken', token);
    }
    localStorage.setItem('passwordChangedAt', passwordChangedAt.toString());
  };

  const loginChild = async (email: string, password: string, rememberMe: boolean = false) => {
    const { user, token, passwordChangedAt } = await authService.loginChild({ email, password });
    setUser(user);
    
    // Store in cookies (preferred) and localStorage (fallback)
    if (token) {
      authCookies.setToken(token, rememberMe);
    }
    authCookies.setUserId(user.id, rememberMe);
    authCookies.setUserType('child', rememberMe);
    authCookies.setPasswordChangedAt(passwordChangedAt.toString(), rememberMe);
    
    // Also store in localStorage as fallback
    localStorage.setItem('userId', user.id);
    localStorage.setItem('userType', 'child');
    if (token) {
      localStorage.setItem('authToken', token);
    }
    localStorage.setItem('passwordChangedAt', passwordChangedAt.toString());
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

