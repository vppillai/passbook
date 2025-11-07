/**
 * Screen for parents to add funds to child accounts
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../types';
import { Button, Input } from '../../components/common';
import { fundingService } from '../../services/funding';
import { childAccountsService } from '../../services/childAccounts';
import { useChildrenStore } from '../../store';

type AddFundsScreenRouteProp = RouteProp<RootStackParamList, 'AddFunds'>;
type AddFundsScreenNavigationProp = StackNavigationProp<RootStackParamList, 'AddFunds'>;

export const AddFundsScreen: React.FC = () => {
  const route = useRoute<AddFundsScreenRouteProp>();
  const navigation = useNavigation<AddFundsScreenNavigationProp>();
  const { updateChild } = useChildrenStore();

  const childUserId = (route.params as any)?.childUserId || '';

  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      newErrors.amount = 'Amount must be greater than 0';
    }

    if (!reason.trim()) {
      newErrors.reason = 'Reason is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleAddFunds = async () => {
    if (!validate()) {
      return;
    }

    if (!childUserId) {
      Alert.alert('Error', 'Child account not specified');
      return;
    }

    setLoading(true);
    try {
      const result = await fundingService.addFunds({
        childUserId,
        amount: parseFloat(amount),
        reason: reason.trim(),
      });

      // Update child in store
      updateChild(childUserId, { currentBalance: result.newBalance });

      Alert.alert(
        'Success',
        `Added ${result.currency} ${result.amount.toFixed(2)} successfully. New balance: ${result.currency} ${result.newBalance.toFixed(2)}`,
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to add funds'
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
          <Text style={styles.title}>Add Funds</Text>
          <Text style={styles.subtitle}>
            Add money to the child's account
          </Text>

          <Input
            label="Amount"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.amount}
          />

          <Input
            label="Reason"
            value={reason}
            onChangeText={setReason}
            placeholder="e.g., Weekly allowance, Birthday gift"
            multiline
            numberOfLines={3}
            autoCapitalize="sentences"
            error={errors.reason}
          />

          <Button
            title="Add Funds"
            onPress={handleAddFunds}
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
});
