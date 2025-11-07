/**
 * Tests for SignupScreen component
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SignupScreen } from '../../src/screens/SharedScreens/SignupScreen';
import { authService } from '../../src/services/auth';
import { useAuthStore } from '../../src/store';

jest.mock('../../src/services/auth');
jest.mock('../../src/store');

describe('SignupScreen', () => {
  const mockNavigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render signup form', () => {
    const { getByPlaceholderText, getByText } = render(
      <SignupScreen navigation={mockNavigation} />
    );

    expect(getByPlaceholderText('Email')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
    expect(getByPlaceholderText('Display Name')).toBeTruthy();
    expect(getByText('Sign Up')).toBeTruthy();
  });

  it('should validate required fields', async () => {
    const { getByText, queryByText } = render(
      <SignupScreen navigation={mockNavigation} />
    );

    const signupButton = getByText('Sign Up');
    fireEvent.press(signupButton);

    await waitFor(() => {
      expect(queryByText(/required/i)).toBeTruthy();
    });
  });

  it('should validate email format', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(
      <SignupScreen navigation={mockNavigation} />
    );

    const emailInput = getByPlaceholderText('Email');
    fireEvent.changeText(emailInput, 'invalid-email');

    const signupButton = getByText('Sign Up');
    fireEvent.press(signupButton);

    await waitFor(() => {
      expect(queryByText(/invalid email/i)).toBeTruthy();
    });
  });

  it('should validate password length', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(
      <SignupScreen navigation={mockNavigation} />
    );

    const passwordInput = getByPlaceholderText('Password');
    fireEvent.changeText(passwordInput, 'short');

    const signupButton = getByText('Sign Up');
    fireEvent.press(signupButton);

    await waitFor(() => {
      expect(queryByText(/at least 8 characters/i)).toBeTruthy();
    });
  });

  it('should successfully sign up', async () => {
    const mockSignup = jest.fn().mockResolvedValue({
      userId: 'test-user-id',
      email: 'test@example.com',
    });
    (authService.signup as jest.Mock) = mockSignup;

    const { getByPlaceholderText, getByText } = render(
      <SignupScreen navigation={mockNavigation} />
    );

    fireEvent.changeText(getByPlaceholderText('Email'), 'test@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');
    fireEvent.changeText(getByPlaceholderText('Display Name'), 'Test User');

    const signupButton = getByText('Sign Up');
    fireEvent.press(signupButton);

    await waitFor(() => {
      expect(mockSignup).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
        displayName: 'Test User',
      });
    });
  });

  it('should handle signup errors', async () => {
    const mockSignup = jest.fn().mockRejectedValue(new Error('Email already registered'));
    (authService.signup as jest.Mock) = mockSignup;

    const { getByPlaceholderText, getByText } = render(
      <SignupScreen navigation={mockNavigation} />
    );

    fireEvent.changeText(getByPlaceholderText('Email'), 'test@example.com');
    fireEvent.changeText(getByPlaceholderText('Password'), 'password123');
    fireEvent.changeText(getByPlaceholderText('Display Name'), 'Test User');

    const signupButton = getByText('Sign Up');
    fireEvent.press(signupButton);

    await waitFor(() => {
      expect(mockSignup).toHaveBeenCalled();
    });
  });
});
