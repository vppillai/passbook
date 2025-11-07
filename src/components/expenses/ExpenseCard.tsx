/**
 * Card component for displaying an expense
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Expense } from '../../types';
import { format } from 'date-fns';

interface ExpenseCardProps {
  expense: Expense;
  onPress?: () => void;
  onEdit?: () => void;
}

const categoryLabels: { [key: string]: string } = {
  snacks: 'Snacks',
  food: 'Food',
  games: 'Games',
  sports: 'Sports',
  school: 'School',
  crafts: 'Crafts',
  toys: 'Toys',
  books: 'Books',
  clothes: 'Clothes',
  entertainment: 'Entertainment',
  other: 'Other',
};

export const ExpenseCard: React.FC<ExpenseCardProps> = ({
  expense,
  onPress,
  onEdit,
}) => {
  const formatAmount = (amount: number, currency: string = 'CAD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return format(date, 'MMM dd, yyyy');
    } catch {
      return dateString;
    }
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.leftSection}>
          <Text style={styles.category}>{categoryLabels[expense.category] || expense.category}</Text>
          <Text style={styles.description} numberOfLines={2}>
            {expense.description}
          </Text>
        </View>
        <View style={styles.rightSection}>
          <Text style={styles.amount}>{formatAmount(expense.amount, expense.currency)}</Text>
          {expense.wasOverdraft && (
            <View style={styles.overdraftBadge}>
              <Text style={styles.overdraftText}>Overdraft</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.date}>{formatDate(expense.expenseDate)}</Text>
        {expense.isParentRecorded && (
          <Text style={styles.parentRecorded}>Added by parent</Text>
        )}
        {onEdit && (
          <TouchableOpacity onPress={onEdit} style={styles.editButton}>
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  leftSection: {
    flex: 1,
    marginRight: 12,
  },
  rightSection: {
    alignItems: 'flex-end',
  },
  category: {
    fontSize: 12,
    fontWeight: '600',
    color: '#007AFF',
    marginBottom: 4,
    textTransform: 'capitalize',
  },
  description: {
    fontSize: 16,
    color: '#000',
    fontWeight: '500',
  },
  amount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FF3B30',
    marginBottom: 4,
  },
  overdraftBadge: {
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  overdraftText: {
    fontSize: 10,
    color: '#FF3B30',
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  date: {
    fontSize: 12,
    color: '#666',
  },
  parentRecorded: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
  },
  editButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  editText: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '500',
  },
});
