import { describe, it, expect } from 'vitest';
import { validateFulfilment, deliveryTarget, isGated, FULFILMENT, FULFILMENT_KINDS } from './fulfilment';

describe('fulfilment', () => {
  it('describes every kind the database allows', () => {
    // The CHECK in migration 035 and this table must not drift.
    for (const k of FULFILMENT_KINDS) {
      expect(FULFILMENT[k]?.label, `missing meta for ${k}`).toBeTruthy();
      expect(FULFILMENT[k].description.length).toBeGreaterThan(10);
    }
  });

  it('refuses a kind whose config is missing', () => {
    expect(validateFulfilment('external_url', {})).toMatch(/needs url/);
    expect(validateFulfilment('github_release', { repo: 'x' })).toMatch(/needs tag/);
    expect(validateFulfilment('private_page', {})).toMatch(/needs path/);
    expect(validateFulfilment('short_link', {})).toMatch(/needs slug/);
  });

  it('accepts a complete config', () => {
    expect(validateFulfilment('external_url', { url: 'https://play.google.com/x' })).toBeNull();
    expect(validateFulfilment('github_release', { repo: 'a/b', tag: 'v1' })).toBeNull();
    expect(validateFulfilment('private_page', { path: '/library' })).toBeNull();
  });

  it('rejects a link that is not a link, and a path that is not a path', () => {
    expect(validateFulfilment('external_url', { url: 'play.google.com' })).toMatch(/http/);
    expect(validateFulfilment('private_page', { path: 'library' })).toMatch(/slash/);
  });

  it('requires an object key for an R2 file', () => {
    expect(validateFulfilment('r2_file', {})).toMatch(/key/);
    expect(validateFulfilment('r2_file', { key: 'sample-app/v1/setup.exe' })).toBeNull();
  });

  it('treats an R2 file as gated — the bucket is private and URLs expire', () => {
    expect(isGated('r2_file')).toBe(true);
  });

  it('needs no config for the kinds that carry none', () => {
    for (const k of ['none', 'hosted_file', 'physical', 'service'] as const) {
      expect(validateFulfilment(k, {})).toBeNull();
    }
  });

  it('requires a page id for a Notion-backed page', () => {
    expect(validateFulfilment('notion_page', {})).toMatch(/notion_page_id/);
    expect(validateFulfilment('notion_page', { notion_page_id: 'abc123' })).toBeNull();
  });

  it('marks the kinds that are NOT a gate', () => {
    // /go is a public redirect and an external URL is someone else's server.
    // Neither knows who is opening it.
    expect(isGated('short_link')).toBe(false);
    expect(isGated('external_url')).toBe(false);
    for (const k of ['hosted_file', 'private_page', 'notion_page'] as const) {
      expect(isGated(k)).toBe(true);
    }
  });

  it('routes paid assets through an entitlement-checked route, not a raw URL', () => {
    expect(deliveryTarget('hosted_file', {}, 'order-1')).toBe('/account/orders/order-1/download');
    expect(deliveryTarget('notion_page', { notion_page_id: 'x' }, 'order-1'))
      .toBe('/account/orders/order-1/download');
    expect(deliveryTarget('github_release', { repo: 'a/b', tag: 'v1' }, 'order-1'))
      .toBe('/account/orders/order-1/download');
  });

  it('sends the buyer straight on for public destinations', () => {
    expect(deliveryTarget('external_url', { url: 'https://x.com' }, 'o')).toBe('https://x.com');
    // The real route is /go/<slug> — src/app/go/[slug]/route.ts.
    expect(deliveryTarget('short_link', { slug: 'sample-app' }, 'o')).toBe('/go/sample-app');
  });

  it('has nothing automatic for manual kinds', () => {
    expect(deliveryTarget('none', {}, 'o')).toBeNull();
    expect(deliveryTarget('physical', {}, 'o')).toBeNull();
    expect(deliveryTarget('service', {}, 'o')).toBeNull();
  });
});
