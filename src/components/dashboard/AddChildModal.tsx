/**
 * Modal component for adding a new child account
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Button, Input } from '../common';
import { childAccountsService } from '../../services/childAccounts';
import { useChildrenStore } from '../../store';

interface AddChildModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const AddChildModal: React.FC<AddChildModalProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [useEmail, setUseEmail] = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const { addChild } = useChildrenStore();

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!displayName.trim()) {
      newErrors.displayName = 'Display name is required';
    }

    if (!useEmail && !username.trim()) {
      newErrors.username = 'Username is required when not using email';
    }

    if (useEmail && !email.trim()) {
      newErrors.email = 'Email is required';
    } else if (useEmail && !/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    if (!password) {
      newErrors.password = 'Password is required';
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      const child = await childAccountsService.createChild({
        displayName,
        username: useEmail ? undefined : username,
        email: useEmail ? email : undefined,
        password,
      });

      addChild(child);
      Alert.alert('Success', 'Child account created successfully');

      // Reset form
      setDisplayName('');
      setUsername('');
      setEmail('');
      setPassword('');
      setUseEmail(false);
      setErrors({});

      onSuccess?.();
      onClose();
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to create child account'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setDisplayName('');
    setUsername('');
    setEmail('');
    setPassword('');
    setUseEmail(false);
    setErrors({});
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.container}
        >
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.content}>
              <Text style={styles.title}>Add Child Account</Text>

              <Input
                label="Display Name"
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Child's name"
                autoCapitalize="words"
                error={errors.displayName}
              />

              <View style={styles.toggleContainer}>
                <Button
                  title={useEmail ? 'Using Email' : 'Using Username'}
                  onPress={() => setUseEmail(!useEmail)}
                  variant={useEmail ? 'primary' : 'outline'}
                  style={styles.toggleButton}
                />
              </View>

              {useEmail ? (
                <Input
                  label="Email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="child@example.com"
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
                  placeholder="unique_username"
                  autoCapitalize="none"
                  autoComplete="username"
                  error={errors.username}
                />
              )}

              <Input
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="password-new"
                error={errors.password}
              />

              <View style={styles.buttonContainer}>
                <Button
                  title="Cancel"
                  onPress={handleClose}
                  variant="outline"
                  style={styles.button}
                />
                <Button
                  title="Create"
                  onPress={handleSubmit}
                  loading={loading}
                  style={styles.button}
                />
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '90%',
  },
  scrollContent: {
    padding: 20,
  },
  content: {
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  toggleContainer: {
    marginBottom: 16,
  },
  toggleButton: {
    width: '100%',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  button: {
    flex: 1,
  },
});
