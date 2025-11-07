/**
 * Screen for adding a new expense
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, ExpenseCategory } from '../../types';
import { Button, Input } from '../../components/common';
import { CategoryPicker } from '../../components/expenses/CategoryPicker';
import { expensesService } from '../../services/expenses';
import { useAuthStore } from '../../store';
import { format } from 'date-fns';

type AddExpenseScreenNavigationProp = StackNavigationProp<RootStackParamList, 'AddExpense'>;

export const AddExpenseScreen: React.FC = () => {
  const navigation = useNavigation<AddExpenseScreenNavigationProp>();
  const { user } = useAuthStore();
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory | ''>('');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    }

    if (!category) {
      newErrors.category = 'Category is required';
    }

    if (!description.trim()) {
      newErrors.description = 'Description is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddExpense = async () => {
    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      const result = await expensesService.addExpense({
        amount: parseFloat(amount),
        category: category as ExpenseCategory,
        description: description.trim(),
        expenseDate,
      });

      if (result.wasOverdraft) {
        Alert.alert(
          'Overdraft Warning',
          `This expense will result in a negative balance. New balance: ${result.newBalance.toFixed(2)}`,
          [
            {
              text: 'OK',
              onPress: () => navigation.goBack(),
            },
          ]
        );
      } else {
        Alert.alert('Success', 'Expense added successfully', [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]);
      }
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to add expense'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Text style={styles.title}>Add Expense</Text>
          <Text style={styles.subtitle}>Record a new expense</Text>

          <Input
            label="Amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.amount}
          />

          <CategoryPicker
            selectedCategory={category}
            onSelect={setCategory}
          />
          {errors.category && (
            <Text style={styles.errorText}>{errors.category}</Text>
          )}

          <Input
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What did you buy?"
            multiline
            numberOfLines={3}
            autoCapitalize="sentences"
            error={errors.description}
          />

          <Input
            label="Date"
            value={expenseDate}
            onChangeText={setExpenseDate}
            placeholder="YYYY-MM-DD"
            error={errors.expenseDate}
          />

          <Button
            title="Add Expense"
            onPress={handleAddExpense}
            loading={loading}
            style={styles.button}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 500,
    alignSelf: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
    textAlign: 'center',
  },
  button: {
    marginTop: 24,
  },
  errorText: {
    fontSize: 12,
    color: '#FF3B30',
    marginTop: -12,
    marginBottom: 16,
  },
});
