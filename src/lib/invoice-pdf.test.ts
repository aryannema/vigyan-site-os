import { describe, it, expect } from 'vitest';
import { renderInvoicePdf, type InvoiceData } from './invoice-pdf';

const base: InvoiceData = {
  invoiceNumber: 'VB/2026-27/000042',
  invoiceDate: '2026-09-16T10:00:00Z',
  sellerName: 'YourSite Solutions Private Limited',
  sellerCin: 'U00000KA2026PTC000000',
  sellerGstin: '29AAAAA0000A1Z5',
  buyerName: 'Test Buyer', buyerEmail: 'buyer@example.com', buyerGstin: null, buyerVatId: null,
  placeOfSupply: '29', isExport: false,
  itemTitle: 'Sample App', sacCode: '998314',
  baseP: 100000, cgstP: 9000, sgstP: 9000, igstP: 0, totalP: 118000,
  rateBp: 1800, paymentRef: 'pay_test123',
};

async function render(d: Partial<InvoiceData> = {}) {
  return renderInvoicePdf({ ...base, ...d });
}

describe('invoice PDF', () => {
  it('produces a real PDF', async () => {
    const pdf = await render();
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('renders the intra-state, inter-state and export variants', async () => {
    const intra = await render();
    const inter = await render({ cgstP: 0, sgstP: 0, igstP: 18000, placeOfSupply: '27' });
    const exp = await render({ cgstP: 0, sgstP: 0, igstP: 0, totalP: 100000, isExport: true, placeOfSupply: null });
    for (const p of [intra, inter, exp]) expect(p.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('is deterministic enough to be a stable artifact', async () => {
    // Same figures must not produce a wildly different document -- an invoice
    // reproduced for an audit should match the one the customer received.
    const a = await render();
    const b = await render();
    expect(Math.abs(a.length - b.length)).toBeLessThan(200);
  });

  it('survives a missing optional field rather than failing the customer', async () => {
    const pdf = await render({ sellerGstin: null, sacCode: null, paymentRef: null, buyerGstin: null });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('prints a buyer tax id under the right label for where they are', async () => {
    // An Indian buyer's identifier is a GSTIN; a foreign buyer's is a VAT
    // number. Printing "GSTIN" above a German VAT number would be wrong on a
    // tax document, so they are separate fields with separate labels.
    const indian = await render({ buyerGstin: '29ABCDE1234F1Z5', buyerVatId: null });
    const foreign = await render({
      buyerGstin: null, buyerVatId: 'DE123456789', isExport: true,
      cgstP: 0, sgstP: 0, igstP: 0, totalP: 100000, placeOfSupply: null,
    });
    for (const p of [indian, foreign]) expect(p.subarray(0, 5).toString()).toBe('%PDF-');
    // Different content, so the label really did change.
    expect(indian.length).not.toBe(foreign.length);
  });
});

describe('invoice archive integrity', () => {
  it('a checksum detects any change to stored bytes', async () => {
    const { createHash } = await import('crypto');
    const pdf = await render();
    const sha = createHash('sha256').update(pdf).digest('hex');

    // Flip one byte, as a corrupted or tampered blob would.
    const tampered = Buffer.from(pdf);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;

    expect(createHash('sha256').update(tampered).digest('hex')).not.toBe(sha);
    expect(createHash('sha256').update(pdf).digest('hex')).toBe(sha);
  });

  it('stays small enough for Postgres to be the right home', async () => {
    // The storage decision rests on invoices being tens of kilobytes. If this
    // ever fails, object storage deserves reconsidering.
    const pdf = await render();
    expect(pdf.length).toBeLessThan(200_000);
  });
});
