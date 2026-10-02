import { describe, it, expect } from 'vitest';
import { parseAttribution } from './attribution';

describe('parseAttribution', () => {
  it('keeps the four known campaign fields', () => {
    expect(parseAttribution(JSON.stringify({
      link_slug: 'diwali', utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'diwali-2026',
    }))).toEqual({
      link_slug: 'diwali', utm_source: 'linkedin', utm_medium: 'social', utm_campaign: 'diwali-2026',
    });
  });

  it('drops anything it was not asked for', () => {
    // The cookie is attacker-controlled and this object is spread into an
    // orders row. An extra key must never reach the insert.
    expect(parseAttribution(JSON.stringify({
      utm_source: 'x', user_id: 'someone-else', amount_paise: 1, status: 'paid',
    }))).toEqual({ utm_source: 'x' });
  });

  it('rejects non-strings and over-long values', () => {
    expect(parseAttribution(JSON.stringify({ utm_source: 12345 }))).toEqual({});
    expect(parseAttribution(JSON.stringify({ utm_source: { a: 1 } }))).toEqual({});
    expect(parseAttribution(JSON.stringify({ utm_source: 'x'.repeat(201) }))).toEqual({});
    expect(parseAttribution(JSON.stringify({ utm_source: 'x'.repeat(200) }))).toEqual({ utm_source: 'x'.repeat(200) });
  });

  it('returns empty rather than throwing on junk', () => {
    // A mangled cookie must cost the buyer their attribution, never their order.
    for (const junk of ['', 'not json', '[]', 'null', '"a string"', '123', undefined]) {
      expect(parseAttribution(junk as string | undefined)).toEqual({});
    }
  });

  it('treats a direct visit as unattributed, not an error', () => {
    expect(parseAttribution(undefined)).toEqual({});
  });
});
