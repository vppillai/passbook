import { jsPDF } from 'jspdf';
import type { Expense, FundAddition } from '../../types/models';
import { formatDateForDisplay } from '../../utils/date';

export interface PDFExportData {
  expenses: Expense[];
  fundAdditions: FundAddition[];
  childName: string;
  periodLabel?: string;
}

export class PDFService {
  exportToPDF(data: PDFExportData): void {
    const doc = new jsPDF();
    let yPos = 20;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 20;
    const lineHeight = 7;

    // Helper to check if we need a new page
    const checkPageBreak = (requiredSpace: number) => {
      if (yPos + requiredSpace > pageHeight - margin) {
        doc.addPage();
        yPos = 20;
      }
    };

    // Title
    doc.setFontSize(18);
    doc.text('Expense Report', margin, yPos);
    yPos += 10;

    doc.setFontSize(12);
    doc.text(`Child: ${data.childName}`, margin, yPos);
    yPos += 7;
    doc.text(`Period: ${data.periodLabel || 'All Time'}`, margin, yPos);
    yPos += 10;

    // Summary
    const totalExpenses = data.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const totalFunds = data.fundAdditions.reduce((sum, fund) => sum + fund.amount, 0);
    const balance = totalFunds - totalExpenses;

    doc.setFontSize(14);
    doc.text('Summary', margin, yPos);
    yPos += 8;

    doc.setFontSize(10);
    doc.text(`Total Expenses: $${totalExpenses.toFixed(2)}`, margin, yPos);
    yPos += lineHeight;
    doc.text(`Total Funds Added: $${totalFunds.toFixed(2)}`, margin, yPos);
    yPos += lineHeight;
    doc.text(`Net Balance: $${balance.toFixed(2)}`, margin, yPos);
    yPos += 12;

    // Expenses
    if (data.expenses.length > 0) {
      checkPageBreak(15);
      doc.setFontSize(14);
      doc.text('Expenses', margin, yPos);
      yPos += 8;

      doc.setFontSize(9);
      data.expenses.forEach((expense) => {
        checkPageBreak(lineHeight + 2);
        const date = formatDateForDisplay(expense.date);
        const description = expense.description.length > 40
          ? expense.description.substring(0, 40) + '...'
          : expense.description;
        doc.text(`${date} - ${expense.category} - $${expense.amount.toFixed(2)}`, margin, yPos);
        yPos += lineHeight;
        doc.text(`  ${description}`, margin + 5, yPos);
        yPos += lineHeight;
      });
      yPos += 5;
    }

    // Fund Additions
    if (data.fundAdditions.length > 0) {
      checkPageBreak(15);
      doc.setFontSize(14);
      doc.text('Fund Additions', margin, yPos);
      yPos += 8;

      doc.setFontSize(9);
      data.fundAdditions.forEach((fund) => {
        checkPageBreak(lineHeight + 2);
        const date = formatDateForDisplay(fund.date);
        const reason = fund.reason.length > 50 ? fund.reason.substring(0, 50) + '...' : fund.reason;
        doc.text(`${date} - $${fund.amount.toFixed(2)}`, margin, yPos);
        yPos += lineHeight;
        doc.text(`  ${reason}`, margin + 5, yPos);
        yPos += lineHeight;
      });
    }

    // Save
    const filename = `${data.childName.replace(/\s+/g, '_')}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
  }
}

export const pdfService = new PDFService();

