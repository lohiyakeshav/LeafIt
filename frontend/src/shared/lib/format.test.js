import { afterEach, describe, expect, it } from 'vitest';
import { fromDisplay, inr, setDisplayCurrency, toDisplay } from './format.js';

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
