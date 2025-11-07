/**
 * Tests for ChildManagementScreen component
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ChildManagementScreen } from '../../src/screens/ParentScreens/ChildManagementScreen';
import { childAccountsService } from '../../src/services/childAccounts';
import { useAuthStore } from '../../src/store';

jest.mock('../../src/services/childAccounts');
jest.mock('../../src/store');

describe('ChildManagementScreen', () => {
  const mockNavigation = {
    navigate: jest.fn(),
    goBack: jest.fn(),
  } as any;

  const mockChildren = [
    {
      userId: 'child-1',
      displayName: 'Alice Smith',
      username: 'alice',
      currentBalance: 50.0,
      status: 'active',
    },
    {
      userId: 'child-2',
      displayName: 'Bob Smith',
      username: 'bob',
      currentBalance: 25.0,
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

  it('should render child management screen', async () => {
    const { getByText } = render(<ChildManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      expect(getByText('Manage Children')).toBeTruthy();
    });
  });

  it('should display list of children', async () => {
    const { getByText } = render(<ChildManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      expect(getByText('Alice Smith')).toBeTruthy();
      expect(getByText('Bob Smith')).toBeTruthy();
    });
  });

  it('should show empty state when no children', async () => {
    (childAccountsService.listChildren as jest.Mock).mockResolvedValue([]);

    const { getByText } = render(<ChildManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      expect(getByText(/no children/i)).toBeTruthy();
    });
  });

  it('should open add child modal when button pressed', async () => {
    const { getByText } = render(<ChildManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      const addButton = getByText(/add child/i);
      fireEvent.press(addButton);
    });

    // Modal should be visible
    await waitFor(() => {
      expect(getByText(/add new child/i)).toBeTruthy();
    });
  });

  it('should refresh children list on pull to refresh', async () => {
    const { getByTestId } = render(<ChildManagementScreen navigation={mockNavigation} />);

    await waitFor(() => {
      const scrollView = getByTestId('children-scroll-view');
      // Simulate pull to refresh
      fireEvent.scroll(scrollView, {
        nativeEvent: {
          contentOffset: { y: -100 },
        },
      });
    });

    await waitFor(() => {
      expect(childAccountsService.listChildren).toHaveBeenCalledTimes(2);
    });
  });
});
