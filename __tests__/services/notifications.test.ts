/**
 * Tests for notification service
 */
import { notificationService } from '../../src/services/notifications';
import * as Notifications from 'expo-notifications';

jest.mock('expo-notifications');

describe('NotificationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registerForPushNotifications', () => {
    it('should register for push notifications', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'test-push-token',
      });
      (Notifications.setNotificationChannelAsync as jest.Mock).mockResolvedValue(undefined);

      const token = await notificationService.registerForPushNotifications();

      expect(token).toBe('test-push-token');
      expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalled();
    });

    it('should request permissions if not granted', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'undetermined',
      });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'granted',
      });
      (Notifications.getExpoPushTokenAsync as jest.Mock).mockResolvedValue({
        data: 'test-push-token',
      });

      const token = await notificationService.registerForPushNotifications();

      expect(token).toBe('test-push-token');
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalled();
    });

    it('should return null if permissions denied', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
      });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
        status: 'denied',
      });

      const token = await notificationService.registerForPushNotifications();

      expect(token).toBeNull();
      expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    });
  });

  describe('scheduleLocalNotification', () => {
    it('should schedule a local notification', async () => {
      (Notifications.scheduleNotificationAsync as jest.Mock).mockResolvedValue('notification-id');

      const id = await notificationService.scheduleLocalNotification(
        'Test Title',
        'Test Body',
        { type: 'test' }
      );

      expect(id).toBe('notification-id');
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
        content: {
          title: 'Test Title',
          body: 'Test Body',
          data: { type: 'test' },
          sound: true,
        },
        trigger: null,
      });
    });
  });

  describe('cancelNotification', () => {
    it('should cancel a notification', async () => {
      (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockResolvedValue(undefined);

      await notificationService.cancelNotification('notification-id');

      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-id');
    });
  });

  describe('setupNotificationListeners', () => {
    it('should set up notification listeners', () => {
      const mockReceivedListener = { remove: jest.fn() };
      const mockResponseListener = { remove: jest.fn() };

      (Notifications.addNotificationReceivedListener as jest.Mock).mockReturnValue(mockReceivedListener);
      (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockReturnValue(mockResponseListener);

      const cleanup = notificationService.setupNotificationListeners(
        jest.fn(),
        jest.fn()
      );

      expect(cleanup).toBeDefined();
      expect(typeof cleanup).toBe('function');

      // Test cleanup
      cleanup();
      expect(mockReceivedListener.remove).toHaveBeenCalled();
      expect(mockResponseListener.remove).toHaveBeenCalled();
    });
  });
});
