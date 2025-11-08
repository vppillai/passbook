/**
 * Modal component for inviting a parent
 */
import React, { useState, useEffect } from 'react';
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
import { parentAccountsService } from '../../services/parentAccounts';

interface InviteParentModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export const InviteParentModal: React.FC<InviteParentModalProps> = ({
  visible,
  onClose,
  onSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  // Handle Escape key press
  useEffect(() => {
    if (!visible) return;

    const handleKeyPress = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    if (Platform.OS === 'web') {
      document.addEventListener('keydown', handleKeyPress);
      return () => {
        document.removeEventListener('keydown', handleKeyPress);
      };
    }
  }, [visible]);

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInvite = async () => {
    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      await parentAccountsService.inviteParent(email.trim().toLowerCase());

      Alert.alert(
        'Invitation Sent',
        `An invitation has been sent to ${email}. They will receive an email with instructions to join the family.`,
        [
          {
            text: 'OK',
            onPress: () => {
              setEmail('');
              setErrors({});
              onSuccess?.();
              onClose();
            },
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Error',
        error.response?.data?.error || error.message || 'Failed to send invitation'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setEmail('');
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
              <Text style={styles.title}>Invite Parent</Text>
              <Text style={styles.subtitle}>
                Send an invitation to another parent to join your family account
              </Text>

              <Input
                label="Email Address"
                value={email}
                onChangeText={setEmail}
                placeholder="parent@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                error={errors.email}
              />

              <View style={styles.buttonContainer}>
                <Button
                  title="Cancel"
                  onPress={handleClose}
                  variant="outline"
                  style={styles.button}
                />
                <Button
                  title="Send Invitation"
                  onPress={handleInvite}
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
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    textAlign: 'center',
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
