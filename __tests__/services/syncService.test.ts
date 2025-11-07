/**
 * Tests for sync service
 */
import { syncService } from '../../src/services/syncService';
import { offlineQueue } from '../../src/services/offlineQueue';
import { expensesService } from '../../src/services/expenses';
import NetInfo from '@react-native-community/netinfo';

jest.mock('../../src/services/offlineQueue');
jest.mock('../../src/services/expenses');
jest.mock('@react-native-community/netinfo');

describe('SyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isOnline', () => {
    it('should return true when online', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: true,
      });

      const result = await syncService.isOnline();
      expect(result).toBe(true);
    });

    it('should return false when offline', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: false,
      });

      const result = await syncService.isOnline();
      expect(result).toBe(false);
    });
  });

  describe('sync', () => {
    it('should sync queued operations when online', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: true,
      });

      const mockQueue = [
        {
          id: 'op-1',
          type: 'expense',
          data: { amount: 10.50, category: 'snacks' },
          retries: 0,
        },
      ];

      (offlineQueue.loadQueue as jest.Mock).mockResolvedValue(undefined);
      (offlineQueue.getQueue as jest.Mock).mockResolvedValue(mockQueue);
      (expensesService.addExpense as jest.Mock).mockResolvedValue({
        transactionId: 'tx-1',
        amount: 10.50,
      });
      (offlineQueue.removeOperation as jest.Mock).mockResolvedValue(undefined);

      const result = await syncService.sync();

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(expensesService.addExpense).toHaveBeenCalledWith(mockQueue[0].data);
    });

    it('should not sync when offline', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: false,
      });

      const result = await syncService.sync();

      expect(result.success).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('should retry failed operations', async () => {
      (NetInfo.fetch as jest.Mock).mockResolvedValue({
        isConnected: true,
      });

      const mockQueue = [
        {
          id: 'op-1',
          type: 'expense',
          data: { amount: 10.50 },
          retries: 0,
        },
      ];

      (offlineQueue.loadQueue as jest.Mock).mockResolvedValue(undefined);
      (offlineQueue.getQueue as jest.Mock).mockResolvedValue(mockQueue);
      (expensesService.addExpense as jest.Mock).mockRejectedValue(new Error('Network error'));
      (offlineQueue.markForRetry as jest.Mock).mockResolvedValue(true);

      const result = await syncService.sync();

      expect(result.success).toBe(0);
      expect(offlineQueue.markForRetry).toHaveBeenCalledWith('op-1');
    });
  });

  describe('startAutoSync', () => {
    it('should set up network listener', () => {
      const mockListener = jest.fn();
      (NetInfo.addEventListener as jest.Mock).mockReturnValue(mockListener);

      syncService.startAutoSync();

      expect(NetInfo.addEventListener).toHaveBeenCalled();
    });
  });
});
