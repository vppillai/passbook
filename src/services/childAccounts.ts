/**
 * Child account management service
 */
import { apiClient } from './api';
import { ChildAccount } from '../types';

class ChildAccountsService {
  /**
   * Create a new child account
   */
  async createChild(data: {
    displayName: string;
    username?: string;
    email?: string;
    password: string;
  }): Promise<ChildAccount> {
    const response = await apiClient.post<{
      message: string;
      child: ChildAccount;
    }>('/accounts/children', data);
    return response.child;
  }

  /**
   * List all children in the family
   */
  async listChildren(): Promise<ChildAccount[]> {
    const response = await apiClient.get<{
      children: ChildAccount[];
      count: number;
    }>('/accounts/children');
    return response.children;
  }

  /**
   * Update a child account
   */
  async updateChild(
    childId: string,
    updates: {
      displayName?: string;
      username?: string;
      password?: string;
      overdraftLimit?: number;
      notificationsEnabled?: boolean;
    }
  ): Promise<void> {
    await apiClient.put(`/accounts/children/${childId}`, updates);
  }

  /**
   * Reset a child's password
   */
  async resetChildPassword(childId: string, newPassword: string): Promise<void> {
    await apiClient.post(`/accounts/children/${childId}/reset-password`, {
      password: newPassword,
    });
  }

  /**
   * Get a specific child account
   */
  async getChild(childId: string): Promise<ChildAccount> {
    return await apiClient.get<ChildAccount>(`/accounts/children/${childId}`);
  }
}

export const childAccountsService = new ChildAccountsService();
