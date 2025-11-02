import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../storage/db';
import type { ParentAccount, ChildAccount, LoginCredentials, SignupData, AuthUser } from '../../types/models';

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
}

export const authService = new AuthService();

