/**
 * Notifications module.
 * 
 * Handles sending notifications to users.
 * In production, this would integrate with email, SMS, or push services.
 */

/**
 * Notification types supported by the system.
 */
export type NotificationType = 
  | 'order_created' 
  | 'order_status_changed' 
  | 'order_cancelled' 
  | 'payment_received';

/**
 * Sends a notification to a user.
 * 
 * @param userId - The user to notify
 * @param type - The notification type
 * @param data - Additional notification data
 */
export function sendNotification(
  userId: string, 
  type: NotificationType, 
  data: Record<string, unknown>
): void {
  // In production, this would send to a notification service
  console.log(`[Notification] ${type} to ${userId}:`, data);
}
