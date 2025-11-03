import { db } from '../storage/db';
import type { ParentAccount } from '../../types/models';
import { validateEmail, validatePassword } from '../../utils/validation';
import { hashPassword } from '../../utils/crypto';
import { v4 as uuidv4 } from 'uuid';
import { periodService } from '../periods/period.service';

export interface CreateChildAccountData {
  name: string;
  email: string;
  password: string;
  defaultMonthlyAllowance?: number;
}

export class ParentAccountService {
  async createChildAccount(
    parentAccountId: string,
    data: CreateChildAccountData
  ) {
    if (!validateEmail(data.email)) {
      throw new Error('Invalid email address');
    }

    const passwordValidation = validatePassword(data.password);
    if (!passwordValidation.valid) {
      throw new Error(passwordValidation.message || 'Invalid password');
    }

    // Check if email already exists
    const existingParent = await db.parentAccounts.where('email').equals(data.email).first();
    const existingChild = await db.childAccounts.where('email').equals(data.email).first();
    
    if (existingParent || existingChild) {
      throw new Error('Email already registered');
    }

    const parent = await db.parentAccounts.get(parentAccountId);
    if (!parent) {
      throw new Error('Parent account not found');
    }

    const passwordHash = await hashPassword(data.password);
    const now = Date.now();

    const childAccount = {
      id: uuidv4(),
      parentAccountId,
      email: data.email,
      passwordHash,
      name: data.name,
      currentBalance: 0,
      defaultMonthlyAllowance: data.defaultMonthlyAllowance || 100.00,
      isActive: true,
      theme: 'system' as const,
      createdAt: now,
      updatedAt: now
    };

    await db.childAccounts.add(childAccount);

    // Create initial accounting period and add default allowance
    const activePeriod = await periodService.getActivePeriod(parentAccountId);
    if (!activePeriod) {
      await periodService.createDefaultPeriod(parentAccountId);
      const newPeriod = await periodService.getActivePeriod(parentAccountId);
      if (newPeriod && childAccount.defaultMonthlyAllowance > 0) {
        await this.addFunds(
          parentAccountId,
          childAccount.id,
          childAccount.defaultMonthlyAllowance,
          'Initial monthly allowance'
        );
      }
    } else {
      // Add allowance to existing period
      if (childAccount.defaultMonthlyAllowance > 0) {
        await this.addFunds(
          parentAccountId,
          childAccount.id,
          childAccount.defaultMonthlyAllowance,
          'Monthly allowance'
        );
      }
    }

    return childAccount;
  }

  async getChildren(parentAccountId: string) {
    return db.childAccounts
      .where('parentAccountId')
      .equals(parentAccountId)
      .toArray();
  }

  async addFunds(
    parentAccountId: string,
    childAccountId: string,
    amount: number,
    reason: string
  ) {
    if (amount <= 0) {
      throw new Error('Amount must be greater than zero');
    }

    const child = await db.childAccounts.get(childAccountId);
    if (!child || child.parentAccountId !== parentAccountId) {
      throw new Error('Child account not found or access denied');
    }

    const activePeriod = await periodService.getActivePeriod(parentAccountId);
    if (!activePeriod) {
      throw new Error('No active accounting period');
    }

    // Update child balance
    const newBalance = child.currentBalance + amount;
    await db.childAccounts.update(childAccountId, {
      currentBalance: newBalance,
      updatedAt: Date.now()
    });

    // Record fund addition
    const fundAddition = {
      id: uuidv4(),
      childAccountId,
      amount,
      reason: reason.substring(0, 200),
      date: new Date().toISOString().split('T')[0], // ISO date string
      accountingPeriodId: activePeriod.id,
      addedBy: parentAccountId,
      createdAt: Date.now()
    };

    await db.fundAdditions.add(fundAddition);

    return { newBalance, fundAddition };
  }

  async updateParentAccount(id: string, updates: Partial<ParentAccount>) {
    await db.parentAccounts.update(id, {
      ...updates,
      updatedAt: Date.now()
    });
    return db.parentAccounts.get(id);
  }
}

export const parentAccountService = new ParentAccountService();

