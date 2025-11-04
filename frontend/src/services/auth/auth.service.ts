import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../storage/db';
import { emailService } from '../email/email.service';
import type { ParentAccount, ChildAccount, LoginCredentials, SignupData, AuthUser, PasswordResetToken } from '../../types/models';

export class AuthService {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async createParentAccount(data: SignupData): Promise<ParentAccount> {
    // Check if email already exists
    const existing = await db.parentAccounts.where('email').equals(data.email).first();
    if (existing) {
      throw new Error('Email already registered');
    }

    const now = Date.now();
    const passwordHash = await this.hashPassword(data.password);
    const parentAccount: ParentAccount = {
      id: uuidv4(),
      email: data.email,
      passwordHash,
      name: data.name,
      currency: data.currency || 'CAD',
      accountingPeriodType: 'monthly',
      accountingPeriodStartDay: 1,
      theme: 'system',
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now, // Track when password was set
    };

    await db.parentAccounts.add(parentAccount);
    return parentAccount;
  }

  async createChildAccount(
    parentAccountId: string,
    email: string,
    password: string,
    name: string,
    defaultMonthlyAllowance: number = 100
  ): Promise<ChildAccount> {
    // Check if email already exists
    const existing = await db.childAccounts.where('email').equals(email).first();
    if (existing) {
      throw new Error('Email already registered');
    }

    const now = Date.now();
    const passwordHash = await this.hashPassword(password);
    const childAccount: ChildAccount = {
      id: uuidv4(),
      parentAccountId,
      email,
      passwordHash,
      name,
      currentBalance: defaultMonthlyAllowance,
      defaultMonthlyAllowance,
      isActive: true,
      theme: 'system',
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: now, // Track when password was set
    };

    await db.childAccounts.add(childAccount);
    return childAccount;
  }

  async loginParent(credentials: LoginCredentials): Promise<{ user: AuthUser; token: string; passwordChangedAt: number }> {
    // Try server-side authentication first
    const apiUrl = import.meta.env.VITE_AUTH_API_URL || import.meta.env.VITE_API_URL || 'https://nktkmakeil.execute-api.us-west-2.amazonaws.com/v1/api';

    if (apiUrl) {
      try {
        const response = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
            userType: 'parent',
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Invalid email or password');
        }

        const data = await response.json();

        return {
          user: {
            id: data.userId,
            email: data.email,
            name: data.name,
            type: 'parent',
          },
          token: data.token,
          passwordChangedAt: data.passwordChangedAt || Date.now(),
        };
      } catch (error) {
        // If server auth fails and it's a network error, fall back to local for offline support
        if (error instanceof TypeError && error.message.includes('fetch')) {
          console.warn('Server authentication unavailable, falling back to local authentication');
          // Fall through to local authentication
        } else {
          throw error;
        }
      }
    }

    // Fallback to local authentication (for offline support or if server is not configured)
    const parentAccount = await db.parentAccounts.where('email').equals(credentials.email).first();
    if (!parentAccount) {
      throw new Error('Invalid email or password');
    }

    const isValid = await this.verifyPassword(credentials.password, parentAccount.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    return {
      user: {
        id: parentAccount.id,
        email: parentAccount.email,
        name: parentAccount.name,
        type: 'parent',
      },
      token: '', // No token for local-only auth
      passwordChangedAt: parentAccount.passwordChangedAt || parentAccount.createdAt || Date.now(),
    };
  }

  async loginChild(credentials: LoginCredentials): Promise<{ user: AuthUser; token: string; passwordChangedAt: number }> {
    // Try server-side authentication first
    const apiUrl = import.meta.env.VITE_AUTH_API_URL || import.meta.env.VITE_API_URL || 'https://nktkmakeil.execute-api.us-west-2.amazonaws.com/v1/api';

    if (apiUrl) {
      try {
        const response = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
            userType: 'child',
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Invalid email or password');
        }

        const data = await response.json();

        return {
          user: {
            id: data.userId,
            email: data.email,
            name: data.name,
            type: 'child',
            parentAccountId: data.parentAccountId,
          },
          token: data.token,
          passwordChangedAt: data.passwordChangedAt || Date.now(),
        };
      } catch (error) {
        // If server auth fails and it's a network error, fall back to local for offline support
        if (error instanceof TypeError && error.message.includes('fetch')) {
          console.warn('Server authentication unavailable, falling back to local authentication');
          // Fall through to local authentication
        } else {
          throw error;
        }
      }
    }

    // Fallback to local authentication (for offline support or if server is not configured)
    const childAccount = await db.childAccounts.where('email').equals(credentials.email).first();
    if (!childAccount) {
      throw new Error('Invalid email or password');
    }

    if (!childAccount.isActive) {
      throw new Error('Account is inactive');
    }

    const isValid = await this.verifyPassword(credentials.password, childAccount.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    return {
      user: {
        id: childAccount.id,
        email: childAccount.email,
        name: childAccount.name,
        type: 'child',
        parentAccountId: childAccount.parentAccountId,
      },
      token: '', // No token for local-only auth
      passwordChangedAt: childAccount.passwordChangedAt || childAccount.createdAt || Date.now(),
    };
  }

  async getParentAccountById(id: string): Promise<ParentAccount | undefined> {
    return db.parentAccounts.get(id);
  }

  async getChildAccountById(id: string): Promise<ChildAccount | undefined> {
    return db.childAccounts.get(id);
  }

  /**
   * Validate JWT token with server
   */
  async validateToken(token: string): Promise<{ valid: boolean; userId?: string; email?: string; userType?: string; name?: string }> {
    const apiUrl = import.meta.env.VITE_AUTH_API_URL || import.meta.env.VITE_API_URL || 'https://nktkmakeil.execute-api.us-west-2.amazonaws.com/v1/api';

    if (!apiUrl || !token) {
      return { valid: false };
    }

    try {
      const response = await fetch(`${apiUrl}/auth/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        return { valid: false };
      }

      const data = await response.json();
      return {
        valid: data.valid,
        userId: data.userId,
        email: data.email,
        userType: data.userType,
        name: data.name,
      };
    } catch (error) {
      console.error('Token validation error:', error);
      return { valid: false };
    }
  }

  /**
   * Get passwordChangedAt timestamp for an account
   * Used to verify if password was changed since last login
   */
  async getPasswordChangedAt(userId: string, userType: 'parent' | 'child'): Promise<number | null> {
    if (userType === 'parent') {
      const account = await db.parentAccounts.get(userId);
      return account?.passwordChangedAt || account?.createdAt || null;
    } else {
      const account = await db.childAccounts.get(userId);
      return account?.passwordChangedAt || account?.createdAt || null;
    }
  }

  /**
   * Request password reset - generates token and sends email
   */
  async requestPasswordReset(email: string, accountType: 'parent' | 'child'): Promise<void> {
    // Check if account exists locally (but don't block if it doesn't - could be on different device)
    let account: ParentAccount | ChildAccount | undefined;
    if (accountType === 'parent') {
      account = await db.parentAccounts.where('email').equals(email).first();
    } else {
      account = await db.childAccounts.where('email').equals(email).first();
      if (account && !account.isActive) {
        throw new Error('Account is inactive');
      }
    }

    // For cross-device support: Always attempt to send email regardless of local account existence
    // The actual account validation will happen server-side or during password reset
    try {
      await emailService.sendPasswordResetEmail(email, '', accountType);
    } catch (error) {
      throw new Error('Failed to send password reset email. Please try again later.');
    }
  }

  /**
   * Validate reset token via AWS Lambda API
   */
  async validateResetToken(token: string, email: string): Promise<{ valid: boolean; accountType?: 'parent' | 'child' }> {
    // Validate input parameters first
    if (!token || !email || typeof token !== 'string' || typeof email !== 'string') {
      return { valid: false };
    }

    // Trim and validate non-empty values
    const trimmedToken = token.trim();
    const trimmedEmail = email.trim();

    if (!trimmedToken || !trimmedEmail) {
      return { valid: false };
    }

    try {
      const apiUrl = import.meta.env.VITE_EMAIL_API_URL || 'https://nktkmakeil.execute-api.us-west-2.amazonaws.com/v1/api/email/send';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'validate-token',
          token: trimmedToken,
          email: trimmedEmail,
        }),
      });

      if (!response.ok) {
        console.error('Token validation API error:', response.status, response.statusText);
        return { valid: false };
      }

      const result = await response.json();
      return {
        valid: result.valid,
        accountType: result.accountType
      };
    } catch (error) {
      console.error('Error validating reset token:', error);
      return { valid: false };
    }
  }

  /**
   * Reset password using token
   */
  async resetPassword(token: string, email: string, newPassword: string): Promise<void> {
    // Validate token
    const validation = await this.validateResetToken(token, email);
    if (!validation.valid || !validation.accountType) {
      throw new Error('Invalid or expired reset token');
    }

    const trimmedEmail = email.trim();
    const now = Date.now();

    // Hash new password
    const passwordHash = await this.hashPassword(newPassword);

    if (validation.accountType === 'parent') {
      let account = await db.parentAccounts.where('email').equals(trimmedEmail).first();

      if (!account) {
        // Cross-device scenario: Create a new local account with the reset password
        // This allows the user to access the app from this device with the new password
        const newAccount: ParentAccount = {
          id: uuidv4(),
          email: trimmedEmail,
          passwordHash,
          name: trimmedEmail.split('@')[0],
          currency: 'CAD',
          accountingPeriodType: 'monthly',
          accountingPeriodStartDay: 1,
          theme: 'system',
          createdAt: now,
          updatedAt: now,
          passwordChangedAt: now, // Track password change for session invalidation
        };
        await db.parentAccounts.add(newAccount);
      } else {
        // Same device: Update existing account and update passwordChangedAt
        // This will invalidate all other sessions on other devices
        await db.parentAccounts.update(account.id, {
          passwordHash,
          passwordChangedAt: now, // Critical: Update timestamp to invalidate other sessions
          updatedAt: now,
        });
      }
    } else {
      let account = await db.childAccounts.where('email').equals(trimmedEmail).first();

      if (!account) {
        // Cross-device scenario: Create a new local account
        const newAccount: ChildAccount = {
          id: uuidv4(),
          parentAccountId: 'cross-device', // Special marker for cross-device accounts
          email: trimmedEmail,
          passwordHash,
          name: trimmedEmail.split('@')[0],
          currentBalance: 0,
          defaultMonthlyAllowance: 100,
          isActive: true,
          theme: 'system',
          createdAt: now,
          updatedAt: now,
          passwordChangedAt: now, // Track password change for session invalidation
        };
        await db.childAccounts.add(newAccount);
      } else {
        if (!account.isActive) {
          throw new Error('Account is inactive');
        }
        // Update password and passwordChangedAt to invalidate other sessions
        await db.childAccounts.update(account.id, {
          passwordHash,
          passwordChangedAt: now, // Critical: Update timestamp to invalidate other sessions
          updatedAt: now,
        });
      }
    }

    // Note: JWT tokens are stateless and automatically expire - no need to mark as used
  }

  /**
   * Clean up expired tokens (called periodically)
   */
  private async cleanupExpiredTokens(): Promise<void> {
    const now = Date.now();
    const expiredTokens = await db.passwordResetTokens
      .where('expiresAt')
      .below(now)
      .toArray();

    if (expiredTokens.length > 0) {
      await db.passwordResetTokens.bulkDelete(expiredTokens.map(t => t.id));
    }
  }
}

export const authService = new AuthService();

