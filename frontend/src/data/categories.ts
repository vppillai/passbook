import type { Category } from '../types/models';

export const PREDEFINED_CATEGORIES: Category[] = [
  { id: 'snacks', name: 'Snacks', icon: '🍿', colorHex: '#FFA500', sortOrder: 1 },
  { id: 'toys', name: 'Toys', icon: '🧸', colorHex: '#FF69B4', sortOrder: 2 },
  { id: 'crafts', name: 'Crafts', icon: '🎨', colorHex: '#9370DB', sortOrder: 3 },
  { id: 'games', name: 'Games', icon: '🎮', colorHex: '#00CED1', sortOrder: 4 },
  { id: 'books', name: 'Books', icon: '📚', colorHex: '#228B22', sortOrder: 5 },
  { id: 'clothes', name: 'Clothes', icon: '👕', colorHex: '#DC143C', sortOrder: 6 },
  { id: 'entertainment', name: 'Entertainment', icon: '🎬', colorHex: '#FF4500', sortOrder: 7 },
  { id: 'sports', name: 'Sports', icon: '⚽', colorHex: '#1E90FF', sortOrder: 8 },
  { id: 'school', name: 'School', icon: '🎒', colorHex: '#FFD700', sortOrder: 9 },
  { id: 'other', name: 'Other', icon: '📦', colorHex: '#808080', sortOrder: 10 },
];

export const getCategoryById = (id: string): Category | undefined => {
  return PREDEFINED_CATEGORIES.find((cat) => cat.id === id);
};

export const getCategoryByName = (name: string): Category | undefined => {
  return PREDEFINED_CATEGORIES.find((cat) => cat.name.toLowerCase() === name.toLowerCase());
};

