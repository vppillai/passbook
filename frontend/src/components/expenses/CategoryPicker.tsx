import { PREDEFINED_CATEGORIES } from '../../data/categories';

interface CategoryPickerProps {
  selectedCategory: string;
  onSelect: (categoryId: string) => void;
}

export const CategoryPicker = ({ selectedCategory, onSelect }: CategoryPickerProps) => {
  return (
    <div>
      <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
        Category
      </label>
      <div className="grid grid-cols-3 gap-2">
        {PREDEFINED_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onSelect(category.id)}
            className={`p-3 rounded-lg border-2 transition-all ${
              selectedCategory === category.id
                ? 'border-primary-600 bg-primary-50 dark:bg-primary-900'
                : 'border-gray-300 dark:border-gray-600 hover:border-primary-400'
            }`}
          >
            <div className="text-2xl mb-1">{category.icon}</div>
            <div className="text-xs text-gray-700 dark:text-gray-300">{category.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

