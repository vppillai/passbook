/**
 * Line chart component using Victory Native
 */
import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { VictoryChart, VictoryLine, VictoryAxis, VictoryTheme } from 'victory-native';
import { SpendingTrend } from '../../types';
import { format, parseISO } from 'date-fns';

interface LineChartProps {
  data: SpendingTrend[];
  currency?: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
}

export const LineChart: React.FC<LineChartProps> = ({
  data,
  currency = 'CAD',
  granularity = 'daily',
}) => {
  if (!data || data.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No spending data available</Text>
      </View>
    );
  }

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(screenWidth - 60, 300);

  // Format data for Victory
  const chartData = data.map((item) => ({
    x: format(parseISO(item.date), 'MMM dd'),
    y: item.amount,
    date: item.date,
  }));

  // Calculate max value for Y axis
  const maxAmount = Math.max(...data.map(d => d.amount), 0);
  const yMax = Math.ceil(maxAmount * 1.1); // Add 10% padding

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Spending Trends</Text>
      <View style={styles.chartContainer}>
        <VictoryChart
          theme={VictoryTheme.material}
          width={chartWidth}
          height={250}
          padding={{ left: 50, right: 20, top: 20, bottom: 50 }}
        >
          <VictoryAxis
            dependentAxis
            tickFormat={(t) => `$${t.toFixed(0)}`}
            style={{
              axis: { stroke: '#ccc' },
              tickLabels: { fontSize: 10, fill: '#666' },
            }}
          />
          <VictoryAxis
            tickFormat={(t) => {
              // Show every nth label based on data length
              const index = chartData.findIndex(d => d.x === t);
              if (data.length > 7 && index % Math.ceil(data.length / 7) !== 0) {
                return '';
              }
              return t;
            }}
            style={{
              axis: { stroke: '#ccc' },
              tickLabels: { fontSize: 10, fill: '#666', angle: -45 },
            }}
          />
          <VictoryLine
            data={chartData}
            style={{
              data: { stroke: '#007AFF', strokeWidth: 2 },
            }}
            interpolation="monotoneX"
          />
        </VictoryChart>
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
