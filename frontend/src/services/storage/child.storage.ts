import { db } from './db';
import type { ChildAccount } from '../../types/models';

export const childStorage = {
  async getById(id: string): Promise<ChildAccount | undefined> {
    return db.childAccounts.get(id);
  },

  async getByEmail(email: string): Promise<ChildAccount | undefined> {
    return db.childAccounts.where('email').equals(email).first();
  },

  async getByParentId(parentAccountId: string): Promise<ChildAccount[]> {
    return db.childAccounts.where('parentAccountId').equals(parentAccountId).toArray();
  },

  async create(childAccount: ChildAccount): Promise<string> {
    return db.childAccounts.add(childAccount);
  },

  async update(id: string, updates: Partial<ChildAccount>): Promise<number> {
    return db.childAccounts.update(id, { ...updates, updatedAt: Date.now() });
  },

  async delete(id: string): Promise<void> {
    return db.childAccounts.delete(id);
  },
};

