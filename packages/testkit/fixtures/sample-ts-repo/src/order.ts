/**
 * Order processing module.
 * 
 * Handles order creation, validation, and lifecycle management.
 * Depends on the auth module for session validation.
 */

import { createSession, validateSession } from './auth';
import { calculatePricing, applyDiscounts } from './pricing';
import { sendNotification } from './notifications';

/** Order status enum */
export type OrderStatus = 'created' | 'pending_payment' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'cancelled';

/** Order item structure */
export interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: number;
}

/** Order structure */
export interface Order {
  id: string;
  userId: string;
  items: OrderItem[];
  status: OrderStatus;
  totalAmount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** In-memory order store (use database in production) */
const orders = new Map<string, Order>();

/**
 * Places a new order for the authenticated user.
 * 
 * This function:
 * 1. Validates the user's session
 * 2. Calculates pricing with discounts
 * 3. Creates the order record
 * 4. Sends confirmation notification
 * 
 * @param userToken - The user's session token
 * @param items - The items to order
 * @returns The created order
 * @throws Error if session is invalid or items are empty
 */
export function placeOrder(userToken: string, items: OrderItem[]): Order {
  // Validate session
  const userId = validateSession(userToken);
  if (!userId) {
    throw new Error('Invalid or expired session');
  }

  // Validate items
  if (!items || items.length === 0) {
    throw new Error('Order must contain at least one item');
  }

  for (const item of items) {
    if (item.quantity <= 0) {
      throw new Error(`Invalid quantity for product ${item.productId}`);
    }
    if (item.unitPrice < 0) {
      throw new Error(`Invalid price for product ${item.productId}`);
    }
  }

  // Calculate totals
  const subtotal = calculatePricing(items);
  const totalAmount = applyDiscounts(subtotal, items.length);

  // Create order
  const order: Order = {
    id: generateOrderId(),
    userId,
    items: [...items],
    status: 'created',
    totalAmount,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  orders.set(order.id, order);

  // Send notification
  sendNotification(userId, 'order_created', {
    orderId: order.id,
    totalAmount: order.totalAmount
  });

  return order;
}

/**
 * Retrieves an order by ID.
 * 
 * @param orderId - The order ID
 * @returns The order or undefined if not found
 */
export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}

/**
 * Updates the status of an order.
 * 
 * @param orderId - The order to update
 * @param newStatus - The new status
 * @returns The updated order or undefined if not found
 */
export function updateOrderStatus(orderId: string, newStatus: OrderStatus): Order | undefined {
  const order = orders.get(orderId);
  if (!order) {
    return undefined;
  }

  // Validate status transition
  if (!isValidStatusTransition(order.status, newStatus)) {
    throw new Error(`Invalid status transition from ${order.status} to ${newStatus}`);
  }

  order.status = newStatus;
  order.updatedAt = new Date();

  sendNotification(order.userId, 'order_status_changed', {
    orderId: order.id,
    status: newStatus
  });

  return order;
}

/**
 * Cancels an order if it's in a cancellable state.
 * 
 * @param orderId - The order to cancel
 * @returns true if cancelled, false if not found
 * @throws Error if order cannot be cancelled
 */
export function cancelOrder(orderId: string): boolean {
  const order = orders.get(orderId);
  if (!order) {
    return false;
  }

  const cancellableStatuses: OrderStatus[] = ['created', 'pending_payment'];
  if (!cancellableStatuses.includes(order.status)) {
    throw new Error(`Cannot cancel order in ${order.status} status`);
  }

  order.status = 'cancelled';
  order.updatedAt = new Date();

  sendNotification(order.userId, 'order_cancelled', {
    orderId: order.id
  });

  return true;
}

/**
 * Generates a unique order ID.
 * In production, use UUID or database sequence.
 */
function generateOrderId(): string {
  return `ord-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Validates if a status transition is allowed.
 */
function isValidStatusTransition(current: OrderStatus, next: OrderStatus): boolean {
  const transitions: Record<OrderStatus, OrderStatus[]> = {
    'created': ['pending_payment', 'cancelled'],
    'pending_payment': ['paid', 'cancelled'],
    'paid': ['processing', 'cancelled'],
    'processing': ['shipped'],
    'shipped': ['delivered'],
    'delivered': [],
    'cancelled': []
  };

  return transitions[current]?.includes(next) ?? false;
}
