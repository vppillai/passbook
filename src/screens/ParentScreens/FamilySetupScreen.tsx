/**
 * Family setup screen for creating a family account
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
import { useAuthStore } from '../../store';

type FamilySetupScreenNavigationProp = StackNavigationProp<RootStackParamList, 'FamilySetup'>;

export const FamilySetupScreen: React.FC = () => {
  const navigation = useNavigation<FamilySetupScreenNavigationProp>();
  const { user } = useAuthStore();
  const [familyName, setFamilyName] = useState('');
  const [description, setDescription] = useState('');
  const [currency, setCurrency] = useState('CAD');
  const [timezone, setTimezone] = useState('America/Toronto');
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

  const validate = (): boolean => {
    const newErrors: { [key: string]: string } = {};

    if (!familyName.trim()) {
      newErrors.familyName = 'Family name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCreateFamily = async () => {
    if (!validate()) {
      return;
    }

    setLoading(true);
    try {
      await authService.createFamily({
        familyName,
        description: description.trim() || undefined,
        currency,
        timezone,
      });

      Alert.alert(
        'Family Created',
        'Your family account has been created successfully!',
        [
          {
            text: 'OK',
            onPress: () => navigation.replace('ParentDashboard'),
          },
        ]
      );
    } catch (error: any) {
      Alert.alert(
        'Creation Failed',
        error.response?.data?.error || error.message || 'Failed to create family account'
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
          <Text style={styles.title}>Create Family Account</Text>
          <Text style={styles.subtitle}>
            Set up your family account to start managing allowances
          </Text>

          <Input
            label="Family Name"
            value={familyName}
            onChangeText={setFamilyName}
            placeholder="The Smith Family"
            autoCapitalize="words"
            error={errors.familyName}
          />

          <Input
            label="Description (Optional)"
            value={description}
            onChangeText={setDescription}
            placeholder="A brief description of your family"
            multiline
            numberOfLines={3}
            autoCapitalize="sentences"
            error={errors.description}
          />

          <Input
            label="Currency"
            value={currency}
            onChangeText={setCurrency}
            placeholder="CAD"
            autoCapitalize="characters"
            error={errors.currency}
          />

          <Input
            label="Timezone"
            value={timezone}
            onChangeText={setTimezone}
            placeholder="America/Toronto"
            autoCapitalize="none"
            error={errors.timezone}
          />

          <Button
            title="Create Family"
            onPress={handleCreateFamily}
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
