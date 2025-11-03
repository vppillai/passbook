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
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.childAccounts.add(childAccount);
    return childAccount;
  }

  async loginParent(credentials: LoginCredentials): Promise<AuthUser> {
    const parentAccount = await db.parentAccounts.where('email').equals(credentials.email).first();
    if (!parentAccount) {
      throw new Error('Invalid email or password');
    }

    const isValid = await this.verifyPassword(credentials.password, parentAccount.passwordHash);
    if (!isValid) {
      throw new Error('Invalid email or password');
    }

    return {
      id: parentAccount.id,
      email: parentAccount.email,
      name: parentAccount.name,
      type: 'parent',
    };
  }

  async loginChild(credentials: LoginCredentials): Promise<AuthUser> {
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
      id: childAccount.id,
      email: childAccount.email,
      name: childAccount.name,
      type: 'child',
      parentAccountId: childAccount.parentAccountId,
    };
  }

  async getParentAccountById(id: string): Promise<ParentAccount | undefined> {
    return db.parentAccounts.get(id);
  }

  async getChildAccountById(id: string): Promise<ChildAccount | undefined> {
    return db.childAccounts.get(id);
  }

  /**
   * Request password reset - generates token and sends email
   */
  async requestPasswordReset(email: string, accountType: 'parent' | 'child'): Promise<void> {
    // Check if account exists
    let account: ParentAccount | ChildAccount | undefined;
    if (accountType === 'parent') {
      account = await db.parentAccounts.where('email').equals(email).first();
    } else {
      account = await db.childAccounts.where('email').equals(email).first();
      if (account && !account.isActive) {
        throw new Error('Account is inactive');
      }
    }

    // Don't reveal if email exists (security best practice)
    if (!account) {
      // Still return success to prevent email enumeration
      return;
    }

    // Send request to AWS Lambda - let it generate and manage the token
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
      const apiUrl = import.meta.env.VITE_EMAIL_API_URL || '/api/email/send';

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

    // Hash new password
    const passwordHash = await this.hashPassword(newPassword);

    // Update account password
    if (validation.accountType === 'parent') {
      const account = await db.parentAccounts.where('email').equals(trimmedEmail).first();
      if (!account) {
        throw new Error('Parent account not found');
      }
      await db.parentAccounts.update(account.id, {
        passwordHash,
        updatedAt: Date.now(),
      });
    } else {
      const account = await db.childAccounts.where('email').equals(trimmedEmail).first();
      if (!account) {
        throw new Error('Child account not found');
      }
      if (!account.isActive) {
        throw new Error('Account is inactive');
      }
      await db.childAccounts.update(account.id, {
        passwordHash,
        updatedAt: Date.now(),
      });
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

