/**
 * Component for displaying funding period countdown
 */
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ChildAccount } from '../../types';
import { differenceInDays, format } from 'date-fns';

interface FundingCountdownProps {
  child: ChildAccount;
}

export const FundingCountdown: React.FC<FundingCountdownProps> = ({ child }) => {
  const [daysRemaining, setDaysRemaining] = useState<number | null>(null);
  const [nextFundingDate, setNextFundingDate] = useState<string | null>(null);

  useEffect(() => {
    if (child.fundingPeriod?.nextFundingDate) {
      const nextDate = new Date(child.fundingPeriod.nextFundingDate);
      const today = new Date();
      const days = differenceInDays(nextDate, today);

      setDaysRemaining(days);
      setNextFundingDate(format(nextDate, 'MMM dd, yyyy'));
    }
  }, [child.fundingPeriod]);

  if (!child.fundingPeriod?.nextFundingDate) {
    return null;
  }

  const isOverdue = daysRemaining !== null && daysRemaining < 0;
  const isSoon = daysRemaining !== null && daysRemaining <= 3 && daysRemaining >= 0;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Next Funding</Text>
      {isOverdue ? (
        <Text style={styles.overdueText}>Overdue</Text>
      ) : (
        <Text style={[styles.countdown, isSoon && styles.soonText]}>
          {daysRemaining === 0
            ? 'Today'
            : daysRemaining === 1
            ? 'Tomorrow'
            : `${daysRemaining} days`}
        </Text>
      )}
      {nextFundingDate && (
        <Text style={styles.dateText}>{nextFundingDate}</Text>
      )}
      {child.fundingPeriod.amount && (
        <Text style={styles.amountText}>
          Expected: ${child.fundingPeriod.amount.toFixed(2)}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8f9fa',
    padding: 16,
    borderRadius: 8,
    marginBottom: 16,
  },
  label: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
    fontWeight: '500',
  },
  countdown: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 4,
  },
  soonText: {
    color: '#FF9500',
  },
  overdueText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FF3B30',
    marginBottom: 4,
  },
  dateText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  amountText: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '500',
  },
});
