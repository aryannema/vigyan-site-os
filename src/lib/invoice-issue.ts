import { archiveInvoice } from '@/lib/invoice-archive';
import { renderInvoicePdf, type InvoiceData } from '@/lib/invoice-pdf';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Renders and archives the invoice for a paid order.
 *
 * Called at issue rather than at first download, so the bytes stored are the
 * ones the template produced on the day it was issued. If the template later
 * changes, the customer's copy and ours stay the same document.
 *
 * Server-side only, and deliberately does no auth: the caller is the verified
 * Razorpay webhook, which has already established that this payment is real.
 */
export async function archiveIssuedInvoice(orderId: string): Promise<void> {
  const { data: order } = (await supabaseAdmin
    .from('orders')
    .select(
      'id, user_id, amount_paise, tax_base_paise, cgst_paise, sgst_paise, igst_paise, gst_rate_bp, place_of_supply, buyer_gstin, buyer_vat_id, tax_treatment, invoice_number, invoice_date, razorpay_payment_id, product_id',
    )
    .eq('id', orderId)
    .maybeSingle()) as { data: Record<string, string & number> | null };

  if (!order?.invoice_number) return;

  const [{ data: product }, { data: account }, { data: cfgRows }] = await Promise.all([
    supabaseAdmin.from('products').select('title, sac_code').eq('id', order.product_id).maybeSingle(),
    supabaseAdmin
      .from('site_accounts')
      .select('first_name, last_name, email')
      .eq('user_id', order.user_id)
      .maybeSingle(),
    supabaseAdmin.from('app_config').select('key, value').eq('key', 'gst_seller_gstin'),
  ]);

  const data: InvoiceData = {
    invoiceNumber: order.invoice_number,
    invoiceDate: order.invoice_date,
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
    baseP: Number(order.tax_base_paise),
    cgstP: Number(order.cgst_paise),
    sgstP: Number(order.sgst_paise),
    igstP: Number(order.igst_paise),
    totalP: Number(order.amount_paise),
    rateBp: Number(order.gst_rate_bp),
    paymentRef: order.razorpay_payment_id,
  };

  await archiveInvoice(order.id, await renderInvoicePdf(data));
}
