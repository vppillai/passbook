/**
 * Pie chart component using Victory Native
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { VictoryPie } from 'victory-native';
import { CategoryBreakdown } from '../../types';

interface PieChartProps {
  data: CategoryBreakdown[];
  currency?: string;
}

const colors = [
  '#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE',
  '#FF2D55', '#5AC8FA', '#FFCC00', '#5856D6', '#FF9500', '#8E8E93'
];

export const PieChart: React.FC<PieChartProps> = ({ data, currency = 'CAD' }) => {
  if (!data || data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No data available</Text>
      </View>
    );
  }

  const chartData = data.map((item, index) => ({
    x: item.category,
    y: item.amount,
    label: `${item.percentage}%`,
    color: colors[index % colors.length],
  }));

  const screenWidth = Dimensions.get('window').width;
  const chartSize = Math.min(screenWidth - 80, 300);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Spending by Category</Text>
      <View style={styles.chartContainer}>
        <VictoryPie
          data={chartData}
          width={chartSize}
          height={chartSize}
          colorScale={chartData.map(d => d.color)}
          innerRadius={chartSize * 0.3}
          labelRadius={({ innerRadius }) => (innerRadius || 0) + 30}
          style={{
            labels: {
              fill: '#000',
              fontSize: 12,
              fontWeight: '500',
            },
          }}
        />
      </View>
      <View style={styles.legend}>
        {data.map((item, index) => (
          <View key={item.category} style={styles.legendItem}>
            <View
              style={[
                styles.legendColor,
                { backgroundColor: colors[index % colors.length] },
              ]}
            />
            <Text style={styles.legendLabel}>
              {item.category}: {new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: currency,
              }).format(item.amount)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  chartContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
  },
  legend: {
    marginTop: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  legendColor: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 8,
  },
  legendLabel: {
    fontSize: 14,
    color: '#666',
    flex: 1,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#999',
  },
});
