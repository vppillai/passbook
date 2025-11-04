/**
 * Email Service for Password Reset
 *
 * Handles sending password reset emails through AWS Lambda API.
 * Browser-only implementation that calls AWS API Gateway endpoint.
 */

const getEmailApiUrl = (): string => {
  const envUrl = import.meta.env.VITE_EMAIL_API_URL;
  if (envUrl) {
    return envUrl;
  }
  // Default to production API Gateway endpoint
  return 'https://nktkmakeil.execute-api.us-west-2.amazonaws.com/v1/api/email/send';
};

export class EmailService {
  constructor() {
    // Browser-only implementation
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetToken: string, accountType: 'parent' | 'child'): Promise<void> {
    const apiUrl = getEmailApiUrl();
    const baseUrl = window.location.origin + '/passbook';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: email,
        resetToken,
        accountType,
        baseUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Failed to send email' }));
      throw new Error(error.message || 'Failed to send password reset email');
    }
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch('/api/email/test', {
        method: 'POST',
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

export const emailService = new EmailService();