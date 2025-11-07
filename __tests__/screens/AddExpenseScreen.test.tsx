/**
 * Tests for AddExpenseScreen component
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AddExpenseScreen } from '../../src/screens/ChildScreens/AddExpenseScreen';
import { expensesService } from '../../src/services/expenses';
import { useAuthStore } from '../../src/store';

jest.mock('../../src/services/expenses');
jest.mock('../../src/store');

describe('AddExpenseScreen', () => {
  const mockNavigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as jest.Mock).mockReturnValue({
      user: { userId: 'child-id', userType: 'child' },
    });
  });

  it('should render add expense screen', () => {
    const { getByText } = render(<AddExpenseScreen navigation={mockNavigation} />);

    expect(getByText(/add expense/i)).toBeTruthy();
  });

  it('should validate required fields', async () => {
    const { getByText, queryByText } = render(
      <AddExpenseScreen navigation={mockNavigation} />
    );

    const addButton = getByText(/add expense/i);
    fireEvent.press(addButton);

    await waitFor(() => {
      expect(queryByText(/required/i)).toBeTruthy();
    });
  });

  it('should validate amount is positive', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(
      <AddExpenseScreen navigation={mockNavigation} />
    );

    const amountInput = getByPlaceholderText(/amount/i);
    fireEvent.changeText(amountInput, '-10');

    const addButton = getByText(/add expense/i);
    fireEvent.press(addButton);

    await waitFor(() => {
      expect(queryByText(/must be greater than 0/i)).toBeTruthy();
    });
  });

  it('should successfully add expense', async () => {
    (expensesService.addExpense as jest.Mock).mockResolvedValue({
      transactionId: 'tx-1',
      amount: 10.50,
      currency: 'CAD',
      newBalance: 39.50,
      wasOverdraft: false,
    });

    const { getByPlaceholderText, getByText } = render(
      <AddExpenseScreen navigation={mockNavigation} />
    );

    fireEvent.changeText(getByPlaceholderText(/amount/i), '10.50');
    fireEvent.changeText(getByPlaceholderText(/description/i), 'Ice cream');

    // Select category (assuming CategoryPicker is rendered)
    const addButton = getByText(/add expense/i);
    fireEvent.press(addButton);

    await waitFor(() => {
      expect(expensesService.addExpense).toHaveBeenCalled();
    });
  });

  it('should handle overdraft warning', async () => {
    (expensesService.addExpense as jest.Mock).mockResolvedValue({
      transactionId: 'tx-1',
      amount: 60.0,
      currency: 'CAD',
      newBalance: -10.0,
      wasOverdraft: true,
    });

    const { getByPlaceholderText, getByText, queryByText } = render(
      <AddExpenseScreen navigation={mockNavigation} />
    );

    fireEvent.changeText(getByPlaceholderText(/amount/i), '60');
    fireEvent.changeText(getByPlaceholderText(/description/i), 'Large purchase');

    const addButton = getByText(/add expense/i);
    fireEvent.press(addButton);

    await waitFor(() => {
      expect(queryByText(/overdraft/i)).toBeTruthy();
    });
  });

  it('should handle add expense errors', async () => {
    (expensesService.addExpense as jest.Mock).mockRejectedValue(
      new Error('Insufficient balance')
    );

    const { getByPlaceholderText, getByText, queryByText } = render(
      <AddExpenseScreen navigation={mockNavigation} />
    );

    fireEvent.changeText(getByPlaceholderText(/amount/i), '100');
    fireEvent.changeText(getByPlaceholderText(/description/i), 'Expensive item');

    const addButton = getByText(/add expense/i);
    fireEvent.press(addButton);

    await waitFor(() => {
      expect(queryByText(/insufficient balance/i)).toBeTruthy();
    });
  });
});
