import { describe, it, expect } from 'vitest';
import { isValidPhone } from './phone';

describe('isValidPhone', () => {
  it('rejects a number that cannot exist, however long it looks', () => {
    // Nine digits after +91; an Indian mobile has ten. Twelve characters, so
    // it passed every length check the app used to have.
    expect(isValidPhone('+91974079662')).toBe(false);
    expect(isValidPhone('+9197')).toBe(false);
    expect(isValidPhone('+1415555267')).toBe(false); // US, one short
    expect(isValidPhone('+4479111234')).toBe(false); // UK, too short
  });

  it('accepts real numbers across calling codes', () => {
    for (const n of [
      '+919740796621',
      '+919980766288',
      '+919000000001', // our WABA
      '+14155552671',
      '+447911123456',
      '+8613800138000',
      '+971501234567',
    ]) {
      expect(isValidPhone(n), n).toBe(true);
    }
  });

  it('requires E.164 — a bare national number has no country to validate against', () => {
    expect(isValidPhone('9740796621')).toBe(false);
    expect(isValidPhone('09740796621')).toBe(false);
  });

  it('rejects junk and non-strings rather than throwing', () => {
    for (const v of ['', '   ', 'not a phone', '+', '++91', null, undefined, 42, {}]) {
      expect(isValidPhone(v as unknown)).toBe(false);
    }
  });

  it('tolerates the spacing a human types', () => {
    expect(isValidPhone(' +91 97407 96621 ')).toBe(true);
  });
});
