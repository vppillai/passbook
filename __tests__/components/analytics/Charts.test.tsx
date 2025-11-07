/**
 * Tests for analytics charts components
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { PieChart } from '../../src/components/analytics/PieChart';
import { LineChart } from '../../src/components/analytics/LineChart';

describe('Analytics Charts', () => {
  describe('PieChart', () => {
    const mockData = [
      { category: 'snacks', amount: 25.50, percentage: 45.5 },
      { category: 'toys', amount: 15.0, percentage: 26.8 },
      { category: 'books', amount: 15.5, percentage: 27.7 },
    ];

    it('should render pie chart with data', () => {
      const { getByText } = render(<PieChart data={mockData} />);

      expect(getByText(/spending by category/i)).toBeTruthy();
      expect(getByText(/snacks/i)).toBeTruthy();
    });

    it('should show empty state when no data', () => {
      const { getByText } = render(<PieChart data={[]} />);

      expect(getByText(/no data available/i)).toBeTruthy();
    });

    it('should display category breakdown in legend', () => {
      const { getByText } = render(<PieChart data={mockData} />);

      expect(getByText(/snacks:/i)).toBeTruthy();
      expect(getByText(/toys:/i)).toBeTruthy();
    });
  });

  describe('LineChart', () => {
    const mockTrends = [
      { date: '2024-01-15', amount: 10.50 },
      { date: '2024-01-16', amount: 15.0 },
      { date: '2024-01-17', amount: 5.0 },
    ];

    it('should render line chart with data', () => {
      const { getByText } = render(<LineChart data={mockTrends} />);

      expect(getByText(/spending trends/i)).toBeTruthy();
    });

    it('should show empty state when no data', () => {
      const { getByText } = render(<LineChart data={[]} />);

      expect(getByText(/no spending data available/i)).toBeTruthy();
    });
  });
});
