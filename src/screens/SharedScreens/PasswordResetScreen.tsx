/**
 * Password reset screen
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
import { authService } from '../../services/auth';

type PasswordResetScreenRouteProp = RouteProp<RootStackParamList, 'PasswordReset'>;
type PasswordResetScreenNavigationProp = StackNavigationProp<RootStackParamList, 'PasswordReset'>;

export const PasswordResetScreen: React.FC = () => {
  const route = useRoute<PasswordResetScreenRouteProp>();
  const navigation = useNavigation<PasswordResetScreenNavigationProp>();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(route.params?.token || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'request' | 'reset'>(token ? 'reset' : 'request');
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validateRequest = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateReset = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!newPassword) {
      newErrors.newPassword = 'Password is required';
    } else if (newPassword.length < 8) {
      newErrors.newPassword = 'Password must be at least 8 characters';
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleRequestReset = async () => {
    if (!validateRequest()) {
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement password reset request endpoint
      Alert.alert(
        'Reset Link Sent',
        'If an account exists with this email, you will receive a password reset link.',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Login'),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to send reset link'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!validateReset()) {
      return;
    }

    if (!token) {
      Alert.alert('Error', 'Invalid reset token');
      return;
    }

    setLoading(true);
    try {
      // TODO: Implement password reset endpoint
      Alert.alert(
        'Password Reset',
        'Your password has been reset successfully.',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Login'),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to reset password'
      );
    } finally {
      setLoading(false);
    }
  };

  if (step === 'reset') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>Enter your new password</Text>

            <Input
              label="New Password"
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 characters"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password-new"
              error={errors.newPassword}
            />

            <Input
              label="Confirm Password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Re-enter your password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password-new"
              error={errors.confirmPassword}
            />

            <Button
              title="Reset Password"
              onPress={handleResetPassword}
              loading={loading}
              style={styles.button}
            />

            <Button
              title="Back to Login"
              onPress={() => navigation.navigate('Login')}
              variant="outline"
              style={styles.button}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.content}>
          <Text style={styles.title}>Forgot Password?</Text>
          <Text style={styles.subtitle}>
            Enter your email address and we'll send you a link to reset your password
          </Text>

          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="your@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            error={errors.email}
          />

          <Button
            title="Send Reset Link"
            onPress={handleRequestReset}
            loading={loading}
            style={styles.button}
          />

          <Button
            title="Back to Login"
            onPress={() => navigation.navigate('Login')}
            variant="outline"
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
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
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
    marginTop: 8,
  },
});
