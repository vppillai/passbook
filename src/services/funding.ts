/**
 * Funding service for adding funds to child accounts
 */
import { apiClient } from './api';
import { FundAddition } from '../types';
import { offlineQueue } from './offlineQueue';
import { syncService } from './syncService';

class FundingService {
  /**
   * Add funds to a child account
   */
  async addFunds(data: {
    childUserId: string;
    amount: number;
    reason: string;
  }): Promise<{
    transactionId: string;
    amount: number;
    currency: string;
    newBalance: number;
  }> {
    const isOnline = await syncService.isOnline();

    if (!isOnline) {
      // Queue for offline sync
      await offlineQueue.addOperation('fund', data);
      // Return optimistic response
      return {
        transactionId: `offline_${Date.now()}`,
        amount: data.amount,
        currency: 'CAD',
        newBalance: 0, // Will be updated after sync
      };
    }

    try {
      const response = await apiClient.post<{
        message: string;
        transactionId: string;
        amount: number;
        currency: string;
        newBalance: number;
      }>('/transactions/funds', data);

      return {
        transactionId: response.transactionId,
        amount: response.amount,
        currency: response.currency,
        newBalance: response.newBalance,
      };
    } catch (error: any) {
      // If network error, queue for offline sync
      if (!error.response) {
        await offlineQueue.addOperation('fund', data);
        return {
          transactionId: `offline_${Date.now()}`,
          amount: data.amount,
          currency: 'CAD',
          newBalance: 0,
        };
      }
      throw error;
    }
  }

  /**
   * Get funding history for a child
   */
  async getFundingHistory(childUserId: string): Promise<FundAddition[]> {
    const response = await apiClient.get<{
      fundAdditions: FundAddition[];
    }>(`/transactions/funds/${childUserId}`);

    return response.fundAdditions;
  }
}

export const fundingService = new FundingService();
