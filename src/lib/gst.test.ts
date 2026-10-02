import { describe, it, expect } from 'vitest';
import { computeTax, stateCodeFromGstin } from './gst';

const base = { rateBp: 1800, sellerStateCode: '29', buyerCountry: 'IN', pricesIncludeTax: true };

describe('GST', () => {
  it('splits intra-state into equal CGST and SGST', () => {
    const r = computeTax({ ...base, priceP: 118000, buyerStateCode: '29' });
    expect(r.treatment).toBe('intra_state');
    expect(r.baseP).toBe(100000);
    expect(r.cgstP + r.sgstP).toBe(18000);
    expect(r.igstP).toBe(0);
  });

  it('charges IGST for another state', () => {
    const r = computeTax({ ...base, priceP: 118000, buyerStateCode: '27' });
    expect(r.treatment).toBe('inter_state');
    expect(r.igstP).toBe(18000);
    expect(r.cgstP).toBe(0);
  });

  it('zero-rates an export regardless of state', () => {
    const r = computeTax({ ...base, priceP: 118000, buyerStateCode: null, buyerCountry: 'US' });
    expect(r.treatment).toBe('export_zero_rated');
    expect(r.igstP).toBe(0);
    expect(r.totalP).toBe(118000);
  });

  it('falls back to the seller state when the buyer state is unknown', () => {
    const r = computeTax({ ...base, priceP: 118000, buyerStateCode: null });
    expect(r.treatment).toBe('intra_state');
  });

  it('adds tax on top when prices exclude it', () => {
    const r = computeTax({ ...base, priceP: 100000, buyerStateCode: '27', pricesIncludeTax: false });
    expect(r.baseP).toBe(100000);
    expect(r.igstP).toBe(18000);
    expect(r.totalP).toBe(118000);
  });

  it('always balances: parts re-add to the total, at any price', () => {
    for (const p of [1, 7, 99, 100, 333, 99999, 123457, 1000000]) {
      for (const st of ['29', '27']) {
        const r = computeTax({ ...base, priceP: p, buyerStateCode: st });
        expect(r.baseP + r.cgstP + r.sgstP + r.igstP).toBe(r.totalP);
        expect(r.totalP).toBe(p);
      }
    }
  });

  it('treats a zero rate as exempt', () => {
    const r = computeTax({ ...base, priceP: 50000, buyerStateCode: '29', rateBp: 0 });
    expect(r.treatment).toBe('exempt');
    expect(r.totalP).toBe(50000);
  });

  it('reads the state code out of a GSTIN', () => {
    expect(stateCodeFromGstin('29ABCDE1234F1Z5')).toBe('29');
    expect(stateCodeFromGstin('nonsense')).toBeNull();
    expect(stateCodeFromGstin(null)).toBeNull();
  });
});
