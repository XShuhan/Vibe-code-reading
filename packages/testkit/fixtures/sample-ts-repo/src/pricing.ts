/**
 * Pricing module.
 * 
 * Handles pricing calculations and discount logic.
 */

/**
 * Calculates the subtotal for a list of items.
 * 
 * @param items - The order items
 * @returns The subtotal amount
 */
export function calculatePricing(items: { quantity: number; unitPrice: number }[]): number {
  return items.reduce((total, item) => total + item.quantity * item.unitPrice, 0);
}

/**
 * Applies discounts based on order size.
 * 
 * @param subtotal - The order subtotal
 * @param itemCount - Number of items in the order
 * @returns The final amount after discounts
 */
export function applyDiscounts(subtotal: number, itemCount: number): number {
  // Bulk discount: 10% off for 5+ items
  if (itemCount >= 5) {
    return subtotal * 0.9;
  }
  return subtotal;
}
