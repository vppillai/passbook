import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authService } from '../../services/auth/auth.service';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { validatePassword } from '../../utils/validation';
import { SuccessModal } from '../../components/common/SuccessModal';

export const ResetPassword = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const email = searchParams.get('email') || '';
  const accountType = (searchParams.get('type') as 'parent' | 'child') || 'parent';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  useEffect(() => {
    validateToken();
  }, [token, email]);

  const validateToken = async () => {
    if (!token || !email) {
      setError('Invalid reset link. Please request a new one.');
      setValidating(false);
      return;
    }

    try {
      const validation = await authService.validateResetToken(token, email);
      setTokenValid(validation.valid);
      if (!validation.valid) {
        setError('This reset link is invalid or has expired. Please request a new one.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate reset link.');
      setTokenValid(false);
    } finally {
      setValidating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validation
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      setError(passwordValidation.error || 'Invalid password');
      return;
    }

    setLoading(true);

    try {
      await authService.resetPassword(token, email, password);
      setShowSuccessModal(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (validating) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <div className="text-center">
            <p className="text-gray-600 dark:text-gray-400">Validating reset link...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!tokenValid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-bold text-center mb-6 text-gray-900 dark:text-gray-100">
            Invalid Reset Link
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 text-center">
            {error || 'This password reset link is invalid or has expired.'}
          </p>
          <Button className="w-full" onClick={() => navigate('/forgot-password')}>
            Request New Reset Link
          </Button>
          <div className="mt-4 text-center">
            <button
              onClick={() => navigate('/login')}
              className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              Back to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-center mb-6 text-gray-900 dark:text-gray-100">
          Reset Password
        </h2>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 text-center">
          Enter your new password for {email}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            label="New Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            placeholder="Enter new password"
          />

          <Input
            type="password"
            label="Confirm Password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            disabled={loading}
            placeholder="Confirm new password"
          />

          <div className="text-xs text-gray-500 dark:text-gray-400">
            Password must be at least 8 characters long and contain at least one letter and one number.
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading} isLoading={loading}>
            Reset Password
          </Button>
        </form>

        <div className="mt-4 text-center">
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
        title="Password Reset Successful"
        message="Your password has been reset successfully. You can now login with your new password on this device. Note: If you reset your password from a different device than where you originally created your account, you'll need to use the new password on this device and the old password may still work on other devices since data is stored locally."
        onAction={() => {
          setShowSuccessModal(false);
          navigate('/login');
        }}
        actionLabel="Go to Login"
      />
    </div>
  );
};

