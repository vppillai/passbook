import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { authService } from '../../services/auth/auth.service';
import { validateEmail, validatePassword } from '../../utils/validation';
import { useAuth } from '../../contexts/auth.context';

interface AddChildModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AddChildModal = ({ isOpen, onClose, onSuccess }: AddChildModalProps) => {
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    defaultMonthlyAllowance: 100,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const handleChange = (field: string, value: string | number) => {
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

    if (formData.defaultMonthlyAllowance < 0) {
      newErrors.defaultMonthlyAllowance = 'Allowance must be positive';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    if (user?.type !== 'parent') {
      setErrors({ submit: 'Only parents can add children' });
      return;
    }

    setLoading(true);
    try {
      await authService.createChildAccount(
        user.id,
        formData.email,
        formData.password,
        formData.name,
        formData.defaultMonthlyAllowance
      );
      onSuccess();
      onClose();
      // Reset form
      setFormData({
        name: '',
        email: '',
        password: '',
        confirmPassword: '',
        defaultMonthlyAllowance: 100,
      });
    } catch (err) {
      setErrors({ submit: err instanceof Error ? err.message : 'Failed to create child account' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Child Account" size="md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Child's Name"
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

        <Input
          type="number"
          label="Default Monthly Allowance"
          step="0.01"
          min="0"
          value={formData.defaultMonthlyAllowance}
          onChange={(e) => handleChange('defaultMonthlyAllowance', parseFloat(e.target.value) || 0)}
          error={errors.defaultMonthlyAllowance}
          disabled={loading}
          required
        />

        {errors.submit && (
          <p className="text-sm text-red-600 dark:text-red-400">{errors.submit}</p>
        )}

        <div className="flex space-x-3">
          <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading ? 'Creating...' : 'Create Account'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

