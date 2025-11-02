// Validation utilities

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const validatePassword = (password: string): { valid: boolean; message?: string } => {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters long' };
  }
  return { valid: true };
};

export const validateAmount = (amount: number): { valid: boolean; message?: string } => {
  if (amount <= 0) {
    return { valid: false, message: 'Amount must be greater than zero' };
  }
  if (!isFinite(amount)) {
    return { valid: false, message: 'Amount must be a valid number' };
  }
  return { valid: true };
};

export const validateCurrency = (currency: string): boolean => {
  // Basic ISO 4217 validation (3 uppercase letters)
  return /^[A-Z]{3}$/.test(currency);
};

export const sanitizeDescription = (description: string, maxLength: number = 200): string => {
  return description.trim().slice(0, maxLength);
};

