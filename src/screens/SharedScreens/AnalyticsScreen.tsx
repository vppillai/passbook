/**
 * Analytics screen showing spending analytics and charts
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
import { useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList, AnalyticsData } from '../../types';
import { PieChart } from '../../components/analytics/PieChart';
import { LineChart } from '../../components/analytics/LineChart';
import { ReportExportModal } from '../../components/analytics/ReportExportModal';
import { Button, LoadingSpinner } from '../../components/common';
import { analyticsService } from '../../services/analytics';
import { useAuthStore } from '../../store';
import { format, startOfMonth, endOfMonth } from 'date-fns';

type AnalyticsScreenRouteProp = RouteProp<RootStackParamList, 'Analytics'>;
type AnalyticsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Analytics'>;

export const AnalyticsScreen: React.FC = () => {
  const route = useRoute<AnalyticsScreenRouteProp>();
  const navigation = useNavigation<AnalyticsScreenNavigationProp>();
  const { user } = useAuthStore();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [dateRange, setDateRange] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(new Date()), 'yyyy-MM-dd'),
  });

  const childUserId = route.params?.childUserId || user?.userId;

  useEffect(() => {
    loadAnalytics();
  }, [childUserId, dateRange]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const data = await analyticsService.getAnalytics(childUserId, dateRange);
      setAnalytics(data);
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to load analytics'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAnalytics();
    setRefreshing(false);
  };

  if (loading && !analytics) {
    return <LoadingSpinner message="Loading analytics..." />;
  }

  if (!analytics) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Failed to load analytics</Text>
      </View>
    );
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'CAD',
      minimumFractionDigits: 2,
    }).format(amount);
  };

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
          <Text style={styles.title}>Analytics</Text>
          <Text style={styles.subtitle}>
            {format(new Date(dateRange.startDate), 'MMM dd')} -{' '}
            {format(new Date(dateRange.endDate), 'MMM dd, yyyy')}
          </Text>
        </View>

        {/* Summary Cards */}
        <View style={styles.summaryContainer}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Expenses</Text>
            <Text style={styles.summaryValue}>
              {formatCurrency(analytics.totalExpenses)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Funded</Text>
            <Text style={[styles.summaryValue, styles.positiveValue]}>
              {formatCurrency(analytics.totalFunded)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Net Balance</Text>
            <Text
              style={[
                styles.summaryValue,
                analytics.netBalance >= 0 ? styles.positiveValue : styles.negativeValue,
              ]}
            >
              {formatCurrency(analytics.netBalance)}
            </Text>
          </View>
        </View>

        {/* Pie Chart */}
        <PieChart data={analytics.categoryBreakdown} />

        {/* Line Chart */}
        <LineChart data={analytics.spendingTrends} />

        {/* Category Breakdown Table */}
        <View style={styles.tableContainer}>
          <Text style={styles.tableTitle}>Category Breakdown</Text>
          {analytics.categoryBreakdown.map((item, index) => (
            <View key={item.category} style={styles.tableRow}>
              <Text style={styles.tableCategory}>{item.category}</Text>
              <View style={styles.tableRight}>
                <Text style={styles.tableAmount}>
                  {formatCurrency(item.amount)}
                </Text>
                <Text style={styles.tablePercentage}>{item.percentage}%</Text>
              </View>
            </View>
          ))}
        </View>

        <Button
          title="Export Report"
          onPress={() => setExportModalVisible(true)}
          style={styles.exportButton}
        />
      </ScrollView>

      <ReportExportModal
        visible={exportModalVisible}
        onClose={() => setExportModalVisible(false)}
        childUserId={childUserId}
        startDate={dateRange.startDate}
        endDate={dateRange.endDate}
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
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  summaryContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  summaryLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
  },
  summaryValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FF3B30',
  },
  positiveValue: {
    color: '#34C759',
  },
  negativeValue: {
    color: '#FF3B30',
  },
  tableContainer: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  tableTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  tableCategory: {
    fontSize: 16,
    color: '#000',
    textTransform: 'capitalize',
  },
  tableRight: {
    alignItems: 'flex-end',
  },
  tableAmount: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
  },
  tablePercentage: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  exportButton: {
    marginTop: 20,
    marginBottom: 40,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    marginTop: 40,
  },
});
