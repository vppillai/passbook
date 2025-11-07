/**
 * Login screen for parent and child accounts
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
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../../types';
import { Button, Input } from '../../components/common';
import { authService } from '../../services/auth';
import { useAuthStore } from '../../store';

type LoginScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Login'>;

export const LoginScreen: React.FC = () => {
  const navigation = useNavigation<LoginScreenNavigationProp>();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginType, setLoginType] = useState<'email' | 'username'>('email');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  useEffect(() => {
    // Check if already authenticated
    authService.checkAuth().then((isAuth) => {
      if (isAuth) {
        const { user } = useAuthStore.getState();
        if (user?.userType === 'parent') {
          navigation.replace('ParentDashboard');
        } else {
          navigation.replace('ChildDashboard');
        }
      }
    });
  }, [navigation]);

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (loginType === 'email') {
      if (!email.trim()) {
        newErrors.email = 'Email is required';
      } else if (!/\S+@\S+\.\S+/.test(email)) {
        newErrors.email = 'Email is invalid';
      }
    } else {
      if (!username.trim()) {
        newErrors.username = 'Username is required';
      }
    }

    if (!password) {
      newErrors.password = 'Password is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleLogin = async () => {
    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      const credentials: any = { password };
      if (loginType === 'email') {
        credentials.email = email;
      } else {
        credentials.username = username;
      }

      await authService.login(credentials);

      const { user } = useAuthStore.getState();
      if (user?.userType === 'parent') {
        if (user.familyId) {
          navigation.replace('ParentDashboard');
        } else {
          navigation.replace('FamilySetup');
        }
      } else {
        navigation.replace('ChildDashboard');
      }
    } catch (error: any) {
      Alert.alert(
        'Login Failed',
        error.response?.data?.error || error.message || 'Invalid credentials'
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
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to your Passbook account</Text>

          <View style={styles.toggleContainer}>
            <Button
              title="Email"
              onPress={() => setLoginType('email')}
              variant={loginType === 'email' ? 'primary' : 'outline'}
              style={styles.toggleButton}
            />
            <Button
              title="Username"
              onPress={() => setLoginType('username')}
              variant={loginType === 'username' ? 'primary' : 'outline'}
              style={styles.toggleButton}
            />
          </View>

          {loginType === 'email' ? (
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
          ) : (
            <Input
              label="Username"
              value={username}
              onChangeText={setUsername}
              placeholder="Your username"
              autoCapitalize="none"
              autoComplete="username"
              error={errors.username}
            />
          )}

          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Enter your password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            error={errors.password}
          />

          <Button
            title="Sign In"
            onPress={handleLogin}
            loading={loading}
            style={styles.button}
          />

          <Button
            title="Don't have an account? Sign Up"
            onPress={() => navigation.navigate('Signup')}
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
  toggleContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    gap: 8,
  },
  toggleButton: {
    flex: 1,
  },
  button: {
    marginTop: 8,
  },
  linkButton: {
    marginTop: 16,
  },
});
