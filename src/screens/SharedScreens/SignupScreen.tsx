/**
 * Signup screen for parent account creation
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types';
import { Button, Input } from '../../components/common';
import { authService } from '../../services/auth';

type SignupScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Signup'>;

export const SignupScreen: React.FC = () => {
  const navigation = useNavigation<SignupScreenNavigationProp>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (!displayName.trim()) {
      newErrors.displayName = 'Display name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSignup = async () => {
    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      await authService.signup({
        email,
        password,
        displayName,
      });

      Alert.alert(
        'Account Created',
        'Please check your email to verify your account before logging in.',
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Login'),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Signup Failed',
        error.response?.data?.error || error.message || 'Failed to create account'
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
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Sign up to start managing family allowances</Text>

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

          <Input
            label="Display Name"
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Your Name"
            autoCapitalize="words"
            error={errors.displayName}
          />

          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password-new"
            error={errors.password}
          />

          <Button
            title="Sign Up"
            onPress={handleSignup}
            loading={loading}
            style={styles.button}
          />

          <Button
            title="Already have an account? Login"
            onPress={() => navigation.navigate('Login')}
            variant="outline"
            style={styles.linkButton}
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
  linkButton: {
    marginTop: 16,
  },
});
