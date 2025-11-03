import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './contexts/theme.context';
import { AuthProvider, useAuth } from './contexts/auth.context';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { Login } from './pages/auth/Login';
import { ParentSignup } from './pages/auth/ParentSignup';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { ResetPassword } from './pages/auth/ResetPassword';
import { ParentDashboard } from './pages/parent/ParentDashboard';
import { ChildDetailView } from './pages/parent/ChildDetailView';
import { ChildDashboard } from './pages/child/ChildDashboard';
import { Analytics } from './pages/shared/Analytics';
import { Settings } from './pages/shared/Settings';
import { Reports } from './pages/shared/Reports';
import { HistoricalView } from './pages/shared/HistoricalView';

const ProtectedRoute = ({ children, requiredType }: { children: React.ReactElement; requiredType?: 'parent' | 'child' }) => {
  const { isAuthenticated, user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requiredType && user?.type !== requiredType) {
    return <Navigate to={user?.type === 'parent' ? '/parent/dashboard' : '/child/dashboard'} replace />;
  }

  return children;
};

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<ParentSignup />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/parent/dashboard"
        element={
          <ProtectedRoute requiredType="parent">
            <ParentDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/parent/child/:childId"
        element={
          <ProtectedRoute requiredType="parent">
            <ChildDetailView />
          </ProtectedRoute>
        }
      />
      <Route
        path="/child/dashboard"
        element={
          <ProtectedRoute requiredType="child">
            <ChildDashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/shared/analytics"
        element={
          <ProtectedRoute>
            <Analytics />
          </ProtectedRoute>
        }
      />
      <Route
        path="/shared/settings"
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path="/shared/reports"
        element={
          <ProtectedRoute requiredType="parent">
            <Reports />
          </ProtectedRoute>
        }
      />
      <Route
        path="/shared/historical"
        element={
          <ProtectedRoute>
            <HistoricalView />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
};

function App() {
  // Get base path for React Router (matches Vite base path)
  const basename = import.meta.env.BASE_URL || '/';

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter basename={basename}>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
