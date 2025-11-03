import { v4 as uuidv4 } from 'uuid';
import { db } from '../storage/db';
import type { AccountingPeriod } from '../../types/models';
import { getMonthStart, getMonthEnd, formatDate } from '../../utils/date';

export class PeriodService {
  async getActivePeriod(parentAccountId: string): Promise<AccountingPeriod | null> {
    const period = await db.accountingPeriods
      .where('[parentAccountId+status]')
      .equals([parentAccountId, 'active'])
      .first();
    return period || null;
  }

  async createDefaultPeriod(parentAccountId: string): Promise<AccountingPeriod> {
    // Check if active period already exists
    const existing = await this.getActivePeriod(parentAccountId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const startDate = formatDate(getMonthStart(now));
    const endDate = formatDate(getMonthEnd(now));

    const period: AccountingPeriod = {
      id: uuidv4(),
      parentAccountId,
      startDate,
      endDate,
      status: 'active',
      createdAt: Date.now(),
      closedAt: null,
    };

    await db.accountingPeriods.add(period);
    return period;
  }

  async closePeriod(periodId: string): Promise<void> {
    await db.accountingPeriods.update(periodId, {
      status: 'closed',
      closedAt: Date.now(),
    });
  }

  async startNewPeriod(parentAccountId: string): Promise<AccountingPeriod> {
    // Close current active period
    const activePeriod = await this.getActivePeriod(parentAccountId);
    if (activePeriod) {
      await this.closePeriod(activePeriod.id);
    }

    // Create new period
    return this.createDefaultPeriod(parentAccountId);
  }

  async getAllPeriods(parentAccountId: string): Promise<AccountingPeriod[]> {
    return db.accountingPeriods
      .where('parentAccountId')
      .equals(parentAccountId)
      .sortBy('startDate');
  }

  async createNewPeriod(
    parentAccountId: string,
    startTimestamp: number,
    endTimestamp: number
  ): Promise<AccountingPeriod> {
    // Close current active period
    const activePeriod = await this.getActivePeriod(parentAccountId);
    if (activePeriod) {
      await this.closePeriod(activePeriod.id);
    }

    const period: AccountingPeriod = {
      id: uuidv4(),
      parentAccountId,
      startDate: formatDate(new Date(startTimestamp)),
      endDate: formatDate(new Date(endTimestamp)),
      status: 'active',
      createdAt: Date.now(),
      closedAt: null,
    };

    await db.accountingPeriods.add(period);
    return period;
  }
}

export const periodService = new PeriodService();

