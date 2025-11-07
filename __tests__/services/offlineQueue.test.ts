/**
 * Unit tests for offline queue service (TypeScript/JavaScript)
 */
import { offlineQueue } from '../../src/services/offlineQueue';
import { storage } from '../../src/services/storage';

jest.mock('../../src/services/storage');

describe('OfflineQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (storage.getOfflineQueue as jest.Mock).mockResolvedValue([]);
    (storage.addToOfflineQueue as jest.Mock).mockResolvedValue(undefined);
  });

  describe('addOperation', () => {
    it('should add operation to queue', async () => {
      const operationId = await offlineQueue.addOperation('expense', {
        amount: 10.50,
        category: 'snacks'
      });

      expect(operationId).toBeDefined();
      expect(operationId).toContain('expense');
      expect(storage.addToOfflineQueue).toHaveBeenCalled();
    });
  });

  describe('getQueue', () => {
    it('should return queued operations', async () => {
      const mockQueue = [
        {
          id: 'test-id',
          type: 'expense',
          data: { amount: 10.50 },
          timestamp: Date.now(),
          retries: 0
        }
      ];

      (storage.getOfflineQueue as jest.Mock).mockResolvedValue(mockQueue);

      await offlineQueue.loadQueue();
      const queue = await offlineQueue.getQueue();

      expect(queue).toEqual(mockQueue);
      expect(storage.getOfflineQueue).toHaveBeenCalled();
    });
  });

  describe('removeOperation', () => {
    it('should remove operation from queue', async () => {
      const mockQueue = [
        { id: 'test-id-1', type: 'expense', timestamp: Date.now(), retries: 0 },
        { id: 'test-id-2', type: 'fund', timestamp: Date.now(), retries: 0 }
      ];

      (storage.getOfflineQueue as jest.Mock).mockResolvedValue(mockQueue);

      await offlineQueue.loadQueue();
      await offlineQueue.removeOperation('test-id-1');

      expect(storage.addToOfflineQueue).toHaveBeenCalled();
    });
  });

  describe('markForRetry', () => {
    it('should mark operation for retry', async () => {
      const mockQueue = [
        {
          id: 'test-id',
          type: 'expense',
          data: {},
          timestamp: Date.now(),
          retries: 0
        }
      ];

      (storage.getOfflineQueue as jest.Mock).mockResolvedValue(mockQueue);

      await offlineQueue.loadQueue();
      const result = await offlineQueue.markForRetry('test-id');

      expect(result).toBe(true);
    });

    it('should remove operation if max retries exceeded', async () => {
      const mockQueue = [
        {
          id: 'test-id',
          type: 'expense',
          data: {},
          timestamp: Date.now(),
          retries: 3
        }
      ];

      (storage.getOfflineQueue as jest.Mock).mockResolvedValue(mockQueue);

      await offlineQueue.loadQueue();
      const result = await offlineQueue.markForRetry('test-id');

      expect(result).toBe(false);
    });
  });
});
