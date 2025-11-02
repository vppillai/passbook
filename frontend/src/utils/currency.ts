// Currency formatting utilities

const CURRENCY_SYMBOLS: Record<string, string> = {
  CAD: 'C$',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  JPY: '¥',
};

export const formatCurrency = (amount: number, currency: string = 'CAD'): string => {
  const symbol = CURRENCY_SYMBOLS[currency] || currency;
  return `${symbol}${Math.abs(amount).toFixed(2)}`;
};

export const formatCurrencyWithSign = (amount: number, currency: string = 'CAD'): string => {
  const formatted = formatCurrency(amount, currency);
  return amount < 0 ? `-${formatted}` : formatted;
};

