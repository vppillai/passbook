/**
 * Child dashboard screen showing balance and recent activity
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList, Expense } from '../../types';
import { BalanceDisplay } from '../../components/dashboard/BalanceDisplay';
import { FundingCountdown } from '../../components/dashboard/FundingCountdown';
import { LoadingSpinner, FAB } from '../../components/common';
import { ExpenseCard } from '../../components/expenses/ExpenseCard';
import { useAuthStore, useExpensesStore } from '../../store';
import { childAccountsService } from '../../services/childAccounts';
import { expensesService } from '../../services/expenses';

type ChildDashboardScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'ChildDashboard'
>;

export const ChildDashboardScreen: React.FC = () => {
  const navigation = useNavigation<ChildDashboardScreenNavigationProp>();
  const { user } = useAuthStore();
  const { expenses, setExpenses } = useExpensesStore();
  const [child, setChild] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    if (!user?.userId) {
      setLoading(false);
      return;
    }

    try {
      const [childData, expensesList] = await Promise.all([
        childAccountsService.getChild(user.userId),
        expensesService.listExpenses(user.userId),
      ]);
      setChild(childData);
      setExpenses(expensesList);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
  };

  const handleExpensePress = (expense: Expense) => {
    // Navigate to expense detail or just log for now
    console.log('Expense pressed:', expense.transactionId);
  };

  // Show only the 5 most recent expenses
  const recentExpenses = expenses.slice(0, 5);

  if (loading) {
    return <LoadingSpinner message="Loading dashboard..." />;
  }

  if (!child) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to load account data</Text>
      </View>
    );
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
        <View style={styles.header}>
          <Text style={styles.greeting}>Hello, {child.displayName}!</Text>
        </View>

        <BalanceDisplay child={child} />

        {child.fundingPeriod && <FundingCountdown child={child} />}

        {/* Recent Expenses Section */}
        <View style={styles.expensesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Expenses</Text>
            {expenses.length > 5 && (
              <TouchableOpacity onPress={() => navigation.navigate('ExpenseList')}>
                <Text style={styles.viewAllLink}>View All</Text>
              </TouchableOpacity>
            )}
          </View>

          {recentExpenses.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No expenses yet</Text>
              <Text style={styles.emptySubtext}>
                Tap the + button to add your first expense
              </Text>
            </View>
          ) : (
            <View style={styles.expensesList}>
              {recentExpenses.map((expense) => (
                <ExpenseCard
                  key={expense.transactionId}
                  expense={expense}
                  onPress={() => handleExpensePress(expense)}
                />
              ))}
            </View>
          )}
        </View>

        {/* Analytics Quick Link */}
        <TouchableOpacity
          style={styles.analyticsLink}
          onPress={() => navigation.navigate('Analytics', { childUserId: child.userId })}
        >
          <Text style={styles.analyticsLinkText}>View Spending Analytics →</Text>
        </TouchableOpacity>
      </ScrollView>

      <FAB
        onPress={() => navigation.navigate('AddExpense')}
        icon="+"
      />
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
    paddingBottom: 80, // Extra padding to prevent content from hiding behind FAB
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  expensesSection: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
  },
  viewAllLink: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  expensesList: {
    gap: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
  analyticsLink: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    alignItems: 'center',
  },
  analyticsLinkText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginTop: 40,
  },
});
