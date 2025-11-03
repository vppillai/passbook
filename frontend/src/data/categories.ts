import type { Category } from '../types/models';

export const PREDEFINED_CATEGORIES: Category[] = [
  { id: 'snacks', name: 'Snacks', icon: 'snacks', colorHex: '#F59E0B', sortOrder: 1 },
  { id: 'toys', name: 'Toys', icon: 'toys', colorHex: '#EC4899', sortOrder: 2 },
  { id: 'crafts', name: 'Crafts', icon: 'crafts', colorHex: '#8B5CF6', sortOrder: 3 },
  { id: 'games', name: 'Games', icon: 'games', colorHex: '#06B6D4', sortOrder: 4 },
  { id: 'books', name: 'Books', icon: 'books', colorHex: '#10B981', sortOrder: 5 },
  { id: 'clothes', name: 'Clothes', icon: 'clothes', colorHex: '#EF4444', sortOrder: 6 },
  { id: 'entertainment', name: 'Entertainment', icon: 'entertainment', colorHex: '#F97316', sortOrder: 7 },
  { id: 'sports', name: 'Sports', icon: 'sports', colorHex: '#3B82F6', sortOrder: 8 },
  { id: 'school', name: 'School', icon: 'school', colorHex: '#EAB308', sortOrder: 9 },
  { id: 'other', name: 'Other', icon: 'other', colorHex: '#6B7280', sortOrder: 10 },
];

export const getCategoryById = (id: string): Category | undefined => {
  return PREDEFINED_CATEGORIES.find((cat) => cat.id === id);
};

export const getCategoryByName = (name: string): Category | undefined => {
  return PREDEFINED_CATEGORIES.find((cat) => cat.name.toLowerCase() === name.toLowerCase());
};

