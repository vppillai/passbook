import { db } from './db';
import type { FundAddition } from '../../types/models';

export const fundStorage = {
  async getById(id: string): Promise<FundAddition | undefined> {
    return db.fundAdditions.get(id);
  },

  async getByChildId(childAccountId: string): Promise<FundAddition[]> {
    return db.fundAdditions.where('childAccountId').equals(childAccountId).sortBy('date');
  },

  async getByPeriod(accountingPeriodId: string): Promise<FundAddition[]> {
    return db.fundAdditions.where('accountingPeriodId').equals(accountingPeriodId).sortBy('date');
  },

  async getByChildAndPeriod(childAccountId: string, accountingPeriodId: string): Promise<FundAddition[]> {
    return db.fundAdditions
      .where('childAccountId')
      .equals(childAccountId)
      .filter(fund => fund.accountingPeriodId === accountingPeriodId)
      .sortBy('date');
  },

  async create(fundAddition: FundAddition): Promise<string> {
    return db.fundAdditions.add(fundAddition);
  },

  async delete(id: string): Promise<void> {
    return db.fundAdditions.delete(id);
  },
};

