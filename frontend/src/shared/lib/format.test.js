import { afterEach, describe, expect, it } from 'vitest';
import { degRange, fromDisplay, inr, setDisplayCurrency, toDisplay } from './format.js';

describe('cooling range', () => {
  it('shows low to high, or one value when they match or nothing cools', () => {
    expect(degRange({ temp_reduction_c: 0.151, low_estimate: { temp_reduction_c: 0.025 } }, 'temp_reduction_c')).toBe('−0.03 to −0.15°');
    expect(degRange({ temp_reduction_c: 0.15 }, 'temp_reduction_c')).toBe('−0.15°');
    expect(degRange({ temp_reduction_c: 0, low_estimate: { temp_reduction_c: 0 } }, 'temp_reduction_c')).toBe('0.00°');
  });
});

describe('display currency', () => {
  afterEach(() => setDisplayCurrency('INR', 1));
  it('INR keeps Indian units', () => {
    expect(inr(4500)).toBe('₹4,500');
    expect(inr(2_000_000)).toBe('₹20 L');
    expect(inr(25_000_000)).toBe('₹2.5 Cr');
  });
  it('converts other currencies for display only', () => {
    setDisplayCurrency('USD', 0.0105);
    expect(inr(4500)).toBe('$47.25');
    expect(inr(2_000_000)).toBe('$21,000');
    expect(inr(100_000_000)).toBe('$1.05M');
    expect(fromDisplay(toDisplay(3000))).toBeCloseTo(3000, 6);
  });
  it('yen has no decimals', () => {
    setDisplayCurrency('JPY', 1.66);
    expect(inr(3000)).toBe('¥4,980');
  });
});
