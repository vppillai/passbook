/**
 * Notification service for push notifications across platforms
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { storage } from './storage';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

class NotificationService {
  private expoPushToken: string | null = null;

  /**
   * Register for push notifications
   */
  async registerForPushNotifications(): Promise<string | null> {
    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.log('Failed to get push token for push notification!');
        return null;
      }

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId: 'your-project-id', // Should match app.json
      });

      this.expoPushToken = tokenData.data;

      // Store token for backend
      await this.saveDeviceToken(this.expoPushToken);

      // Configure notification channel for Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });
      }

      return this.expoPushToken;
    } catch (error) {
      console.error('Error registering for push notifications:', error);
      return null;
    }
  }

  /**
   * Save device token to backend
   */
  private async saveDeviceToken(token: string): Promise<void> {
    // TODO: Call backend API to save device token
    // await apiClient.post('/notifications/register-device', { token });
  }

  /**
   * Schedule a local notification
   */
  async scheduleLocalNotification(
    title: string,
    body: string,
    data?: any
  ): Promise<string> {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        data: data || {},
        sound: true,
      },
      trigger: null, // Show immediately
    });
  }

  /**
   * Cancel a notification
   */
  async cancelNotification(notificationId: string): Promise<void> {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }

  /**
   * Cancel all notifications
   */
  async cancelAllNotifications(): Promise<void> {
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  /**
   * Set up notification listeners
   */
  setupNotificationListeners(
    onNotificationReceived: (notification: Notifications.Notification) => void,
    onNotificationTapped: (response: Notifications.NotificationResponse) => void
  ): () => void {
    // Listener for notifications received while app is foregrounded
    const receivedListener = Notifications.addNotificationReceivedListener(
      onNotificationReceived
    );

    // Listener for when user taps on notification
    const responseListener = Notifications.addNotificationResponseReceivedListener(
      onNotificationTapped
    );

    // Return cleanup function
    return () => {
      receivedListener.remove();
      responseListener.remove();
    };
  }
}

export const notificationService = new NotificationService();
