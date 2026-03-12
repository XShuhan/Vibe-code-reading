import { placeOrder, getOrder, updateOrderStatus, cancelOrder, OrderItem } from './order';
import { createSession } from './auth';

describe('Order Module', () => {
  let userToken: string;

  beforeEach(() => {
    userToken = createSession('test-user');
  });

  describe('placeOrder', () => {
    it('creates an order with valid items', () => {
      const items: OrderItem[] = [
        { productId: 'prod-1', quantity: 2, unitPrice: 10 }
      ];
      
      const order = placeOrder(userToken, items);
      
      expect(order.id).toBeTruthy();
      expect(order.userId).toBe('test-user');
      expect(order.status).toBe('created');
      expect(order.items).toHaveLength(1);
    });

    it('throws error for empty items', () => {
      expect(() => placeOrder(userToken, [])).toThrow('Order must contain at least one item');
    });

    it('throws error for invalid session', () => {
      const items: OrderItem[] = [{ productId: 'prod-1', quantity: 1, unitPrice: 10 }];
      expect(() => placeOrder('invalid-token', items)).toThrow('Invalid or expired session');
    });

    it('applies volume discounts', () => {
      const items: OrderItem[] = [
        { productId: 'prod-1', quantity: 5, unitPrice: 10 }
      ];
      
      const order = placeOrder(userToken, items);
      // 5 items = 10% discount: 50 * 0.9 = 45
      expect(order.totalAmount).toBe(45);
    });
  });

  describe('getOrder', () => {
    it('returns order by id', () => {
      const items: OrderItem[] = [{ productId: 'prod-1', quantity: 1, unitPrice: 10 }];
      const order = placeOrder(userToken, items);
      
      const retrieved = getOrder(order.id);
      expect(retrieved?.id).toBe(order.id);
    });

    it('returns undefined for non-existent order', () => {
      const retrieved = getOrder('non-existent');
      expect(retrieved).toBeUndefined();
    });
  });

  describe('updateOrderStatus', () => {
    it('updates status for valid transition', () => {
      const items: OrderItem[] = [{ productId: 'prod-1', quantity: 1, unitPrice: 10 }];
      const order = placeOrder(userToken, items);
      
      const updated = updateOrderStatus(order.id, 'pending_payment');
      expect(updated?.status).toBe('pending_payment');
    });

    it('throws error for invalid transition', () => {
      const items: OrderItem[] = [{ productId: 'prod-1', quantity: 1, unitPrice: 10 }];
      const order = placeOrder(userToken, items);
      
      expect(() => updateOrderStatus(order.id, 'delivered')).toThrow('Invalid status transition');
    });
  });

  describe('cancelOrder', () => {
    it('cancels a new order', () => {
      const items: OrderItem[] = [{ productId: 'prod-1', quantity: 1, unitPrice: 10 }];
      const order = placeOrder(userToken, items);
      
      const cancelled = cancelOrder(order.id);
      expect(cancelled).toBe(true);
      expect(getOrder(order.id)?.status).toBe('cancelled');
    });

    it('returns false for non-existent order', () => {
      const result = cancelOrder('non-existent');
      expect(result).toBe(false);
    });
  });
});
