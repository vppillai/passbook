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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types';
import { BalanceDisplay } from '../../components/dashboard/BalanceDisplay';
import { FundingCountdown } from '../../components/dashboard/FundingCountdown';
import { Button, LoadingSpinner } from '../../components/common';
import { useAuthStore } from '../../store';
import { childAccountsService } from '../../services/childAccounts';

type ChildDashboardScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'ChildDashboard'
>;

export const ChildDashboardScreen: React.FC = () => {
  const navigation = useNavigation<ChildDashboardScreenNavigationProp>();
  const { user } = useAuthStore();
  const [child, setChild] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadChildData();
  }, []);

  const loadChildData = async () => {
    if (!user?.userId) {
      setLoading(false);
      return;
    }

    try {
      const childData = await childAccountsService.getChild(user.userId);
      setChild(childData);
    } catch (error) {
      console.error('Failed to load child data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadChildData();
    setRefreshing(false);
  };

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
    <ScrollView
      style={styles.container}
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

      <View style={styles.actions}>
        <Button
          title="Add Expense"
          onPress={() => navigation.navigate('AddExpense')}
          style={styles.actionButton}
        />
        <Button
          title="View Expenses"
          onPress={() => navigation.navigate('ExpenseList')}
          variant="outline"
          style={styles.actionButton}
        />
        <Button
          title="Analytics"
          onPress={() => navigation.navigate('Analytics', { childUserId: child.userId })}
          variant="outline"
          style={styles.actionButton}
        />
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#000',
  },
  actions: {
    marginTop: 24,
    gap: 12,
  },
  actionButton: {
    marginBottom: 8,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginTop: 40,
  },
});
