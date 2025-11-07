/**
 * Offline queue manager for queuing operations when offline
 */
import { Expense, FundAddition } from '../types';
import { storage } from './storage';

interface QueuedOperation {
  id: string;
  type: 'expense' | 'fund' | 'expense_update' | 'child_create' | 'child_update';
  data: any;
  timestamp: number;
  retries: number;
}

class OfflineQueue {
  private queue: QueuedOperation[] = [];
  private maxRetries = 3;

  /**
   * Add an operation to the queue
   */
  async addOperation(
    type: QueuedOperation['type'],
    data: any
  ): Promise<string> {
    const operation: QueuedOperation = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      timestamp: Date.now(),
      retries: 0,
    };

    this.queue.push(operation);
    await this.saveQueue();
    return operation.id;
  }

  /**
   * Get all queued operations
   */
  async getQueue(): Promise<QueuedOperation[]> {
    return [...this.queue];
  }

  /**
   * Remove an operation from the queue
   */
  async removeOperation(operationId: string): Promise<void> {
    this.queue = this.queue.filter(op => op.id !== operationId);
    await this.saveQueue();
  }

  /**
   * Mark an operation for retry
   */
  async markForRetry(operationId: string): Promise<boolean> {
    const operation = this.queue.find(op => op.id === operationId);
    if (!operation) {
      return false;
    }

    operation.retries += 1;
    if (operation.retries >= this.maxRetries) {
      // Remove if max retries exceeded
      await this.removeOperation(operationId);
      return false;
    }

    await this.saveQueue();
    return true;
  }

  /**
   * Clear the queue
   */
  async clearQueue(): Promise<void> {
    this.queue = [];
    await this.saveQueue();
  }

  /**
   * Save queue to storage
   */
  private async saveQueue(): Promise<void> {
    await storage.addToOfflineQueue(this.queue);
  }

  /**
   * Load queue from storage
   */
  async loadQueue(): Promise<void> {
    const savedQueue = await storage.getOfflineQueue();
    this.queue = savedQueue || [];
  }
}

export const offlineQueue = new OfflineQueue();
