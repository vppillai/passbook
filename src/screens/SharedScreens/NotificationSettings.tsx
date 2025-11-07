/**
 * Notification settings screen
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  Alert,
} from 'react-native';
import { Button } from '../components/common';
import { notificationService } from '../services/notifications';
import { useAuthStore } from '../store';

export const NotificationSettingsScreen: React.FC = () => {
  const { user } = useAuthStore();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    checkNotificationStatus();
  }, []);

  const checkNotificationStatus = async () => {
    const token = await notificationService.registerForPushNotifications();
    setPushToken(token);
    setNotificationsEnabled(!!token);
  };

  const handleToggleNotifications = async (value: boolean) => {
    setLoading(true);
    try {
      if (value) {
        const token = await notificationService.registerForPushNotifications();
        if (token) {
          setPushToken(token);
          setNotificationsEnabled(true);
          Alert.alert('Success', 'Push notifications enabled');
        } else {
          Alert.alert(
            'Permission Denied',
            'Please enable notifications in your device settings'
          );
          setNotificationsEnabled(false);
        }
      } else {
        await notificationService.cancelAllNotifications();
        setNotificationsEnabled(false);
        setPushToken(null);
        Alert.alert('Success', 'Push notifications disabled');
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to update notification settings');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>Push Notifications</Text>
        <Text style={styles.description}>
          Receive notifications for important events like low balances, new expenses, and fund additions.
        </Text>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Enable Notifications</Text>
            <Text style={styles.settingDescription}>
              Receive push notifications on your device
            </Text>
          </View>
          <Switch
            value={notificationsEnabled}
            onValueChange={handleToggleNotifications}
            disabled={loading}
          />
        </View>

        {pushToken && (
          <View style={styles.tokenContainer}>
            <Text style={styles.tokenLabel}>Device Token:</Text>
            <Text style={styles.tokenValue} numberOfLines={1}>
              {pushToken}
            </Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notification Types</Text>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Low Balance Alerts</Text>
            <Switch value={true} disabled />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>New Expense Notifications</Text>
            <Switch value={true} disabled />
          </View>

          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>Fund Addition Notifications</Text>
            <Switch value={true} disabled />
          </View>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
    marginTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#000',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 12,
    color: '#666',
  },
  tokenContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  tokenLabel: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  tokenValue: {
    fontSize: 10,
    color: '#999',
    fontFamily: 'monospace',
  },
});
