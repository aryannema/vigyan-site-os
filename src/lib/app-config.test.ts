import { describe, it, expect } from 'vitest';
import { cfgBool, cfgString, cfgNumber } from './app-config';

/**
 * app_config.value is JSONB, so a read returns a real JS value — `true`, not
 * `"true"`. These guard the coercion, because the failure mode is silent: a
 * boolean compared against a string is simply false, and the caller gets the
 * fallback behaviour without any error.
 */
describe('app_config coercion', () => {
  it('reads a real JSON boolean', () => {
    expect(cfgBool(true, false)).toBe(true);
    expect(cfgBool(false, true)).toBe(false);
  });

  it('still accepts a stringified boolean, for older rows', () => {
    expect(cfgBool('true', false)).toBe(true);
    expect(cfgBool('false', true)).toBe(false);
  });

  it('falls back on anything else rather than guessing', () => {
    expect(cfgBool(null, true)).toBe(true);
    expect(cfgBool(undefined, false)).toBe(false);
    expect(cfgBool(42, true)).toBe(true);
  });

  it('keeps a state code as a string, leading zero intact', () => {
    // 09 is Uttar Pradesh. As a number it becomes 9 and never matches a
    // buyer's '09' again — charging IGST to someone in our own state.
    expect(cfgString('09', '29')).toBe('09');
    expect(cfgString('29', '01')).toBe('29');
  });

  it('falls back on an empty or missing string', () => {
    expect(cfgString('', '29')).toBe('29');
    expect(cfgString(null, '29')).toBe('29');
    expect(cfgString(undefined, '29')).toBe('29');
  });

  it('stringifies a number that should have been a string', () => {
    // A row stored as a JSON number rather than a string still resolves,
    // though the leading zero is already gone by then.
    expect(cfgString(29, '01')).toBe('29');
  });

  it('reads numbers, falling back on anything unparseable', () => {
    expect(cfgNumber(5000, 0)).toBe(5000);
    expect(cfgNumber('5000', 0)).toBe(5000);
    expect(cfgNumber(0, 200)).toBe(0);        // a real zero is a real value
    expect(cfgNumber('abc', 200)).toBe(200);
  });

  it('does NOT turn a missing value into zero', () => {
    // Number(null) is 0 and 0 is finite, so a naive check would return 0 here.
    // For pricing_min_net_paise that would mean no floor at all — every product
    // sellable at any price, silently.
    for (const missing of [null, undefined, '', false, true]) {
      expect(cfgNumber(missing, 200)).toBe(200);
    }
  });
});
