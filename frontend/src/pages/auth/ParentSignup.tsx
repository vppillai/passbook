import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authService } from '../../services/auth/auth.service';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { SuccessModal } from '../../components/common/SuccessModal';
import { validateEmail, validatePassword } from '../../utils/validation';

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'JPY'];

export const ParentSignup = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    currency: 'CAD',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: '' }));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }

    if (!validateEmail(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    const passwordValidation = validatePassword(formData.password);
    if (!passwordValidation.valid) {
      newErrors.password = passwordValidation.message || 'Invalid password';
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      await authService.createParentAccount({
        email: formData.email,
        password: formData.password,
        name: formData.name,
        currency: formData.currency,
      });
      setShowSuccess(true);
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Failed to create account' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-2xl font-bold text-center mb-6 text-gray-900 dark:text-gray-100">
          Create Parent Account
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Name"
            value={formData.name}
            onChange={(e) => handleChange('name', e.target.value)}
            error={errors.name}
            disabled={loading}
            required
          />

          <Input
            type="email"
            label="Email"
            value={formData.email}
            onChange={(e) => handleChange('email', e.target.value)}
            error={errors.email}
            disabled={loading}
            required
          />

          <Input
            type="password"
            label="Password"
            value={formData.password}
            onChange={(e) => handleChange('password', e.target.value)}
            error={errors.password}
            disabled={loading}
            required
          />

          <Input
            type="password"
            label="Confirm Password"
            value={formData.confirmPassword}
            onChange={(e) => handleChange('confirmPassword', e.target.value)}
            error={errors.confirmPassword}
            disabled={loading}
            required
          />

          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
              Currency
            </label>
            <select
              value={formData.currency}
              onChange={(e) => handleChange('currency', e.target.value)}
              className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500"
              disabled={loading}
            >
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>

          {errors.submit && (
            <p className="text-sm text-red-600 dark:text-red-400">{errors.submit}</p>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Creating Account...' : 'Create Account'}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <button
            onClick={() => navigate('/login')}
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
          >
            Already have an account? Login
          </button>
        </div>

        <SuccessModal
          isOpen={showSuccess}
          onClose={() => setShowSuccess(false)}
          title="Account Created Successfully!"
          message={`Welcome to Allowance Passbook, ${formData.name}! Your parent account has been created. You can now login and start managing your family's allowances.`}
          actionText="Go to Login"
          onAction={() => navigate('/login')}
        />
      </div>
    </div>
  );
};

