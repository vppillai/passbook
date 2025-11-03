import { jsPDF } from 'jspdf';
import type { Expense, FundAddition } from '../../types/models';
import { formatDateForDisplay } from '../../utils/date';
import { CURRENCY_SYMBOLS } from '../../utils/currency';

export interface PDFExportData {
  expenses: Expense[];
  fundAdditions: FundAddition[];
  childName: string;
  periodLabel?: string;
  currency?: string;
}

interface TableColumn {
  header: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  dataKey?: string;
  formatter?: (value: any) => string;
}

export class PDFService {
  private margin = 20;
  private pageWidth = 210; // A4 width in mm
  private pageHeight = 297; // A4 height in mm
  private rowHeight = 7;
  private headerHeight = 8;

  // Helper to draw a table
  private drawTable(
    doc: jsPDF,
    startY: number,
    columns: TableColumn[],
    data: any[],
    title?: string
  ): number {
    let yPos = startY;
    const tableWidth = this.pageWidth - 2 * this.margin;
    const cellPadding = 3;

    // Draw title if provided
    if (title) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.text(title, this.margin, yPos);
      yPos += this.headerHeight + 2;
    }

    // Calculate column positions
    let xPos = this.margin;
    const columnPositions: number[] = [xPos];
    columns.forEach((col, index) => {
      if (index > 0) {
        xPos += columns[index - 1].width;
        columnPositions.push(xPos);
      }
    });

    // Draw header
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setFillColor(240, 240, 240);
    doc.rect(this.margin, yPos, tableWidth, this.headerHeight, 'F');
    
    columns.forEach((col, index) => {
      const align = col.align || 'left';
      const textAlign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
      const textX = align === 'right' 
        ? columnPositions[index] + col.width - cellPadding
        : align === 'center'
        ? columnPositions[index] + col.width / 2
        : columnPositions[index] + cellPadding;
      
      doc.text(col.header, textX, yPos + this.headerHeight - 2, { align: textAlign });
    });

    // Draw header border
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(this.margin, yPos, this.margin + tableWidth, yPos);
    doc.line(this.margin, yPos + this.headerHeight, this.margin + tableWidth, yPos + this.headerHeight);
    
    yPos += this.headerHeight;

    // Draw rows
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    
    data.forEach((row, rowIndex) => {
      // Check if we need a new page
      if (yPos + this.rowHeight > this.pageHeight - this.margin) {
        doc.addPage();
        yPos = this.margin;
        
        // Redraw header on new page
        doc.setFont('helvetica', 'bold');
        doc.setFillColor(240, 240, 240);
        doc.rect(this.margin, yPos, tableWidth, this.headerHeight, 'F');
        columns.forEach((col, index) => {
          const align = col.align || 'left';
          const textAlign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
          const textX = align === 'right' 
            ? columnPositions[index] + col.width - cellPadding
            : align === 'center'
            ? columnPositions[index] + col.width / 2
            : columnPositions[index] + cellPadding;
          doc.text(col.header, textX, yPos + this.headerHeight - 2, { align: textAlign });
        });
        doc.setFont('helvetica', 'normal');
        yPos += this.headerHeight;
      }

      // Draw row background (alternating)
      if (rowIndex % 2 === 0) {
        doc.setFillColor(250, 250, 250);
        doc.rect(this.margin, yPos, tableWidth, this.rowHeight, 'F');
      }

      // Draw cell content
      columns.forEach((col, colIndex) => {
        let cellValue = '';
        if (col.dataKey) {
          const rawValue = row[col.dataKey];
          cellValue = col.formatter ? col.formatter(rawValue) : String(rawValue || '');
        } else if (col.formatter) {
          cellValue = col.formatter(row);
        }

        // Truncate if too long
        const maxWidth = col.width - cellPadding * 2;
        if (doc.getTextWidth(cellValue) > maxWidth) {
          let truncated = cellValue;
          while (doc.getTextWidth(truncated + '...') > maxWidth && truncated.length > 0) {
            truncated = truncated.slice(0, -1);
          }
          cellValue = truncated + '...';
        }

        const align = col.align || 'left';
        const textAlign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
        const textX = align === 'right' 
          ? columnPositions[colIndex] + col.width - cellPadding
          : align === 'center'
          ? columnPositions[colIndex] + col.width / 2
          : columnPositions[colIndex] + cellPadding;

        doc.text(cellValue, textX, yPos + this.rowHeight - 2, { align: textAlign });
      });

      // Draw row border
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.line(this.margin, yPos + this.rowHeight, this.margin + tableWidth, yPos + this.rowHeight);

      // Draw column borders
      columns.forEach((col, colIndex) => {
        if (colIndex > 0) {
          doc.line(columnPositions[colIndex], yPos, columnPositions[colIndex], yPos + this.rowHeight);
        }
      });

      yPos += this.rowHeight;
    });

    // Draw outer borders
    doc.setDrawColor(150, 150, 150);
    doc.setLineWidth(0.5);
    doc.rect(this.margin, startY + (title ? this.headerHeight + 2 : 0), tableWidth, yPos - startY - (title ? this.headerHeight + 2 : 0));

    return yPos + 5;
  }

  exportToPDF(data: PDFExportData): void {
    const doc = new jsPDF();
    let yPos = this.margin;
    const currency = data.currency || 'CAD';
    const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

    // Title
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('Expense Report', this.margin, yPos);
    yPos += 10;

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Child: ${data.childName}`, this.margin, yPos);
    yPos += 7;
    doc.text(`Period: ${data.periodLabel || 'All Time'}`, this.margin, yPos);
    yPos += 12;

    // Summary Table
    const totalExpenses = data.expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const totalFunds = data.fundAdditions.reduce((sum, fund) => sum + fund.amount, 0);
    const balance = totalFunds - totalExpenses;

    const summaryColumns: TableColumn[] = [
      { header: 'Item', width: 120 },
      { header: 'Amount', width: 60, align: 'right', formatter: (val) => `${currencySymbol}${val.toFixed(2)}` }
    ];

    const summaryData = [
      { Item: 'Total Expenses', Amount: totalExpenses },
      { Item: 'Total Funds Added', Amount: totalFunds },
      { Item: 'Net Balance', Amount: balance }
    ];

    yPos = this.drawTable(doc, yPos, summaryColumns, summaryData, 'Summary');
    yPos += 10;

    // Expenses Table
    if (data.expenses.length > 0) {
      const expenseColumns: TableColumn[] = [
        { header: 'Date', width: 35, dataKey: 'date', formatter: (val) => formatDateForDisplay(val) },
        { header: 'Category', width: 35, dataKey: 'category' },
        { header: 'Description', width: 75, dataKey: 'description' },
        { header: 'Amount', width: 25, align: 'right', dataKey: 'amount', formatter: (val) => `${currencySymbol}${Number(val).toFixed(2)}` }
      ];

      const expenseData = data.expenses.map(exp => ({
        date: exp.date,
        category: exp.category,
        description: exp.description,
        amount: exp.amount
      }));

      yPos = this.drawTable(doc, yPos, expenseColumns, expenseData, 'Expenses');
      yPos += 10;
    }

    // Fund Additions Table
    if (data.fundAdditions.length > 0) {
      const fundColumns: TableColumn[] = [
        { header: 'Date', width: 35, dataKey: 'date', formatter: (val) => formatDateForDisplay(val) },
        { header: 'Amount', width: 30, align: 'right', dataKey: 'amount', formatter: (val) => `${currencySymbol}${Number(val).toFixed(2)}` },
        { header: 'Reason', width: 105, dataKey: 'reason' }
      ];

      const fundData = data.fundAdditions.map(fund => ({
        date: fund.date,
        amount: fund.amount,
        reason: fund.reason
      }));

      this.drawTable(doc, yPos, fundColumns, fundData, 'Fund Additions');
    }

    // Save
    const filename = `${data.childName.replace(/\s+/g, '_')}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
  }
}

export const pdfService = new PDFService();

