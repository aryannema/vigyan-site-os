import { describe, it, expect } from 'vitest';
import { validateCompany, formatAddress, COMPANY_FALLBACK } from './company';

const valid = {
  legal_name: 'Your Company Private Limited',
  brand_name: 'YourSite',
  gstin: '29AAAAA0000A1Z5',
  cin: 'U00000KA2026PTC000000',
  state_code: '29',
  country: 'IN',
};

describe('company validation', () => {
  it('accepts the real details', () => {
    expect(validateCompany(valid)).toEqual({});
  });

  it('requires both names, because invoices and pages need each', () => {
    expect(validateCompany({ ...valid, legal_name: '' }).legal_name).toBeTruthy();
    expect(validateCompany({ ...valid, brand_name: '  ' }).brand_name).toBeTruthy();
  });

  it('rejects a GSTIN whose state disagrees with the address', () => {
    // The first two digits of a GSTIN ARE the state code. A mismatch means one
    // of them is wrong and there is no way to tell which.
    const e = validateCompany({ ...valid, state_code: '27' });
    expect(e.gstin).toMatch(/state 29.*27/);
  });

  it('rejects a malformed GSTIN, CIN or PAN', () => {
    expect(validateCompany({ ...valid, gstin: '29ABC' }).gstin).toBeTruthy();
    expect(validateCompany({ ...valid, cin: 'NOTACIN' }).cin).toBeTruthy();
    expect(validateCompany({ ...valid, pan: 'BAD' }).pan).toBeTruthy();
  });

  it('allows a company with no GST registration yet', () => {
    // A business setting its address before registering must not be blocked.
    expect(validateCompany({ legal_name: 'X Pvt Ltd', brand_name: 'X' })).toEqual({});
  });

  it('checks an Indian PIN code only for India', () => {
    expect(validateCompany({ ...valid, postal_code: '560001' }).postal_code).toBeUndefined();
    expect(validateCompany({ ...valid, postal_code: '012345' }).postal_code).toBeTruthy();
    expect(validateCompany({ ...valid, country: 'US', postal_code: '94105' }).postal_code).toBeUndefined();
  });

  it('rejects an embed URL that is not an embed', () => {
    // A share link in the embed field renders a broken frame, which reads as a
    // site fault rather than a mistyped setting.
    expect(validateCompany({ ...valid, map_embed_url: 'https://maps.app.goo.gl/abc' }).map_embed_url)
      .toMatch(/Embed a map/);
    expect(validateCompany({ ...valid, map_embed_url: 'https://www.google.com/maps/embed?pb=x' }).map_embed_url)
      .toBeUndefined();
  });

  it('rejects a URL with no scheme', () => {
    expect(validateCompany({ ...valid, map_link_url: 'maps.google.com' }).map_link_url).toBeTruthy();
  });

  it('formats an address from whatever parts exist', () => {
    expect(formatAddress(COMPANY_FALLBACK)).toBe('Your City, India');
    expect(formatAddress({ ...COMPANY_FALLBACK, address_line1: '12 MG Road', postal_code: '560001' }))
      .toBe('12 MG Road, Your City, 560001, India');
    // The country must survive a full address, not only an empty one.
    expect(formatAddress({ ...COMPANY_FALLBACK, country: 'US', city: 'Austin' })).toBe('Austin, US');
  });
});
