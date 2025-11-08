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

const categories: { value: ExpenseCategory; label: string }[] = [
  { value: 'snacks', label: 'Snacks' },
  { value: 'food', label: 'Food' },
  { value: 'games', label: 'Games' },
  { value: 'sports', label: 'Sports' },
  { value: 'school', label: 'School' },
  { value: 'crafts', label: 'Crafts' },
  { value: 'toys', label: 'Toys' },
  { value: 'books', label: 'Books' },
  { value: 'clothes', label: 'Clothes' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'other', label: 'Other' },
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
    gap: 8,
  },
  categoryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  selectedCategory: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  categoryLabel: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
  },
  selectedLabel: {
    color: '#fff',
    fontWeight: '600',
  },
});
