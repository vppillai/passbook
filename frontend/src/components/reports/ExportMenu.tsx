import { useState } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { DateRangePicker } from './DateRangePicker';
import { excelService } from '../../services/export/excel.service';
import { pdfService } from '../../services/export/pdf.service';
import type { Expense, FundAddition } from '../../types/models';
import { getCurrentDate } from '../../utils/date';

interface ExportMenuProps {
  isOpen: boolean;
  onClose: () => void;
  childName: string;
  expenses: Expense[];
  fundAdditions: FundAddition[];
  periodLabel?: string;
}

export const ExportMenu = ({
  isOpen,
  onClose,
  childName,
  expenses,
  fundAdditions,
  periodLabel,
}: ExportMenuProps) => {
  const [dateRange, setDateRange] = useState({
    startDate: '',
    endDate: getCurrentDate(),
  });
  const [exportType, setExportType] = useState<'current' | 'range'>('current');
  const [loading, setLoading] = useState(false);

  const handleExport = async (format: 'excel' | 'pdf') => {
    setLoading(true);

    try {
      let exportExpenses = expenses;
      let exportFunds = fundAdditions;
      let exportPeriodLabel = periodLabel;

      if (exportType === 'range') {
        const start = new Date(dateRange.startDate);
        const end = new Date(dateRange.endDate);
        end.setHours(23, 59, 59, 999);

        exportExpenses = expenses.filter((exp) => {
          const expDate = new Date(exp.date);
          return expDate >= start && expDate <= end;
        });

        exportFunds = fundAdditions.filter((fund) => {
          const fundDate = new Date(fund.date);
          return fundDate >= start && fundDate <= end;
        });

        exportPeriodLabel = `${dateRange.startDate} to ${dateRange.endDate}`;
      }

      if (format === 'excel') {
        excelService.exportToExcel({
          expenses: exportExpenses,
          fundAdditions: exportFunds,
          childName,
          periodLabel: exportPeriodLabel,
        });
      } else {
        pdfService.exportToPDF({
          expenses: exportExpenses,
          fundAdditions: exportFunds,
          childName,
          periodLabel: exportPeriodLabel,
        });
      }

      onClose();
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Export Report" size="md">
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
            Export Period
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name="exportType"
                value="current"
                checked={exportType === 'current'}
                onChange={() => setExportType('current')}
                className="mr-2"
              />
              <span className="text-gray-900 dark:text-gray-100">Current Period</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="exportType"
                value="range"
                checked={exportType === 'range'}
                onChange={() => setExportType('range')}
                className="mr-2"
              />
              <span className="text-gray-900 dark:text-gray-100">Custom Date Range</span>
            </label>
          </div>
        </div>

        {exportType === 'range' && (
          <DateRangePicker
            startDate={dateRange.startDate}
            endDate={dateRange.endDate}
            onStartDateChange={(date) => setDateRange({ ...dateRange, startDate: date })}
            onEndDateChange={(date) => setDateRange({ ...dateRange, endDate: date })}
          />
        )}

        <div className="flex space-x-3">
          <Button
            variant="outline"
            onClick={() => handleExport('excel')}
            disabled={loading}
            className="flex-1"
          >
            {loading ? 'Exporting...' : '📊 Export Excel'}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleExport('pdf')}
            disabled={loading}
            className="flex-1"
          >
            {loading ? 'Exporting...' : '📄 Export PDF'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

