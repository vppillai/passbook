/**
 * Analytics service for fetching analytics data and reports
 */
import { apiClient } from './api';
import { AnalyticsData } from '../types';

class AnalyticsService {
  /**
   * Get analytics data for a child
   */
  async getAnalytics(
    childUserId?: string,
    options?: {
      startDate?: string;
      endDate?: string;
    }
  ): Promise<AnalyticsData> {
    const params = new URLSearchParams();
    if (childUserId) {
      params.append('childUserId', childUserId);
    }
    if (options?.startDate) {
      params.append('startDate', options.startDate);
    }
    if (options?.endDate) {
      params.append('endDate', options.endDate);
    }

    const queryString = params.toString();
    const url = `/analytics${queryString ? `?${queryString}` : ''}`;

    return await apiClient.get<AnalyticsData>(url);
  }

  /**
   * Generate a report (PDF or Excel)
   */
  async generateReport(
    childUserId: string,
    type: 'pdf' | 'excel',
    options?: {
      startDate?: string;
      endDate?: string;
    }
  ): Promise<any> {
    const params = new URLSearchParams();
    params.append('childUserId', childUserId);
    params.append('type', type);
    if (options?.startDate) {
      params.append('startDate', options.startDate);
    }
    if (options?.endDate) {
      params.append('endDate', options.endDate);
    }

    return await apiClient.get(`/analytics/report?${params.toString()}`);
  }
}

export const analyticsService = new AnalyticsService();
