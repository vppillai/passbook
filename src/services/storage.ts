/**
 * Secure storage service for React Native (cross-platform)
 * Uses AsyncStorage for mobile, IndexedDB for web
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isWeb } from '../utils/platform';

// Storage keys
const STORAGE_KEYS = {
  TOKEN: '@passbook:token',
  USER: '@passbook:user',
  FAMILY_ID: '@passbook:familyId',
  OFFLINE_QUEUE: '@passbook:offlineQueue',
  EXPENSES: '@passbook:expenses',
  FUNDS: '@passbook:funds',
  CHILDREN: '@passbook:children',
} as const;

class StorageService {
  /**
   * Store authentication token
   */
  async setToken(token: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.TOKEN, token);
  }

  /**
   * Get authentication token
   */
  async getToken(): Promise<string | null> {
    return await AsyncStorage.getItem(STORAGE_KEYS.TOKEN);
  }

  /**
   * Store user data
   */
  async setUser(user: any): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  }

  /**
   * Get user data
   */
  async getUser(): Promise<any | null> {
    const userStr = await AsyncStorage.getItem(STORAGE_KEYS.USER);
    return userStr ? JSON.parse(userStr) : null;
  }

  /**
   * Store family ID
   */
  async setFamilyId(familyId: string): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.FAMILY_ID, familyId);
  }

  /**
   * Get family ID
   */
  async getFamilyId(): Promise<string | null> {
    return await AsyncStorage.getItem(STORAGE_KEYS.FAMILY_ID);
  }

  /**
   * Clear all stored data (logout)
   */
  async clear(): Promise<void> {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.TOKEN,
      STORAGE_KEYS.USER,
      STORAGE_KEYS.FAMILY_ID,
    ]);
  }

  /**
   * Store offline queue item
   */
  async addToOfflineQueue(item: any): Promise<void> {
    const queue = await this.getOfflineQueue();
    queue.push(item);
    await AsyncStorage.setItem(STORAGE_KEYS.OFFLINE_QUEUE, JSON.stringify(queue));
  }

  /**
   * Get offline queue
   */
  async getOfflineQueue(): Promise<any[]> {
    const queueStr = await AsyncStorage.getItem(STORAGE_KEYS.OFFLINE_QUEUE);
    return queueStr ? JSON.parse(queueStr) : [];
  }

  /**
   * Clear offline queue
   */
  async clearOfflineQueue(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEYS.OFFLINE_QUEUE);
  }

  /**
   * Store expenses locally for offline access
   */
  async saveExpenses(expenses: any[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses));
  }

  /**
   * Get cached expenses
   */
  async getExpenses(): Promise<any[]> {
    const expensesStr = await AsyncStorage.getItem(STORAGE_KEYS.EXPENSES);
    return expensesStr ? JSON.parse(expensesStr) : [];
  }

  /**
   * Store funds locally
   */
  async saveFunds(funds: any[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.FUNDS, JSON.stringify(funds));
  }

  /**
   * Get cached funds
   */
  async getFunds(): Promise<any[]> {
    const fundsStr = await AsyncStorage.getItem(STORAGE_KEYS.FUNDS);
    return fundsStr ? JSON.parse(fundsStr) : [];
  }

  /**
   * Store children locally
   */
  async saveChildren(children: any[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.CHILDREN, JSON.stringify(children));
  }

  /**
   * Get cached children
   */
  async getChildren(): Promise<any[]> {
    const childrenStr = await AsyncStorage.getItem(STORAGE_KEYS.CHILDREN);
    return childrenStr ? JSON.parse(childrenStr) : [];
  }
}

export const storage = new StorageService();
