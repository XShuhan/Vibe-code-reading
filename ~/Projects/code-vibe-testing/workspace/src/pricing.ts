/**
 * Pricing and discount calculation module.
 * 
 * Handles all pricing logic including bulk discounts and promotions.
 */

/** Discount tier based on order size */
interface DiscountTier {
  minItems: number;
  discountPercent: number;
}

/** Default discount tiers */
const DISCOUNT_TIERS: DiscountTier[] = [
  { minItems: 10, discountPercent: 15 },
  { minItems: 5, discountPercent: 10 },
  { minItems: 3, discountPercent: 5 }
];

/**
 * Calculates the subtotal for a set of items.
 * 
 * @param items - The items to calculate pricing for
 * @returns The subtotal before discounts
 */
export function calculatePricing(items: { quantity: number; unitPrice: number }[]): number {
  return items.reduce((total, item) => {
    return total + item.quantity * item.unitPrice;
  }, 0);
}

/**
 * Applies volume discounts based on item count.
 * 
 * Discount tiers:
 * - 10+ items: 15% off
 * - 5-9 items: 10% off
 * - 3-4 items: 5% off
 * - < 3 items: no discount
 * 
 * @param subtotal - The amount before discount
 * @param itemCount - Total number of items
 * @returns The amount after discount
 */
export function applyDiscounts(subtotal: number, itemCount: number): number {
  if (subtotal <= 0 || itemCount <= 0) {
    return 0;
  }

  const tier = DISCOUNT_TIERS.find(t => itemCount >= t.minItems);
  
  if (!tier) {
    return subtotal;
  }

  const discountAmount = subtotal * (tier.discountPercent / 100);
  return Math.round((subtotal - discountAmount) * 100) / 100;
}

/**
 * Calculates the discount percentage for an order.
 * 
 * @param itemCount - Number of items
 * @returns The discount percentage (0-100)
 */
export function getDiscountPercent(itemCount: number): number {
  const tier = DISCOUNT_TIERS.find(t => itemCount >= t.minItems);
  return tier?.discountPercent ?? 0;
}
