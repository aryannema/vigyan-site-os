import { NextResponse } from 'next/server';

import { archiveInvoice, getArchivedInvoice, verifyArchived } from '@/lib/invoice-archive';
import { renderInvoicePdf, type InvoiceData } from '@/lib/invoice-pdf';
import { supabaseAdmin } from '@/lib/supabase';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/** Typed explicitly: a long select string defeats the client's column inference. */
interface InvoiceOrderRow {
  id: string;
  user_id: string;
  status: string;
  amount_paise: number;
  tax_base_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  igst_paise: number;
  gst_rate_bp: number;
  place_of_supply: string | null;
  buyer_gstin: string | null;
  buyer_vat_id: string | null;
  tax_treatment: string;
  invoice_number: string | null;
  invoice_date: string | null;
  razorpay_payment_id: string | null;
  product_id: string | null;
}

/**
 * GET /api/invoice/[id] — the invoice as a PDF.
 *
 * Rendered from the order's stored tax snapshot on every request. No file is
 * kept: the figures are immutable once the order is paid, so the same input
 * produces the same document, and there is no second copy to fall out of step
 * with the record.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: order } = (await supabaseAdmin
    .from('orders')
    .select(
      'id, user_id, status, amount_paise, tax_base_paise, cgst_paise, sgst_paise, igst_paise, gst_rate_bp, place_of_supply, buyer_gstin, buyer_vat_id, tax_treatment, invoice_number, invoice_date, razorpay_payment_id, product_id',
    )
    .eq('id', id)
    .maybeSingle()) as { data: InvoiceOrderRow | null };

  // Ownership is checked rather than inferred from possession of the link.
  if (!order || order.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (order.status !== 'paid' || !order.invoice_number) {
    return NextResponse.json({ error: 'No invoice has been issued for this order' }, { status: 409 });
  }

  // Serve the document that was actually issued. Re-rendering would be
  // arithmetically identical but not byte-identical once the template changes,
  // and an audit asks for the artifact the customer received.
  const archived = await getArchivedInvoice(order.id);
  if (archived) {
    if (!verifyArchived(archived)) {
      // Stored bytes no longer hash to what was recorded at issue. Refusing is
      // the only safe answer: serving it would present a tampered or corrupted
      // tax document as authentic.
      console.error(`[invoice] checksum mismatch on archived invoice for order ${order.id}`);
      return NextResponse.json({ error: 'Invoice could not be verified' }, { status: 500 });
    }
    return pdfResponse(archived.pdf, order.invoice_number);
  }

  const [{ data: product }, { data: account }, { data: cfgRows }] = await Promise.all([
    supabaseAdmin.from('products').select('title, sac_code').eq('id', order.product_id).maybeSingle(),
    supabaseAdmin
      .from('site_accounts')
      .select('first_name, last_name, email')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin.from('app_config').select('key, value').eq('key', 'gst_seller_gstin'),
  ]);

  const data: InvoiceData = {
    invoiceNumber: order.invoice_number,
    invoiceDate: order.invoice_date!,
    sellerName: 'YourSite Solutions Private Limited',
    sellerCin: 'U00000KA2026PTC000000',
    sellerGstin: (cfgRows ?? [])[0]?.value || null,
    buyerName:
      [account?.first_name, account?.last_name].filter(Boolean).join(' ') || account?.email || 'Customer',
    buyerEmail: account?.email ?? '',
    buyerGstin: order.buyer_gstin,
    buyerVatId: order.buyer_vat_id,
    placeOfSupply: order.place_of_supply,
    isExport: order.tax_treatment === 'export_zero_rated',
    itemTitle: product?.title ?? 'Item',
    sacCode: product?.sac_code ?? null,
    baseP: order.tax_base_paise,
    cgstP: order.cgst_paise,
    sgstP: order.sgst_paise,
    igstP: order.igst_paise,
    totalP: order.amount_paise,
    rateBp: order.gst_rate_bp,
    paymentRef: order.razorpay_payment_id,
  };

  // Nothing archived: an order paid before the archive existed. Render it and
  // archive it now, so this one download is the last time it is regenerated.
  const pdf = await renderInvoicePdf(data);
  await archiveInvoice(order.id, pdf);

  return pdfResponse(pdf, order.invoice_number);
}

function pdfResponse(pdf: Buffer, invoiceNumber: string): NextResponse {
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceNumber.replace(/\//g, '-')}.pdf"`,
      // A tax document must never be served from a shared cache.
      'Cache-Control': 'private, no-store',
    },
  });
}
