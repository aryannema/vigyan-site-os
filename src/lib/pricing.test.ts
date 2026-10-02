import { describe, it, expect } from 'vitest';
import { priceState, percentToBp, bpToPercent, type Priceable } from './pricing';

const NOW = new Date('2026-09-16T12:00:00Z');
const LIVE = '2026-09-20T00:00:00Z';
const PAST = '2026-09-15T00:00:00Z';
const base: Priceable = {
  price_paise: 99900, discount_bp: null, offer_ends_at: null, offer_label: null,
};

describe('offer pricing', () => {
  it('charges the standard price with no offer', () => {
    const s = priceState(base, NOW);
    expect(s.effectiveP).toBe(99900);
    expect(s.offerActive).toBe(false);
  });

  it('applies a live percentage discount', () => {
    const s = priceState({ ...base, discount_bp: 2500, offer_ends_at: LIVE, offer_label: 'Launch offer' }, NOW);
    expect(s.discountPercent).toBe(25);
    expect(s.savedP).toBe(24975);
    expect(s.effectiveP).toBe(74925);
    expect(s.offerLabel).toBe('Launch offer');
  });

  it('reverts to the standard price after the deadline, with no action needed', () => {
    const s = priceState({ ...base, discount_bp: 2500, offer_ends_at: PAST }, NOW);
    expect(s.effectiveP).toBe(99900);
    expect(s.offerActive).toBe(false);
    expect(s.savedP).toBe(0);
  });

  it('expires exactly at the deadline, not after it', () => {
    const s = priceState({ ...base, discount_bp: 2500, offer_ends_at: '2026-09-16T12:00:00Z' }, NOW);
    expect(s.offerActive).toBe(false);
  });

  it('ignores a discount with no deadline — that is a price change, not an offer', () => {
    expect(priceState({ ...base, discount_bp: 2500, offer_ends_at: null }, NOW).offerActive).toBe(false);
  });

  it('handles a fractional percentage without floats in the result', () => {
    const s = priceState({ ...base, discount_bp: 1250, offer_ends_at: LIVE }, NOW);
    expect(Number.isInteger(s.effectiveP)).toBe(true);
    expect(Number.isInteger(s.savedP)).toBe(true);
    expect(s.savedP).toBe(12488); // 12.5% of 99900 = 12487.5, rounded
  });

  it('always balances: saving plus charged equals standard, at any price or rate', () => {
    for (const price of [1, 99, 100, 999, 99900, 123457, 10000000]) {
      for (const bp of [1, 250, 1250, 2500, 5000, 9999, 10000]) {
        const s = priceState({ ...base, price_paise: price, discount_bp: bp, offer_ends_at: LIVE }, NOW);
        expect(s.effectiveP + s.savedP).toBe(price);
        expect(s.effectiveP).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('allows 100% off', () => {
    const s = priceState({ ...base, discount_bp: 10000, offer_ends_at: LIVE }, NOW);
    expect(s.effectiveP).toBe(0);
    expect(s.discountPercent).toBe(100);
  });

  it('converts between the admin percentage and stored basis points', () => {
    expect(percentToBp('25')).toBe(2500);
    expect(percentToBp('12.5')).toBe(1250);
    expect(bpToPercent(2500)).toBe('25');
    expect(bpToPercent(1250)).toBe('12.5');
  });
});
