/**
 * Parent account management service
 */
import { apiClient } from './api';
import { ParentAccount } from '../types';

class ParentAccountsService {
  /**
   * Invite a parent to join the family
   */
  async inviteParent(email: string): Promise<{ email: string; expiresAt: string }> {
    const response = await apiClient.post<{
      message: string;
      email: string;
      expiresAt: string;
    }>('/accounts/parents/invite', { email });

    return {
      email: response.email,
      expiresAt: response.expiresAt,
    };
  }

  /**
   * List all parents in the family
   */
  async listParents(): Promise<ParentAccount[]> {
    const response = await apiClient.get<{
      parents: ParentAccount[];
      count: number;
    }>('/accounts/parents');

    return response.parents;
  }

  /**
   * Resend invitation to a parent
   */
  async resendInvitation(email: string): Promise<void> {
    await apiClient.post('/accounts/parents/resend-invitation', { email });
  }
}

export const parentAccountsService = new ParentAccountsService();
