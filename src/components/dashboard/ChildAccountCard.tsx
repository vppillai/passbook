/**
 * Card component for displaying a child account
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChildAccount } from '../../types';

interface ChildAccountCardProps {
  child: ChildAccount;
  onPress?: () => void;
  onEdit?: () => void;
}

export const ChildAccountCard: React.FC<ChildAccountCardProps> = ({
  child,
  onPress,
  onEdit,
}) => {
  const formatBalance = (balance: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'CAD', // TODO: Get from family settings
      minimumFractionDigits: 2,
    }).format(balance);
  };

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.header}>
        <View style={styles.nameContainer}>
          <Text style={styles.name}>{child.displayName}</Text>
          {child.username && (
            <Text style={styles.username}>@{child.username}</Text>
          )}
        </View>
        {onEdit && (
          <TouchableOpacity onPress={onEdit} style={styles.editButton}>
            <Text style={styles.editText}>Edit</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.balanceContainer}>
        <Text style={styles.balanceLabel}>Balance</Text>
        <Text
          style={[
            styles.balance,
            child.currentBalance < 0 && styles.negativeBalance,
          ]}
        >
          {formatBalance(child.currentBalance)}
        </Text>
      </View>

      {child.status !== 'active' && (
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{child.status}</Text>
        </View>
      )}
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
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  nameContainer: {
    flex: 1,
  },
  name: {
    fontSize: 18,
    fontWeight: '600',
    color: '#000',
    marginBottom: 4,
  },
  username: {
    fontSize: 14,
    color: '#666',
  },
  editButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  editText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '500',
  },
  balanceContainer: {
    marginTop: 8,
  },
  balanceLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  balance: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#34C759',
  },
  negativeBalance: {
    color: '#FF3B30',
  },
  statusBadge: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    color: '#FF3B30',
    textTransform: 'capitalize',
  },
});
