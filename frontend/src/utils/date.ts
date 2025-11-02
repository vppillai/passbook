// Date utility functions

export const formatDate = (date: Date | string): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
};

export const getCurrentDate = (): string => {
  return formatDate(new Date());
};

export const isFutureDate = (date: string): boolean => {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d > today;
};

export const getMonthStart = (date: Date = new Date()): Date => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

export const getMonthEnd = (date: Date = new Date()): Date => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
};

export const formatDateForDisplay = (date: string): string => {
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

export const formatDateForInput = (date: string | Date): string => {
  const d = typeof date === 'string' ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

