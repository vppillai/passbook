/**
 * Notification handlers for different event types
 */
import { notificationService } from '../services/notifications';

/**
 * Handle low balance notification
 */
export function handleLowBalanceNotification(
  childName: string,
  balance: number,
  currency: string = 'CAD'
): void {
  notificationService.scheduleLocalNotification(
    'Low Balance Alert',
    `${childName}'s balance is below $${balance.toFixed(2)} ${currency}`,
    {
      type: 'low_balance',
      childName,
      balance,
    }
  );
}

/**
 * Handle new expense notification
 */
export function handleNewExpenseNotification(
  childName: string,
  amount: number,
  category: string,
  currency: string = 'CAD'
): void {
  notificationService.scheduleLocalNotification(
    'New Expense',
    `${childName} spent $${amount.toFixed(2)} on ${category}`,
    {
      type: 'new_expense',
      childName,
      amount,
      category,
    }
  );
}

/**
 * Handle fund addition notification
 */
export function handleFundAdditionNotification(
  childName: string,
  amount: number,
  currency: string = 'CAD'
): void {
  notificationService.scheduleLocalNotification(
    'Funds Added',
    `$${amount.toFixed(2)} ${currency} added to ${childName}'s account`,
    {
      type: 'fund_addition',
      childName,
      amount,
    }
  );
}

/**
 * Setup global notification handlers
 * Call this from a React component or App.tsx
 */
export function setupNotificationHandlers(
  onNotificationReceived?: (notification: any) => void,
  onNotificationTapped?: (response: any) => void
): () => void {
  return notificationService.setupNotificationListeners(
    // Handle notification received
    (notification) => {
      console.log('Notification received:', notification);
      onNotificationReceived?.(notification);
    },
    // Handle notification tapped
    (response) => {
      const data = response.notification.request.content.data;
      console.log('Notification tapped:', data);
      onNotificationTapped?.(response);
    }
  );
}
