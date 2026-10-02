import { describe, it, expect } from 'vitest';
import {
  PRODUCT_STATUSES, PRODUCT_TYPES, PRODUCT_TYPE_LABELS,
  isProductStatus, isProductType, isPubliclyVisible, defaultCtaLabel,
} from './product-types';

describe('product vocabulary', () => {
  it('matches the database CHECK constraints exactly', () => {
    // If these drift from the DB, writes fail at runtime with a constraint
    // violation that no type check would have caught.
    expect([...PRODUCT_STATUSES]).toEqual(['draft', 'active', 'archived']);
    expect([...PRODUCT_TYPES]).toEqual(['saas', 'one_off', 'blueprint', 'service', 'lead_magnet']);
  });

  it('rejects the status that does not exist', () => {
    // The actual bug this file was written to prevent.
    expect(isProductStatus('published')).toBe(false);
    expect(isPubliclyVisible('published')).toBe(false);
    expect(isPubliclyVisible('active')).toBe(true);
    expect(isPubliclyVisible('draft')).toBe(false);
  });

  it('guards against junk from the database or a form', () => {
    for (const v of [null, undefined, '', 'ACTIVE', 0, {}, []]) {
      expect(isProductStatus(v)).toBe(false);
      expect(isProductType(v)).toBe(false);
    }
  });

  it('labels every type — no type can render as a blank dropdown row', () => {
    for (const t of PRODUCT_TYPES) {
      expect(PRODUCT_TYPE_LABELS[t]).toBeTruthy();
    }
  });
});

describe('defaultCtaLabel', () => {
  it('asks for the offer when it is free, whatever the type', () => {
    for (const t of PRODUCT_TYPES) {
      expect(defaultCtaLabel(t, true)).toBe('Grab your offer');
    }
    expect(defaultCtaLabel('lead_magnet', false)).toBe('Grab your offer');
  });

  it('asks for the sale when there is a price', () => {
    expect(defaultCtaLabel('one_off', false)).toBe('Buy now');
    expect(defaultCtaLabel('blueprint', false)).toBe('Buy the blueprint');
    expect(defaultCtaLabel('saas', false)).toBe('Start your subscription');
    expect(defaultCtaLabel('service', false)).toBe('Book a call');
  });

  it('never returns an empty label', () => {
    for (const t of PRODUCT_TYPES) {
      for (const free of [true, false]) {
        expect(defaultCtaLabel(t, free).trim().length).toBeGreaterThan(0);
      }
    }
  });
});
