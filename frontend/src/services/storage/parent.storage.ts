import { db } from './db';
import type { ParentAccount } from '../../types/models';

export const parentStorage = {
  async getById(id: string): Promise<ParentAccount | undefined> {
    return db.parentAccounts.get(id);
  },

  async getByEmail(email: string): Promise<ParentAccount | undefined> {
    return db.parentAccounts.where('email').equals(email).first();
  },

  async create(parentAccount: ParentAccount): Promise<string> {
    return db.parentAccounts.add(parentAccount);
  },

  async update(id: string, updates: Partial<ParentAccount>): Promise<number> {
    return db.parentAccounts.update(id, { ...updates, updatedAt: Date.now() });
  },

  async delete(id: string): Promise<void> {
    return db.parentAccounts.delete(id);
  },
};

