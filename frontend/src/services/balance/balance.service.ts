import { childStorage } from '../storage/child.storage';
import { expenseStorage } from '../storage/expense.storage';
import { fundStorage } from '../storage/fund.storage';

class BalanceService {
  async calculateCurrentBalance(childAccountId: string): Promise<number> {
    const child = await childStorage.getById(childAccountId);
    if (!child) {
      throw new Error('Child account not found');
    }

    // Get active period expenses and funds
    const parent = await import('../storage/db').then(m => 
      m.db.parentAccounts.get(child.parentAccountId)
    );
    if (!parent) {
      return child.currentBalance;
    }

    const periodService = await import('../periods/period.service');
    const activePeriod = await periodService.periodService.getActivePeriod(parent.id);
    
    if (!activePeriod) {
      return child.currentBalance;
    }

    const expenses = await expenseStorage.getByChildAndPeriod(childAccountId, activePeriod.id);
    const funds = await fundStorage.getByChildAndPeriod(childAccountId, activePeriod.id);

    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const totalFunds = funds.reduce((sum, fund) => sum + fund.amount, 0);

    // Starting balance is the default allowance
    const startingBalance = child.defaultMonthlyAllowance;
    return startingBalance + totalFunds - totalExpenses;
  }

  async updateBalance(childAccountId: string, newBalance: number): Promise<void> {
    await childStorage.update(childAccountId, { currentBalance: newBalance });
  }

  async addExpenseToBalance(childAccountId: string, amount: number): Promise<void> {
    const child = await childStorage.getById(childAccountId);
    if (!child) {
      throw new Error('Child account not found');
    }

    const newBalance = child.currentBalance - amount;
    await this.updateBalance(childAccountId, newBalance);
  }

  async addFundToBalance(childAccountId: string, amount: number): Promise<void> {
    const child = await childStorage.getById(childAccountId);
    if (!child) {
      throw new Error('Child account not found');
    }

    const newBalance = child.currentBalance + amount;
    await this.updateBalance(childAccountId, newBalance);
  }

  async adjustBalanceForEdit(
    childAccountId: string,
    oldAmount: number,
    newAmount: number
  ): Promise<void> {
    const child = await childStorage.getById(childAccountId);
    if (!child) {
      throw new Error('Child account not found');
    }

    const difference = newAmount - oldAmount;
    const newBalance = child.currentBalance - difference;
    await this.updateBalance(childAccountId, newBalance);
  }

  async getBalanceInfo(
    childAccountId: string,
    accountingPeriodId: string
  ): Promise<{
    openingBalance: number;
    totalFunds: number;
    totalExpenses: number;
    currentBalance: number;
  }> {
    const child = await childStorage.getById(childAccountId);
    if (!child) {
      throw new Error('Child account not found');
    }

    const expenses = await expenseStorage.getByChildAndPeriod(childAccountId, accountingPeriodId);
    const funds = await fundStorage.getByChildAndPeriod(childAccountId, accountingPeriodId);

    const openingBalance = child.defaultMonthlyAllowance;
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const totalFunds = funds.reduce((sum, fund) => sum + fund.amount, 0);
    const currentBalance = openingBalance + totalFunds - totalExpenses;

    return {
      openingBalance,
      totalFunds,
      totalExpenses,
      currentBalance,
    };
  }
}

export const balanceService = new BalanceService();

