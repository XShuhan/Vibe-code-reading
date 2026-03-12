/**
 * Main application entry point.
 * 
 * Demonstrates how the modules work together.
 */

import { createSession } from './auth';
import { placeOrder, getOrder, updateOrderStatus, OrderItem } from './order';

/**
 * Example workflow demonstrating the e-commerce API.
 */
export function runExampleWorkflow(): void {
  // 1. Create a user session
  const userToken = createSession('user-123');
  console.log('Session created:', userToken);

  // 2. Create some order items
  const items: OrderItem[] = [
    { productId: 'prod-1', quantity: 2, unitPrice: 29.99 },
    { productId: 'prod-2', quantity: 1, unitPrice: 49.99 }
  ];

  // 3. Place an order
  const order = placeOrder(userToken, items);
  console.log('Order placed:', order.id, 'Total:', order.totalAmount);

  // 4. Simulate order processing
  updateOrderStatus(order.id, 'pending_payment');
  updateOrderStatus(order.id, 'paid');
  updateOrderStatus(order.id, 'processing');

  // 5. Retrieve the order
  const retrieved = getOrder(order.id);
  console.log('Order status:', retrieved?.status);
}

// Run if executed directly
if (require.main === module) {
  runExampleWorkflow();
}
