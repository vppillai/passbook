/**
 * Tests for AddFundsScreen component
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { AddFundsScreen } from '../../src/screens/ParentScreens/AddFundsScreen';
import { fundingService } from '../../src/services/funding';
import { childAccountsService } from '../../src/services/childAccounts';
import { useAuthStore } from '../../src/store';

jest.mock('../../src/services/funding');
jest.mock('../../src/services/childAccounts');
jest.mock('../../src/store');

describe('AddFundsScreen', () => {
  const mockNavigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
  } as any;

  const mockRoute = {
    params: {
      childUserId: 'child-1',
    },
  } as any;

  const mockChildren = [
    {
      userId: 'child-1',
      displayName: 'Alice Smith',
      username: 'alice',
      currentBalance: 50.0,
      status: 'active',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as jest.Mock).mockReturnValue({
      user: { userId: 'parent-id', familyId: 'family-id' },
    });
    (childAccountsService.listChildren as jest.Mock).mockResolvedValue(mockChildren);
  });

  it('should render add funds screen', async () => {
    const { getByText } = render(
      <AddFundsScreen navigation={mockNavigation} route={mockRoute} />
    );

    await waitFor(() => {
      expect(getByText(/add funds/i)).toBeTruthy();
    });
  });

  it('should display child selection', async () => {
    const { getByText } = render(
      <AddFundsScreen navigation={mockNavigation} route={mockRoute} />
    );

    await waitFor(() => {
      expect(getByText('Alice Smith')).toBeTruthy();
    });
  });

  it('should validate amount input', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(
      <AddFundsScreen navigation={mockNavigation} route={mockRoute} />
    );

    await waitFor(() => {
      const amountInput = getByPlaceholderText(/amount/i);
      fireEvent.changeText(amountInput, '0');

      const addButton = getByText(/add funds/i);
      fireEvent.press(addButton);
    });

    await waitFor(() => {
      expect(queryByText(/amount must be greater than 0/i)).toBeTruthy();
    });
  });

  it('should successfully add funds', async () => {
    (fundingService.addFunds as jest.Mock).mockResolvedValue({
      transactionId: 'tx-1',
      amount: 25.0,
      currency: 'CAD',
      newBalance: 75.0,
    });

    const { getByPlaceholderText, getByText } = render(
      <AddFundsScreen navigation={mockNavigation} route={mockRoute} />
    );

    await waitFor(async () => {
      const amountInput = getByPlaceholderText(/amount/i);
      fireEvent.changeText(amountInput, '25');

      const reasonInput = getByPlaceholderText(/reason/i);
      fireEvent.changeText(reasonInput, 'Weekly allowance');

      const addButton = getByText(/add funds/i);
      fireEvent.press(addButton);
    });

    await waitFor(() => {
      expect(fundingService.addFunds).toHaveBeenCalledWith({
        childUserId: 'child-1',
        amount: 25,
        reason: 'Weekly allowance',
      });
    });
  });

  it('should handle add funds errors', async () => {
    (fundingService.addFunds as jest.Mock).mockRejectedValue(
      new Error('Failed to add funds')
    );

    const { getByPlaceholderText, getByText, queryByText } = render(
      <AddFundsScreen navigation={mockNavigation} route={mockRoute} />
    );

    await waitFor(async () => {
      const amountInput = getByPlaceholderText(/amount/i);
      fireEvent.changeText(amountInput, '25');

      const reasonInput = getByPlaceholderText(/reason/i);
      fireEvent.changeText(reasonInput, 'Weekly allowance');

      const addButton = getByText(/add funds/i);
      fireEvent.press(addButton);
    });

    await waitFor(() => {
      expect(queryByText(/failed to add funds/i)).toBeTruthy();
    });
  });
});
