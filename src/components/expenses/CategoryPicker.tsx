/**
 * Category picker component for expense categories
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { ExpenseCategory } from '../../types';

interface CategoryPickerProps {
  selectedCategory: ExpenseCategory | '';
  onSelect: (category: ExpenseCategory) => void;
}

const categories: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: 'snacks', label: 'Snacks', icon: '🍪' },
  { value: 'food', label: 'Food', icon: '🍔' },
  { value: 'games', label: 'Games', icon: '🎮' },
  { value: 'sports', label: 'Sports', icon: '⚽' },
  { value: 'school', label: 'School', icon: '📚' },
  { value: 'crafts', label: 'Crafts', icon: '✂️' },
  { value: 'toys', label: 'Toys', icon: '🧸' },
  { value: 'books', label: 'Books', icon: '📖' },
  { value: 'clothes', label: 'Clothes', icon: '👕' },
  { value: 'entertainment', label: 'Entertainment', icon: '🎬' },
  { value: 'other', label: 'Other', icon: '📦' },
];

export const CategoryPicker: React.FC<CategoryPickerProps> = ({
  selectedCategory,
  onSelect,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollView}>
        <View style={styles.categoriesContainer}>
          {categories.map((category) => (
            <TouchableOpacity
              key={category.value}
              style={[
                styles.categoryButton,
                selectedCategory === category.value && styles.selectedCategory,
              ]}
              onPress={() => onSelect(category.value)}
            >
              <Text style={styles.categoryIcon}>{category.icon}</Text>
              <Text
                style={[
                  styles.categoryLabel,
                  selectedCategory === category.value && styles.selectedLabel,
                ]}
              >
                {category.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#000',
    marginBottom: 12,
  },
  scrollView: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  categoriesContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  categoryButton: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#f5f5f5',
    minWidth: 80,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedCategory: {
    backgroundColor: '#E3F2FD',
    borderColor: '#007AFF',
  },
  categoryIcon: {
    fontSize: 24,
    marginBottom: 4,
  },
  categoryLabel: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  selectedLabel: {
    color: '#007AFF',
    fontWeight: '600',
  },
});
