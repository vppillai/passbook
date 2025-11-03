import { PREDEFINED_CATEGORIES } from '../../data/categories';
import { CategoryIcon } from '../common/CategoryIcon';

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
            className={`p-4 rounded-xl border-2 transition-all flex flex-col items-center space-y-2 ${
              selectedCategory === category.id
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950 shadow-md'
                : 'border-gray-200 dark:border-gray-700 hover:border-primary-300 hover:shadow-sm bg-white dark:bg-gray-800'
            }`}
            style={{
              borderColor: selectedCategory === category.id ? category.colorHex : undefined,
              backgroundColor: selectedCategory === category.id ? `${category.colorHex}10` : undefined
            }}
          >
            <CategoryIcon
              icon={category.icon}
              className="w-6 h-6"
              color={selectedCategory === category.id ? category.colorHex : undefined}
            />
            <div className="text-xs font-medium text-gray-700 dark:text-gray-300 text-center">{category.name}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

