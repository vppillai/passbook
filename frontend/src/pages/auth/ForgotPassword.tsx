import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/auth/auth.service';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { SuccessModal } from '../../components/common/SuccessModal';

export const ForgotPassword = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [userType, setUserType] = useState<'parent' | 'child'>('parent');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await authService.requestPasswordReset(email, userType);
      setShowSuccessModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-center mb-6 text-gray-900 dark:text-gray-100">
          Forgot Password
        </h2>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 text-center">
          Enter your email address and we'll send you a link to reset your password.
        </p>

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
            placeholder="your@email.com"
          />

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading} isLoading={loading}>
            Send Reset Link
          </Button>
        </form>

        <div className="mt-4 text-center space-y-2">
          <button
            onClick={() => navigate('/login')}
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            Back to Login
          </button>
        </div>
      </div>

      <SuccessModal
        isOpen={showSuccessModal}
        onClose={() => {
          setShowSuccessModal(false);
          navigate('/login');
        }}
        title="Reset Link Sent"
        message={`If an account with ${email} exists, we've sent a password reset link. Please check your email. The link will expire in 1 hour.`}
        onAction={() => {
          setShowSuccessModal(false);
          navigate('/login');
        }}
        actionLabel="Back to Login"
      />
    </div>
  );
};

