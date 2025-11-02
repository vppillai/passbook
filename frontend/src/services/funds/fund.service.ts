import { v4 as uuidv4 } from 'uuid';
import { db } from '../storage/db';
import type { FundAddition } from '../../types/models';
import { validateAmount, sanitizeDescription } from '../../utils/validation';
import { periodService } from '../periods/period.service';
import { getCurrentDate } from '../../utils/date';

export interface CreateFundAdditionData {
  childAccountId: string;
  amount: number;
  reason: string;
  date?: string;
  addedBy: string; // parent account ID
}

export class FundService {
  async addFunds(data: CreateFundAdditionData): Promise<FundAddition> {
    // Validation
    const amountValidation = validateAmount(data.amount);
    if (!amountValidation.valid) {
      throw new Error(amountValidation.message || 'Invalid amount');
    }

    // Get child account and parent
    const childAccount = await db.childAccounts.get(data.childAccountId);
    if (!childAccount) {
      throw new Error('Child account not found');
    }

    // Get active accounting period
    let activePeriod = await periodService.getActivePeriod(childAccount.parentAccountId);
    if (!activePeriod) {
      activePeriod = await periodService.createDefaultPeriod(childAccount.parentAccountId);
    }

    const fundAddition: FundAddition = {
      id: uuidv4(),
      childAccountId: data.childAccountId,
      amount: data.amount,
      reason: sanitizeDescription(data.reason),
      date: data.date || getCurrentDate(),
      accountingPeriodId: activePeriod.id,
      addedBy: data.addedBy,
      createdAt: Date.now(),
    };

    await db.fundAdditions.add(fundAddition);

    // Update child account balance
    await db.childAccounts.update(data.childAccountId, {
      currentBalance: childAccount.currentBalance + data.amount,
      updatedAt: Date.now(),
    });

    return fundAddition;
  }

  async getFundAdditionsByChild(childAccountId: string): Promise<FundAddition[]> {
    return db.fundAdditions
      .where('childAccountId')
      .equals(childAccountId)
      .sortBy('date');
  }

  async getFundAdditionsByPeriod(accountingPeriodId: string): Promise<FundAddition[]> {
    return db.fundAdditions
      .where('accountingPeriodId')
      .equals(accountingPeriodId)
      .sortBy('date');
  }
}

export const fundService = new FundService();

