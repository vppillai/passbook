/**
 * Email Service for Password Reset
 *
 * Handles sending password reset emails through AWS Lambda API.
 * In browser environment, calls AWS API Gateway endpoint.
 * In Node.js environment, can use nodemailer directly for testing.
 */

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    password: string;
  };
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

const ZOHO_SMTP_CONFIG: EmailConfig = {
  host: 'smtp.zoho.in',
  port: 587,
  secure: false,
  auth: {
    user: 'support@embeddedinn.com',
    password: process.env.ZOHO_SMTP_PASSWORD || '',
  },
};

const isBrowser = typeof window !== 'undefined';

const getEmailApiUrl = (): string => {
  const envUrl = import.meta.env.VITE_EMAIL_API_URL;
  if (envUrl) {
    return envUrl;
  }
  return '/api/email/send';
};

export class EmailService {
  private config: EmailConfig;
  private fromEmail: string;

  constructor(config?: Partial<EmailConfig>) {
    this.config = { ...ZOHO_SMTP_CONFIG, ...config };
    this.fromEmail = 'support@embeddedinn.com';
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email: string, resetToken: string, accountType: 'parent' | 'child'): Promise<void> {
    if (isBrowser) {
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
    } else {
      // Node.js environment - generate email content and use nodemailer
      const resetUrl = `https://vppillai.github.io/passbook/reset-password?token=${resetToken}&email=${encodeURIComponent(email)}&type=${accountType}`;

      const subject = 'Password Reset Request - Allowance Passbook';
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #0ea5e9; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px; }
              .button { display: inline-block; padding: 12px 24px; background-color: #0ea5e9; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
              .footer { text-align: center; margin-top: 20px; font-size: 12px; color: #666; }
              .warning { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 12px; margin: 20px 0; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Allowance Passbook</h1>
              </div>
              <div class="content">
                <h2>Password Reset Request</h2>
                <p>Hello,</p>
                <p>We received a request to reset your password for your ${accountType} account (${email}).</p>
                <p>Click the button below to reset your password:</p>
                <p style="text-align: center;">
                  <a href="${resetUrl}" class="button">Reset Password</a>
                </p>
                <p>Or copy and paste this link into your browser:</p>
                <p style="word-break: break-all; color: #0ea5e9;">${resetUrl}</p>
                <div class="warning">
                  <strong>Security Notice:</strong>
                  <ul>
                    <li>This link will expire in 1 hour</li>
                    <li>If you didn't request this, please ignore this email</li>
                    <li>Never share your reset link with anyone</li>
                  </ul>
                </div>
              </div>
              <div class="footer">
                <p>This is an automated email from Allowance Passbook.</p>
                <p>Please do not reply to this email.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const text = `
Allowance Passbook - Password Reset Request

We received a request to reset your password for your ${accountType} account (${email}).

Reset your password by visiting:
${resetUrl}

This link will expire in 1 hour.

If you didn't request this, please ignore this email.

This is an automated email. Please do not reply.
      `;

      await this.sendEmail({
        to: email,
        subject,
        html,
        text,
      });
    }
  }

  /**
   * Send email - Node.js only implementation
   */
  private async sendEmail(options: EmailOptions): Promise<void> {
    const nodemailer = await import('nodemailer');

    if (!this.config.auth.password) {
      throw new Error('ZOHO_SMTP_PASSWORD environment variable is not set');
    }

    const transporter = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
    });

    await transporter.sendMail({
      from: this.fromEmail,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  /**
   * Test SMTP connection (Node.js only)
   */
  async testConnection(): Promise<boolean> {
    if (isBrowser) {
      try {
        const response = await fetch('/api/email/test', {
          method: 'POST',
        });
        return response.ok;
      } catch {
        return false;
      }
    } else {
      try {
        const nodemailer = await import('nodemailer');

        if (!this.config.auth.password) {
          console.error('ZOHO_SMTP_PASSWORD environment variable is not set');
          return false;
        }

        const transporter = nodemailer.createTransport({
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure,
          auth: this.config.auth,
        });

        await transporter.verify();
        console.log('SMTP connection verified successfully');
        return true;
      } catch (error) {
        console.error('SMTP connection failed:', error);
        return false;
      }
    }
  }
}

export const emailService = new EmailService();