/**
 * Conflict resolution utilities for handling sync conflicts
 */
import { Expense, FundAddition } from '../types';

export interface ConflictResolution {
  strategy: 'server' | 'client' | 'merge' | 'manual';
  resolvedData?: any;
}

/**
 * Resolve conflicts between local and server data
 * Uses last-write-wins strategy for simplicity
 */
export function resolveConflict(
  localData: any,
  serverData: any,
  type: 'expense' | 'fund' | 'child'
): ConflictResolution {
  // Simple last-write-wins strategy
  // In production, you might want more sophisticated conflict resolution

  const localTimestamp = localData.recordedAt || localData.addedAt || localData.updatedAt || 0;
  const serverTimestamp = serverData.recordedAt || serverData.addedAt || serverData.updatedAt || 0;

  if (localTimestamp > serverTimestamp) {
    return {
      strategy: 'client',
      resolvedData: localData,
    };
  } else {
    return {
      strategy: 'server',
      resolvedData: serverData,
    };
  }
}

/**
 * Merge expense data (for manual conflict resolution)
 */
export function mergeExpenseData(
  localExpense: Expense,
  serverExpense: Expense
): Expense {
  // Return the most recent version
  const localTime = new Date(localExpense.recordedAt).getTime();
  const serverTime = new Date(serverExpense.recordedAt).getTime();

  if (localTime > serverTime) {
    return localExpense;
  }
  return serverExpense;
}

/**
 * Check if two expenses are in conflict
 */
export function isExpenseConflict(
  localExpense: Expense,
  serverExpense: Expense
): boolean {
  // Check if same transaction was modified differently
  if (localExpense.transactionId !== serverExpense.transactionId) {
    return false;
  }

  // Check if last edited times differ significantly
  const localEditTime = localExpense.lastEditedAt
    ? new Date(localExpense.lastEditedAt).getTime()
    : new Date(localExpense.recordedAt).getTime();

  const serverEditTime = serverExpense.lastEditedAt
    ? new Date(serverExpense.lastEditedAt).getTime()
    : new Date(serverExpense.recordedAt).getTime();

  // Consider it a conflict if edited at different times
  return localEditTime !== serverEditTime;
}
