import { readFileSync } from 'fs';
import { join } from 'path';

import PDFDocument from 'pdfkit';
import SVGtoPDF from 'svg-to-pdfkit';

import { INDIAN_STATES } from '@/lib/gst';

/**
 * Invoice PDF, drawn server-side.
 *
 * Generated in Node rather than left to the browser's print dialog, because a
 * tax invoice is a document that gets emailed, archived and produced in an
 * audit -- and "whatever Chrome printed on that person's machine that day" is
 * not a stable artifact. Same input, same bytes, every time.
 *
 * pdfkit rather than a headless browser: ~1 MB of pure JS against ~300 MB of
 * Chromium in the container, for a page that is a header, a table and a totals
 * block.
 *
 * The brand mark goes in as VECTOR. svg-to-pdfkit draws the supplied SVG's own
 * paths straight into the PDF, so the file in public/brand is used exactly as
 * issued -- no raster export, no re-colouring, and it stays sharp at any zoom
 * or print size. That also keeps the brand rule intact: the asset is used as
 * supplied rather than converted.
 */

// Brand revision 4. Kept in sync with docs/brand/tokens.css.
const INK = '#1c1814';
const MUTED = '#6b6259';
const HAIRLINE = '#e2d9c8';
const SAFFRON = '#e8821a';

const rupees = (p: number) =>
  `INR ${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const stateName = (code: string | null) =>
  code ? (INDIAN_STATES.find((s) => s.code === code)?.name ?? code) : '—';

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  /** The registered supplier. Not the brand — a tax invoice names the entity. */
  sellerName: string;
  sellerGstin: string | null;
  /** Companies Act identifier. Required on a private limited company's documents. */
  sellerCin: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerGstin: string | null;
  /** A foreign buyer's VAT or local tax number, printed under its own label. */
  buyerVatId: string | null;
  placeOfSupply: string | null;
  isExport: boolean;
  itemTitle: string;
  sacCode: string | null;
  baseP: number;
  cgstP: number;
  sgstP: number;
  igstP: number;
  totalP: number;
  rateBp: number;
  paymentRef: string | null;
}

export function renderInvoicePdf(d: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 50;
    const right = 545;

    // ── Mark, as vector ──────────────────────────────────────────────────────
    try {
      const svg = readFileSync(join(process.cwd(), 'public/brand/mark-deep.svg'), 'utf8');
      SVGtoPDF(doc, svg, left, 42, { width: 34, height: 34, assumePt: false });
    } catch {
      // A missing asset must not cost the customer their invoice.
    }

    // The LEGAL ENTITY, not the brand. A tax invoice has to name the
    // registered supplier: "YourSite" is what we trade as, but the invoice
    // is issued by the company that holds the GSTIN and receives the money.
    doc.font('Helvetica-Bold').fontSize(13).fillColor(INK)
      .text(d.sellerName, left + 44, 46, { width: 300 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('Bangalore, Karnataka, India', left + 44, 66);
    let sy = 78;
    if (d.sellerGstin) {
      doc.text(`GSTIN: ${d.sellerGstin}`, left + 44, sy);
      sy += 11;
    }
    if (d.sellerCin) {
      doc.text(`CIN: ${d.sellerCin}`, left + 44, sy);
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor(SAFFRON)
      .text('TAX INVOICE', right - 160, 48, { width: 160, align: 'right', characterSpacing: 2 });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('Invoice number', right - 160, 66, { width: 160, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK)
      .text(d.invoiceNumber, right - 160, 78, { width: 160, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text(
        new Date(d.invoiceDate).toLocaleDateString('en-IN', { dateStyle: 'medium' }),
        right - 160, 93, { width: 160, align: 'right' },
      );

    const rule = (y: number) => {
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    };
    rule(120);

    // ── Parties ──────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('BILLED TO', left, 136, { characterSpacing: 1 });
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(d.buyerName, left, 150);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(d.buyerEmail, left, 165);
    if (d.buyerGstin) doc.text(`GSTIN: ${d.buyerGstin}`, left, 178);
    else if (d.buyerVatId) doc.text(`VAT / Tax ID: ${d.buyerVatId}`, left, 178);

    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED)
      .text('PLACE OF SUPPLY', right - 200, 136, { width: 200, align: 'right', characterSpacing: 1 });
    doc.font('Helvetica').fontSize(10).fillColor(INK)
      .text(d.isExport ? 'Outside India' : stateName(d.placeOfSupply),
            right - 200, 151, { width: 200, align: 'right' });

    rule(200);

    // ── Line item ────────────────────────────────────────────────────────────
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    doc.text('DESCRIPTION', left, 214, { characterSpacing: 1 });
    doc.text('SAC', 340, 214, { characterSpacing: 1 });
    doc.text('AMOUNT', right - 120, 214, { width: 120, align: 'right', characterSpacing: 1 });
    rule(228);

    doc.font('Helvetica').fontSize(10).fillColor(INK);
    doc.text(d.itemTitle, left, 240, { width: 270 });
    doc.text(d.sacCode ?? '—', 340, 240);
    doc.text(rupees(d.baseP), right - 120, 240, { width: 120, align: 'right' });

    rule(276);

    // ── Totals ───────────────────────────────────────────────────────────────
    let y = 292;
    const line = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9)
        .fillColor(bold ? INK : MUTED)
        .text(label, 320, y, { width: 110, align: 'right' });
      doc.fillColor(INK).text(value, right - 110, y, { width: 110, align: 'right' });
      y += bold ? 20 : 15;
    };

    line('Taxable value', rupees(d.baseP));
    if (d.cgstP > 0) {
      line(`CGST @ ${d.rateBp / 200}%`, rupees(d.cgstP));
      line(`SGST @ ${d.rateBp / 200}%`, rupees(d.sgstP));
    }
    if (d.igstP > 0) line(`IGST @ ${d.rateBp / 100}%`, rupees(d.igstP));

    doc.moveTo(320, y + 2).lineTo(right, y + 2).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    y += 10;
    line('Total', rupees(d.totalP), true);

    // ── Footer ───────────────────────────────────────────────────────────────
    const footY = 700;
    rule(footY);
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    let fy = footY + 12;
    if (d.isExport) {
      doc.font('Helvetica-Bold')
        .text('Supply meant for export of services — zero-rated. No Indian GST charged.', left, fy);
      doc.font('Helvetica');
      fy += 14;
    }
    if (d.paymentRef) {
      doc.text(`Payment reference: ${d.paymentRef}`, left, fy);
      fy += 12;
    }
    doc.text('This is a computer-generated invoice and is valid without a signature.', left, fy);

    doc.end();
  });
}
