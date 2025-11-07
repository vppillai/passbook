/**
 * Sync service for synchronizing offline changes with the server
 */
import NetInfo from '@react-native-community/netinfo';
import { offlineQueue } from './offlineQueue';
import { expensesService } from './expenses';
import { fundingService } from './funding';
import { childAccountsService } from './childAccounts';

class SyncService {
  private isSyncing = false;
  private syncListeners: Array<() => void> = [];

  /**
   * Check if device is online
   */
  async isOnline(): Promise<boolean> {
    const state = await NetInfo.fetch();
    return state.isConnected ?? false;
  }

  /**
   * Sync all queued operations
   */
  async sync(): Promise<{ success: number; failed: number }> {
    if (this.isSyncing) {
      return { success: 0, failed: 0 };
    }

    const isOnline = await this.isOnline();
    if (!isOnline) {
      return { success: 0, failed: 0 };
    }

    this.isSyncing = true;
    await offlineQueue.loadQueue();
    const queue = await offlineQueue.getQueue();

    let success = 0;
    let failed = 0;

    for (const operation of queue) {
      try {
        await this.executeOperation(operation);
        await offlineQueue.removeOperation(operation.id);
        success++;
      } catch (error) {
        console.error(`Failed to sync operation ${operation.id}:`, error);
        const willRetry = await offlineQueue.markForRetry(operation.id);
        if (!willRetry) {
          failed++;
        }
      }
    }

    this.isSyncing = false;
    this.notifySyncComplete();
    return { success, failed };
  }

  /**
   * Execute a single queued operation
   */
  private async executeOperation(operation: any): Promise<void> {
    switch (operation.type) {
      case 'expense':
        await expensesService.addExpense(operation.data);
        break;
      case 'expense_update':
        await expensesService.updateExpense(
          operation.data.transactionId,
          operation.data.updates
        );
        break;
      case 'fund':
        await fundingService.addFunds(operation.data);
        break;
      case 'child_create':
        await childAccountsService.createChild(operation.data);
        break;
      case 'child_update':
        await childAccountsService.updateChild(
          operation.data.childId,
          operation.data.updates
        );
        break;
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Start automatic sync when online
   */
  startAutoSync(): void {
    NetInfo.addEventListener(state => {
      if (state.isConnected) {
        this.sync();
      }
    });
  }

  /**
   * Add sync complete listener
   */
  onSyncComplete(callback: () => void): void {
    this.syncListeners.push(callback);
  }

  /**
   * Notify sync complete listeners
   */
  private notifySyncComplete(): void {
    this.syncListeners.forEach(callback => callback());
  }
}

export const syncService = new SyncService();
