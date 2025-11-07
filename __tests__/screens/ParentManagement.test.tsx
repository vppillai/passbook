/**
 * Tests for ParentManagementScreen component
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ParentManagementScreen } from '../../src/screens/ParentScreens/ParentManagementScreen';
import { parentAccountsService } from '../../src/services/parentAccounts';
import { useAuthStore } from '../../src/store';

jest.mock('../../src/services/parentAccounts');
jest.mock('../../src/store');

describe('ParentManagementScreen', () => {
  const mockNavigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
  } as any;

  const mockParents = [
    {
      userId: 'parent-1',
      email: 'parent1@example.com',
      displayName: 'Parent One',
      status: 'active',
    },
    {
      userId: 'parent-2',
      email: 'parent2@example.com',
      displayName: 'Parent Two',
      status: 'pending',
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuthStore as jest.Mock).mockReturnValue({
      user: { userId: 'parent-id', familyId: 'family-id' },
    });
    (parentAccountsService.listParents as jest.Mock).mockResolvedValue(mockParents);
  });

  it('should render parent management screen', async () => {
    const { getByText } = render(<ParentManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      expect(getByText(/family parents/i)).toBeTruthy();
    });
  });

  it('should display list of parents', async () => {
    const { getByText } = render(<ParentManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      expect(getByText('parent1@example.com')).toBeTruthy();
      expect(getByText('parent2@example.com')).toBeTruthy();
    });
  });

  it('should show pending status for invited parents', async () => {
    const { getByText } = render(<ParentManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      expect(getByText(/pending invitation/i)).toBeTruthy();
    });
  });

  it('should open invite modal when button pressed', async () => {
    const { getByText } = render(<ParentManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      const inviteButton = getByText(/invite parent/i);
      fireEvent.press(inviteButton);
    });

    // Modal should be visible
    await waitFor(() => {
      expect(getByText(/invite parent/i)).toBeTruthy();
    });
  });

  it('should handle resend invitation', async () => {
    (parentAccountsService.resendInvitation as jest.Mock).mockResolvedValue(undefined);

    const { getByText } = render(<ParentManagementScreen navigation={mockNavigation} />);

    await waitFor(async () => {
      const resendButton = getByText(/resend/i);
      fireEvent.press(resendButton);
    });

    await waitFor(() => {
      expect(parentAccountsService.resendInvitation).toHaveBeenCalled();
    });
  });
});
