import { describe, it, expect } from 'vitest';
import { isProfileComplete } from './site-accounts';

const filled = {
  first_name: 'A',
  last_name: 'B',
  whatsapp_verified_at: '2026-09-16T00:00:00Z',
  billing_country: 'IN',
  billing_state_code: '29',
};

describe('isProfileComplete', () => {
  it('accepts a fully filled profile', () => {
    expect(isProfileComplete(filled)).toBe(true);
  });

  it('rejects a missing name or an unverified number', () => {
    expect(isProfileComplete({ ...filled, first_name: null })).toBe(false);
    expect(isProfileComplete({ ...filled, last_name: null })).toBe(false);
    expect(isProfileComplete({ ...filled, whatsapp_verified_at: null })).toBe(false);
  });

  it('rejects an Indian account with no state — it cannot be taxed correctly', () => {
    expect(isProfileComplete({ ...filled, billing_state_code: null })).toBe(false);
  });

  it('accepts a foreign account with no state, which decides nothing there', () => {
    expect(
      isProfileComplete({ ...filled, billing_country: 'US', billing_state_code: null }),
    ).toBe(true);
  });

  it('treats a missing country as India, so old rows are asked rather than assumed complete', () => {
    // Accounts created before the column existed have null here. Defaulting to
    // India means they get prompted, which is the safe direction: assuming they
    // were complete would tax them against our own state indefinitely.
    const legacy = {
      first_name: 'A',
      last_name: 'B',
      whatsapp_verified_at: '2026-01-01T00:00:00Z',
    };
    expect(isProfileComplete(legacy)).toBe(false);
  });

  it('rejects a null account', () => {
    expect(isProfileComplete(null)).toBe(false);
    expect(isProfileComplete(undefined)).toBe(false);
  });
});
