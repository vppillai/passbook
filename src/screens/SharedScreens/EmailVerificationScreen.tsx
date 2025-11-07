/**
 * Email verification screen
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RouteProp } from '@react-navigation/native';
import { RootStackParamList } from '../../types';
import { Button } from '../../components/common';
import { authService } from '../../services/auth';

type EmailVerificationScreenRouteProp = RouteProp<RootStackParamList, 'EmailVerification'>;
type EmailVerificationScreenNavigationProp = StackNavigationProp<RootStackParamList, 'EmailVerification'>;

export const EmailVerificationScreen: React.FC = () => {
  const route = useRoute<EmailVerificationScreenRouteProp>();
  const navigation = useNavigation<EmailVerificationScreenNavigationProp>();
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const token = route.params?.token || '';

  useEffect(() => {
    if (token) {
      handleVerify();
    }
  }, [token]);

  const handleVerify = async () => {
    if (!token) {
      Alert.alert('Error', 'No verification token provided');
      return;
    }

    setLoading(true);
    try {
      await authService.verifyEmail(token);
      setVerified(true);
      Alert.alert(
        'Email Verified',
        'Your email has been verified successfully. You can now log in.',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Login'),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Verification Failed',
        error.response?.data?.error || error.message || 'Invalid or expired verification token'
      );
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Verifying your email...</Text>
      </View>
    );
  }

  if (verified) {
    return (
      <View style={styles.container}>
        <Text style={styles.successIcon}>✓</Text>
        <Text style={styles.title}>Email Verified!</Text>
        <Text style={styles.message}>Your email has been verified successfully.</Text>
        <Button
          title="Go to Login"
          onPress={() => navigation.navigate('Login')}
          style={styles.button}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Verify Your Email</Text>
      <Text style={styles.message}>
        {token
          ? 'Click the button below to verify your email address.'
          : 'Please check your email for a verification link.'}
      </Text>
      {token && (
        <Button
          title="Verify Email"
          onPress={handleVerify}
          loading={loading}
          style={styles.button}
        />
      )}
      <Button
        title="Back to Login"
        onPress={() => navigation.navigate('Login')}
        variant="outline"
        style={styles.button}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  successIcon: {
    fontSize: 64,
    color: '#34C759',
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    maxWidth: 300,
    marginTop: 8,
  },
});
