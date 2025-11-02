interface CurrencySelectorProps {
  value: string;
  onChange: (currency: string) => void;
}

const CURRENCIES = [
  { code: 'CAD', name: 'Canadian Dollar (CAD)' },
  { code: 'USD', name: 'US Dollar (USD)' },
  { code: 'EUR', name: 'Euro (EUR)' },
  { code: 'GBP', name: 'British Pound (GBP)' },
  { code: 'AUD', name: 'Australian Dollar (AUD)' },
  { code: 'JPY', name: 'Japanese Yen (JPY)' },
  { code: 'CHF', name: 'Swiss Franc (CHF)' },
  { code: 'CNY', name: 'Chinese Yuan (CNY)' },
  { code: 'INR', name: 'Indian Rupee (INR)' },
];

export const CurrencySelector = ({ value, onChange }: CurrencySelectorProps) => {
  return (
    <div className="w-full">
      <label className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">
        Currency
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      >
        {CURRENCIES.map((currency) => (
          <option key={currency.code} value={currency.code}>
            {currency.name}
          </option>
        ))}
      </select>
    </div>
  );
};

