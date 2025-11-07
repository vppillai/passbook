/**
 * Screen for listing expenses
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, Expense } from '../../types';
import { ExpenseCard } from '../../components/expenses/ExpenseCard';
import { FAB } from '../../components/common/FAB';
import { LoadingSpinner } from '../../components/common';
import { expensesService } from '../../services/expenses';
import { useExpensesStore, useAuthStore } from '../../store';

type ExpenseListScreenRouteProp = RouteProp<RootStackParamList, 'ExpenseList'>;
type ExpenseListScreenNavigationProp = StackNavigationProp<RootStackParamList, 'ExpenseList'>;

export const ExpenseListScreen: React.FC = () => {
  const navigation = useNavigation<ExpenseListScreenNavigationProp>();
  const route = useRoute<ExpenseListScreenRouteProp>();
  const { user } = useAuthStore();
  const { expenses, setExpenses, setLoading, setError } = useExpensesStore();
  const [refreshing, setRefreshing] = useState(false);

  const childUserId = (route.params as any)?.childUserId || user?.userId;

  useEffect(() => {
    loadExpenses();
  }, [childUserId]);

  const loadExpenses = async () => {
    setLoading(true);
    setError(null);
    try {
      const expensesList = await expensesService.listExpenses(childUserId);
      setExpenses(expensesList);
    } catch (error: any) {
      setError(error.message || 'Failed to load expenses');
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to load expenses'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadExpenses();
    setRefreshing(false);
  };

  const handleExpensePress = (expense: Expense) => {
    // TODO: Navigate to expense detail screen
    console.log('Expense pressed:', expense.transactionId);
  };

  const handleEditExpense = (expense: Expense) => {
    // TODO: Navigate to edit expense screen
    Alert.alert('Edit Expense', `Edit functionality for ${expense.description}`);
  };

  if (useExpensesStore.getState().loading && expenses.length === 0) {
    return <LoadingSpinner message="Loading expenses..." />;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
        {expenses.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No expenses yet</Text>
            <Text style={styles.emptySubtext}>
              Tap the + button to add your first expense
            </Text>
          </View>
        ) : (
          <View style={styles.expensesList}>
            {expenses.map((expense) => (
              <ExpenseCard
                key={expense.transactionId}
                expense={expense}
                onPress={() => handleExpensePress(expense)}
                onEdit={() => handleEditExpense(expense)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <FAB onPress={() => navigation.navigate('AddExpense')} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  expensesList: {
    marginBottom: 80, // Space for FAB
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});
