import { useState, useEffect } from 'react';
import { periodService } from '../../services/periods/period.service';
import type { AccountingPeriod } from '../../types/models';
import { formatDateForDisplay } from '../../utils/date';

interface PeriodSelectorProps {
  parentAccountId: string;
  selectedPeriodId: string | null;
  onSelect: (periodId: string | null) => void;
}

export const PeriodSelector = ({ parentAccountId, selectedPeriodId, onSelect }: PeriodSelectorProps) => {
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    loadPeriods();
  }, [parentAccountId]);

  // Update calendar month when selected period changes
  useEffect(() => {
    if (selectedPeriodId) {
      const period = periods.find(p => p.id === selectedPeriodId);
      if (period) {
        const periodDate = new Date(period.startDate);
        // Only update if we're not already showing this month
        if (periodDate.getMonth() !== currentMonth.getMonth() || 
            periodDate.getFullYear() !== currentMonth.getFullYear()) {
          setCurrentMonth(periodDate);
        }
      }
    }
  }, [selectedPeriodId, periods]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPeriods = async () => {
    try {
      const allPeriods = await periodService.getAllPeriods(parentAccountId);
      // Sort by start date descending (most recent first)
      allPeriods.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());
      setPeriods(allPeriods);
      
      // Auto-select most recent period if none selected
      if (!selectedPeriodId && allPeriods.length > 0) {
        onSelect(allPeriods[0].id);
        // Set calendar to show the most recent period's month
        setCurrentMonth(new Date(allPeriods[0].startDate));
      } else if (selectedPeriodId) {
        // If a period is already selected, navigate to its month
        const period = allPeriods.find(p => p.id === selectedPeriodId);
        if (period) {
          setCurrentMonth(new Date(period.startDate));
        }
      }
    } catch (error) {
      console.error('Failed to load periods:', error);
    } finally {
      setLoading(false);
    }
  };

  // Normalize date to YYYY-MM-DD string for comparison
  const normalizeDate = (date: Date | string): string => {
    const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  // Get period for a given date
  const getPeriodForDate = (date: Date): AccountingPeriod | null => {
    const dateStr = normalizeDate(date);
    return periods.find(p => {
      const startStr = normalizeDate(p.startDate);
      const endStr = normalizeDate(p.endDate);
      return dateStr >= startStr && dateStr <= endStr;
    }) || null;
  };

  // Check if a date is in the selected period
  const isInSelectedPeriod = (date: Date): boolean => {
    if (!selectedPeriodId) return false;
    const period = periods.find(p => p.id === selectedPeriodId);
    if (!period) return false;
    const dateStr = normalizeDate(date);
    const startStr = normalizeDate(period.startDate);
    const endStr = normalizeDate(period.endDate);
    return dateStr >= startStr && dateStr <= endStr;
  };

  // Generate calendar days
  const getCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay()); // Start from Sunday
    
    const days = [];
    const currentDate = new Date(startDate);
    
    // Generate 6 weeks of days (42 days)
    for (let i = 0; i < 42; i++) {
      const date = new Date(currentDate);
      const period = getPeriodForDate(date);
      days.push({
        date,
        isCurrentMonth: date.getMonth() === month,
        period,
        isSelected: isInSelectedPeriod(date),
      });
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return days;
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentMonth(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(newDate.getMonth() - 1);
      } else {
        newDate.setMonth(newDate.getMonth() + 1);
      }
      return newDate;
    });
  };

  const handleDateClick = (period: AccountingPeriod | null) => {
    if (period) {
      onSelect(period.id);
    }
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (loading) {
    return <div className="text-sm text-gray-600 dark:text-gray-400">Loading periods...</div>;
  }

  const calendarDays = getCalendarDays();
  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  return (
    <div>
      <label className="block text-sm font-medium mb-4 text-gray-700 dark:text-gray-300">
        Select Period
      </label>
      
      {/* Calendar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
        {/* Month Navigation */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigateMonth('prev')}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Previous month"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
          </h3>
          <button
            onClick={() => navigateMonth('next')}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            aria-label="Next month"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Day Headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {dayNames.map(day => (
            <div key={day} className="text-center text-xs font-medium text-gray-500 dark:text-gray-400 py-2">
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Grid */}
        <div className="grid grid-cols-7 gap-1">
          {calendarDays.map((day, index) => {
            const today = new Date();
            const todayStr = normalizeDate(today);
            const dateStr = normalizeDate(day.date);
            const isToday = dateStr === todayStr;
            
            // Only highlight if this date is specifically in the selected period
            const isPartOfSelectedPeriod = day.isSelected;
            
            return (
              <button
                key={index}
                onClick={() => handleDateClick(day.period)}
                disabled={!day.period}
                className={`
                  aspect-square p-1 text-sm rounded-lg transition-all
                  ${!day.isCurrentMonth 
                    ? 'text-gray-300 dark:text-gray-600' 
                    : 'text-gray-700 dark:text-gray-300'
                  }
                  ${day.period 
                    ? 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer' 
                    : 'cursor-not-allowed opacity-50'
                  }
                  ${isPartOfSelectedPeriod 
                    ? 'bg-primary-100 dark:bg-primary-900 border-2 border-primary-500 font-semibold' 
                    : day.period 
                      ? 'border border-gray-200 dark:border-gray-700' 
                      : ''
                  }
                  ${isToday && day.isCurrentMonth ? 'ring-2 ring-blue-400' : ''}
                `}
                title={day.period ? `${formatDateForDisplay(day.period.startDate)} - ${formatDateForDisplay(day.period.endDate)}` : ''}
              >
                <div className="flex flex-col items-center">
                  <span>{day.date.getDate()}</span>
                  {day.period && (
                    <span className={`text-xs ${day.period.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-gray-400'}`}>
                      •
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Period Info */}
      {selectedPeriod && (
        <div className="mt-4 p-3 bg-primary-50 dark:bg-primary-900/30 rounded-lg border border-primary-200 dark:border-primary-800">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
            Selected Period
          </div>
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {formatDateForDisplay(selectedPeriod.startDate)} - {formatDateForDisplay(selectedPeriod.endDate)}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Status: <span className={`font-medium ${selectedPeriod.status === 'active' ? 'text-green-600 dark:text-green-400' : 'text-gray-600 dark:text-gray-400'}`}>
              {selectedPeriod.status}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

