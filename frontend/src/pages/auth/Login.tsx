import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/auth.context';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { getVersionDisplay } from '../../utils/version';

export const Login = () => {
  const navigate = useNavigate();
  const { loginParent, loginChild } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [userType, setUserType] = useState<'parent' | 'child'>('child');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (userType === 'parent') {
        await loginParent(email, password, rememberMe);
        navigate('/parent/dashboard');
      } else {
        await loginChild(email, password, rememberMe);
        navigate('/child/dashboard');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-center mb-6 text-gray-900 dark:text-gray-100">
          Login
        </h2>

        <div className="mb-4 flex space-x-2">
          <button
            onClick={() => setUserType('parent')}
            className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
              userType === 'parent'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            Parent
          </button>
          <button
            onClick={() => setUserType('child')}
            className={`flex-1 py-2 rounded-lg font-medium transition-colors ${
              userType === 'child'
                ? 'bg-primary-600 text-white'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            Child
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="email"
            label="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={loading}
          />
          <Input
            type="password"
            label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
          />

          <div className="flex items-center">
            <input
              id="remember-me"
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              disabled={loading}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label
              htmlFor="remember-me"
              className="ml-2 block text-sm text-gray-900 dark:text-gray-300 cursor-pointer"
            >
              Remember me for 7 days
            </label>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </Button>
        </form>

        <div className="mt-4 text-center space-y-2">
          <button
            onClick={() => navigate('/forgot-password')}
            className="block w-full text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            Forgot password?
          </button>
          <button
            onClick={() => navigate('/signup')}
            className="block w-full text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            Don't have an account? Sign up
          </button>
        </div>

        <div className="mt-6 text-center">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {getVersionDisplay()}
          </span>
        </div>
      </div>
    </div>
  );
};

