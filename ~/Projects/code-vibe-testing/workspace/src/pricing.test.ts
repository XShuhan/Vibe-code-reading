import { calculatePricing, applyDiscounts, getDiscountPercent } from './pricing';

describe('Pricing Module', () => {
  describe('calculatePricing', () => {
    it('calculates subtotal correctly', () => {
      const items = [
        { quantity: 2, unitPrice: 10 },
        { quantity: 1, unitPrice: 25 }
      ];
      expect(calculatePricing(items)).toBe(45);
    });

    it('returns 0 for empty items', () => {
      expect(calculatePricing([])).toBe(0);
    });
  });

  describe('applyDiscounts', () => {
    it('applies 15% discount for 10+ items', () => {
      const result = applyDiscounts(100, 10);
      expect(result).toBe(85);
    });

    it('applies 10% discount for 5-9 items', () => {
      const result = applyDiscounts(100, 5);
      expect(result).toBe(90);
    });

    it('applies 5% discount for 3-4 items', () => {
      const result = applyDiscounts(100, 3);
      expect(result).toBe(95);
    });

    it('applies no discount for < 3 items', () => {
      const result = applyDiscounts(100, 2);
      expect(result).toBe(100);
    });

    it('returns 0 for zero subtotal', () => {
      expect(applyDiscounts(0, 5)).toBe(0);
    });
  });

  describe('getDiscountPercent', () => {
    it('returns correct discount percentages', () => {
      expect(getDiscountPercent(10)).toBe(15);
      expect(getDiscountPercent(5)).toBe(10);
      expect(getDiscountPercent(3)).toBe(5);
      expect(getDiscountPercent(1)).toBe(0);
    });
  });
});
