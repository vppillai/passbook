import * as XLSX from 'xlsx';
import type { Expense, FundAddition } from '../../types/models';
import { formatDateForDisplay } from '../../utils/date';

export interface ExportData {
  expenses: Expense[];
  fundAdditions: FundAddition[];
  childName: string;
  periodLabel?: string;
}

export class ExcelService {
  exportToExcel(data: ExportData): void {
    const workbook = XLSX.utils.book_new();

    // Prepare expense data
    const expenseRows = data.expenses.map((expense) => ({
      Date: formatDateForDisplay(expense.date),
      Category: expense.category,
      Description: expense.description,
      Amount: expense.amount,
      'Created By': expense.createdBy,
    }));

    if (expenseRows.length > 0) {
      const expenseSheet = XLSX.utils.json_to_sheet(expenseRows);
      XLSX.utils.book_append_sheet(workbook, expenseSheet, 'Expenses');
    }

    // Prepare fund addition data
    const fundRows = data.fundAdditions.map((fund) => ({
      Date: formatDateForDisplay(fund.date),
      Amount: fund.amount,
      Reason: fund.reason,
    }));

    if (fundRows.length > 0) {
      const fundSheet = XLSX.utils.json_to_sheet(fundRows);
      XLSX.utils.book_append_sheet(workbook, fundSheet, 'Fund Additions');
    }

    // Create summary sheet
    const totalExpenses = data.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const totalFunds = data.fundAdditions.reduce((sum, fund) => sum + fund.amount, 0);
    const balance = totalFunds - totalExpenses;

    const summaryData = [
      { Label: 'Child Name', Value: data.childName },
      { Label: 'Period', Value: data.periodLabel || 'All Time' },
      { Label: 'Total Expenses', Value: totalExpenses },
      { Label: 'Total Funds Added', Value: totalFunds },
      { Label: 'Net Balance', Value: balance },
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Generate filename
    const filename = `${data.childName.replace(/\s+/g, '_')}_Report_${new Date().toISOString().split('T')[0]}.xlsx`;

    // Write and download
    XLSX.writeFile(workbook, filename);
  }
}

export const excelService = new ExcelService();

