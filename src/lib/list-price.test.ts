import { describe, it, expect } from 'vitest';
import { listPriceForTargetNet } from './margin';

const rates = { gstRateBp: 1800, gatewayFeeBp: 200, gatewayFeeGstBp: 1800, hostingPerSalePaise: 50 };

describe('listPriceForTargetNet', () => {
  it('still earns the target AFTER the advertised discount', () => {
    // The whole point. Set a 20% off sticker and keep ₹500 regardless.
    const r = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 2000, ...rates });
    expect(r.achievedNetPaise).toBeGreaterThanOrEqual(50000);
  });

  it('hits the target at every discount depth', () => {
    for (const bp of [0, 500, 1000, 2500, 5000, 7500, 9000]) {
      const r = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: bp, ...rates });
      expect(r.achievedNetPaise, `${bp}bp`).toBeGreaterThanOrEqual(50000);
      // And never wildly overshoots -- within a rupee of the target.
      expect(r.achievedNetPaise, `${bp}bp`).toBeLessThan(50000 + 100);
    }
  });

  it('inflates the list price as the discount deepens', () => {
    const none = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 0, ...rates });
    const half = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 5000, ...rates });
    expect(half.listPricePaise).toBeGreaterThan(none.listPricePaise);
    // 50% off must roughly double the list price.
    expect(half.listPricePaise).toBeGreaterThan(none.listPricePaise * 1.9);
  });

  it('charges the same regardless of discount — only the sticker changes', () => {
    // What the customer PAYS is driven by what we need to earn, not by the
    // discount. The discount only inflates the crossed-out number.
    const a = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 0, ...rates });
    const b = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 4000, ...rates });
    expect(Math.abs(a.chargedPaise - b.chargedPaise)).toBeLessThan(200);
  });

  it('reports the saving the customer sees', () => {
    const r = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 2500, ...rates });
    expect(r.savedPaise + r.chargedPaise).toBe(r.listPricePaise);   // must always hold
    expect(r.savedPaise).toBeGreaterThan(0);
  });

  it('a zero discount equals the plain gross-up', () => {
    const r = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 0, ...rates });
    expect(r.listPricePaise).toBe(r.undiscountedPricePaise);
  });

  it('clamps an absurd discount rather than dividing by zero', () => {
    const r = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 10000, ...rates });
    expect(Number.isFinite(r.listPricePaise)).toBe(true);
    expect(r.listPricePaise).toBeGreaterThan(0);
  });

  it('works for an export, where there is no GST to hand over', () => {
    const r = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 2000, ...rates, gstRateBp: 0 });
    expect(r.achievedNetPaise).toBeGreaterThanOrEqual(50000);
    // No tax means a lower list price for the same take-home.
    const withGst = listPriceForTargetNet({ targetNetPaise: 50000, discountBp: 2000, ...rates });
    expect(r.listPricePaise).toBeLessThan(withGst.listPricePaise);
  });

  it('returns whole paise', () => {
    const r = listPriceForTargetNet({ targetNetPaise: 33333, discountBp: 1700, ...rates });
    for (const v of [r.listPricePaise, r.chargedPaise, r.savedPaise, r.achievedNetPaise]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
