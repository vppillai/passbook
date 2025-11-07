/**
 * Component for displaying child account balance prominently
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ChildAccount } from '../../types';

interface BalanceDisplayProps {
  child: ChildAccount;
  currency?: string;
}

export const BalanceDisplay: React.FC<BalanceDisplayProps> = ({
  child,
  currency = 'CAD',
}) => {
  const formatBalance = (balance: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
    }).format(balance);
  };

  const isNegative = child.currentBalance < 0;
  const isLow = child.currentBalance < 1.0 && child.currentBalance >= 0;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Available Balance</Text>
      <Text
        style={[
          styles.balance,
          isNegative && styles.negativeBalance,
          isLow && styles.lowBalance,
        ]}
      >
        {formatBalance(child.currentBalance)}
      </Text>
      {isNegative && (
        <Text style={styles.overdraftWarning}>
          Overdraft: {formatBalance(Math.abs(child.currentBalance))}
        </Text>
      )}
      {isLow && !isNegative && (
        <Text style={styles.lowBalanceWarning}>Low balance</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  label: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
    fontWeight: '500',
  },
  balance: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#34C759',
  },
  negativeBalance: {
    color: '#FF3B30',
  },
  lowBalance: {
    color: '#FF9500',
  },
  overdraftWarning: {
    marginTop: 8,
    fontSize: 12,
    color: '#FF3B30',
    fontWeight: '500',
  },
  lowBalanceWarning: {
    marginTop: 8,
    fontSize: 12,
    color: '#FF9500',
    fontWeight: '500',
  },
});
