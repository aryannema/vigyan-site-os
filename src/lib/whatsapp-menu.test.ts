import { describe, it, expect } from 'vitest';
import { truncate, productRows, accountRows, buildSections, slugFromRowId, MENU_LIMITS, type MenuProduct } from './whatsapp-menu';

const ALL = { ask: true, verify: true, human: true, delete: true };

import type { PriceRow } from './price-display';

const price = (o: Partial<PriceRow> = {}): PriceRow => ({
  id: 'pr', nickname: 'Standard', price_model: 'fixed', amount_minor: 99900, currency: 'INR',
  billing_period: 'one_time', interval_count: 1, unit: 'flat', min_units: null,
  sort_order: 0, is_default: true, ...o,
});

const p = (over: Partial<MenuProduct> = {}): MenuProduct => ({
  slug: 'blueprint', title: 'Agentic Blueprint', product_type: 'blueprint',
  prices: [price()], ...over,
});

describe('truncate', () => {
  it('leaves short strings alone', () => {
    expect(truncate('Products', 24)).toBe('Products');
  });
  it('never exceeds the limit — Meta REJECTS an over-long row', () => {
    const long = 'An extremely long product title that nobody would sensibly write';
    expect(truncate(long, 24).length).toBeLessThanOrEqual(24);
  });
  it('handles empty and whitespace without throwing', () => {
    expect(truncate('', 24)).toBe('');
    expect(truncate('   ', 24)).toBe('');
  });
});

describe('productRows', () => {
  it('builds a row per product, priced', () => {
    const rows = productRows([p()], 10);
    expect(rows[0].id).toBe('P:blueprint');
    expect(rows[0].title).toBe('Agentic Blueprint');
    expect(rows[0].description).toContain('₹999');
  });

  it('says Free at zero, and Talk to us when there is no priced row', () => {
    expect(productRows([p({ prices: [price({ amount_minor: 0 })] })], 10)[0].description).toContain('Free');
    expect(productRows([p({ prices: [] })], 10)[0].description).toContain('Talk to us');
  });

  it('respects the row budget', () => {
    const many = Array.from({ length: 20 }, (_, i) => p({ slug: `s${i}` }));
    expect(productRows(many, 6)).toHaveLength(6);
    expect(productRows(many, 0)).toHaveLength(0);
  });

  it('keeps every field inside Meta limits, however long the title', () => {
    const rows = productRows([p({ title: 'A'.repeat(200), product_type: 'saas' })], 10);
    expect(rows[0].title.length).toBeLessThanOrEqual(MENU_LIMITS.titleChars);
    expect(rows[0].description!.length).toBeLessThanOrEqual(MENU_LIMITS.descriptionChars);
  });
});

describe('buildSections', () => {
  it('always includes the opt-out and the deletion request', () => {
    // These must survive whatever the catalogue does. Losing "Stop messages"
    // because products grew would be the worst possible truncation.
    for (const products of [[], [p()], Array.from({ length: 50 }, (_, i) => p({ slug: `s${i}` }))]) {
      const ids = buildSections(products, ALL).flatMap((s) => s.rows.map((r) => r.id));
      expect(ids).toContain('STOP');
      expect(ids).toContain('DELETE');
    }
  });

  it('never exceeds Meta\'s TOTAL row cap across all sections', () => {
    const many = Array.from({ length: 50 }, (_, i) => p({ slug: `s${i}` }));
    const total = buildSections(many, ALL).reduce((n, s) => n + s.rows.length, 0);
    expect(total).toBeLessThanOrEqual(MENU_LIMITS.maxRows);
  });

  it('omits the catalogue section entirely when nothing is on sale', () => {
    // An empty section is a rejected payload, not an empty-looking menu.
    const sections = buildSections([], ALL);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Your account');
    // Every section must carry rows: Meta rejects a payload containing an
    // empty section, so the whole menu would fail to send.
    expect(sections.every((sec) => sec.rows.length > 0)).toBe(true);
  });

  it('puts products first, account actions last', () => {
    const sections = buildSections([p()], ALL);
    expect(sections[0].title).toBe('What we sell');
    expect(sections[1].title).toBe('Your account');
  });
});

describe('slugFromRowId', () => {
  it('resolves a product tap back to its slug', () => {
    expect(slugFromRowId('P:sample-app')).toBe('sample-app');
  });
  it('does not mistake a command for a product', () => {
    for (const id of ['STOP', 'DELETE', 'VERIFY', 'HUMAN', 'P:', '']) {
      expect(slugFromRowId(id)).toBeNull();
    }
  });
});

describe('admin toggles', () => {
  it('omits a row the operator disabled', () => {
    const ids = (t: Parameters<typeof accountRows>[0]) => accountRows(t).map((r) => r.id);
    expect(ids({ ...ALL, ask: false })).not.toContain('ASK');
    expect(ids({ ...ALL, verify: false })).not.toContain('VERIFY');
    expect(ids({ ...ALL, human: false })).not.toContain('HUMAN');
    expect(ids({ ...ALL, delete: false })).not.toContain('DELETE');
  });

  it('KEEPS the opt-out even with everything switched off', () => {
    // An opt-out an operator can disable is not an opt-out. This is the test
    // that must never be "fixed" by making STOP configurable.
    const rows = accountRows({});
    expect(rows.map((r) => r.id)).toEqual(['STOP']);
  });

  it('still produces a sendable menu when every optional row is off', () => {
    // Meta rejects a payload with an empty section, so the whole menu would
    // fail to send rather than look sparse.
    const sections = buildSections([], {});
    expect(sections.every((sec) => sec.rows.length > 0)).toBe(true);
    expect(sections.flatMap((sec) => sec.rows).length).toBeGreaterThan(0);
  });

  it('gives freed-up row budget back to the catalogue', () => {
    const many = Array.from({ length: 20 }, (_, i) => p({ slug: `s${i}` }));
    const full = buildSections(many, ALL).reduce((n, sec) => n + sec.rows.length, 0);
    const lean = buildSections(many, {}).reduce((n, sec) => n + sec.rows.length, 0);
    expect(full).toBeLessThanOrEqual(MENU_LIMITS.maxRows);
    expect(lean).toBeLessThanOrEqual(MENU_LIMITS.maxRows);
    // Fewer account rows must mean MORE products shown, not a shorter menu.
    const leanProducts = buildSections(many, {})[0].rows.length;
    const fullProducts = buildSections(many, ALL)[0].rows.length;
    expect(leanProducts).toBeGreaterThan(fullProducts);
  });
});
