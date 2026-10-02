import { BRAND_TAGLINE } from '@/lib/brand';
import { getArchivedInvoice } from '@/lib/invoice-archive';
import { archiveIssuedInvoice } from '@/lib/invoice-issue';
import { sendTransactionalEmail } from '@/lib/resend-email';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Emails a paid invoice: the PDF attached, and a link to fetch it again.
 *
 * Both, deliberately. The attachment is what most people actually want — it
 * lands in their mail and stays there, needing no account and no login at the
 * moment they are forwarding it to an accountant. The link is the durable copy:
 * mail gets deleted, forwarded badly, or caught by a filter, and the link
 * always resolves to the same archived bytes.
 *
 * The link requires signing in. An invoice carries a name, an address, a GSTIN
 * and what someone bought, so it is not something to hand to anyone holding a
 * URL.
 */

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function invoiceHtml(opts: {
  name: string;
  invoiceNumber: string;
  itemTitle: string;
  totalP: number;
  taxLine: string;
  url: string;
}): string {
  // Inline styles and a table layout: email clients are not browsers, and a
  // stylesheet or a flex container will not survive Outlook.
  return `
<div style="font-family:Helvetica,Arial,sans-serif;background:#faf6ee;padding:32px 16px;color:#1c1814">
  <div style="max-width:520px;margin:0 auto;background:#fffdf8;border:1px solid #e2d9c8;border-radius:16px;padding:32px">
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:2px;color:#6b6259;text-transform:uppercase">YourSite</p>
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:600">Your invoice</h1>
    <p style="margin:0 0 24px;font-size:13px;color:#6b6259;font-style:italic">${BRAND_TAGLINE}</p>

    <p style="margin:0 0 16px;font-size:14px;line-height:1.6">
      Hello ${name_(opts.name)}, thank you for your purchase. Your tax invoice
      <strong>${opts.invoiceNumber}</strong> is attached to this email.
    </p>

    <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 24px">
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #e2d9c8">${escape_(opts.itemTitle)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #e2d9c8;text-align:right">${rupees(opts.totalP)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:8px 0;font-size:12px;color:#6b6259">${escape_(opts.taxLine)}</td>
      </tr>
    </table>

    <a href="${opts.url}"
       style="display:inline-block;background:#e8821a;color:#fffdf8;text-decoration:none;
              padding:12px 22px;border-radius:10px;font-size:14px;font-weight:bold">
      View or download it again
    </a>

    <p style="margin:20px 0 0;font-size:12px;color:#6b6259;line-height:1.6">
      The link asks you to sign in — an invoice carries your name, address and
      what you bought, so it is not left open to anyone holding the URL.
    </p>
  </div>
</div>`;
}

const escape_ = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const name_ = (s: string) => escape_(s.split(' ')[0] || 'there');

export async function sendInvoiceEmail(
  orderId: string,
): Promise<{ success: boolean; error?: string }> {
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, amount_paise, cgst_paise, igst_paise, gst_rate_bp, tax_treatment, invoice_number, status, product_id')
    .eq('id', orderId)
    .maybeSingle();

  if (!order?.invoice_number || order.status !== 'paid') {
    return { success: false, error: 'No invoice has been issued for this order.' };
  }

  // Archive first if this order predates the archive, so the attachment and the
  // download link are the same bytes rather than two separate renders.
  let archived = await getArchivedInvoice(order.id);
  if (!archived) {
    await archiveIssuedInvoice(order.id);
    archived = await getArchivedInvoice(order.id);
  }
  if (!archived) return { success: false, error: 'Could not produce the invoice.' };

  const [{ data: account }, { data: product }, { data: cfgRows }] = await Promise.all([
    supabaseAdmin
      .from('site_accounts')
      .select('first_name, email')
      .eq('user_id', order.user_id)
      .maybeSingle(),
    supabaseAdmin.from('products').select('title').eq('id', order.product_id).maybeSingle(),
    supabaseAdmin.from('app_config').select('key, value').eq('key', 'site_url'),
  ]);

  if (!account?.email) return { success: false, error: 'No email address on the account.' };

  const origin = (cfgRows ?? [])[0]?.value || 'https://www.example.com';
  const taxLine =
    order.tax_treatment === 'export_zero_rated'
      ? 'Export of services — zero-rated, no GST charged.'
      : order.igst_paise > 0
        ? `Includes IGST at ${order.gst_rate_bp / 100}%.`
        : order.cgst_paise > 0
          ? `Includes CGST and SGST at ${order.gst_rate_bp / 200}% each.`
          : 'No GST applicable.';

  return sendTransactionalEmail(
    account.email,
    `Your YourSite invoice ${order.invoice_number}`,
    invoiceHtml({
      name: account.first_name ?? '',
      invoiceNumber: order.invoice_number,
      itemTitle: product?.title ?? 'Your purchase',
      totalP: order.amount_paise,
      taxLine,
      url: `${origin}/account/orders/${order.id}/invoice`,
    }),
    [
      {
        filename: `${order.invoice_number.replace(/\//g, '-')}.pdf`,
        content: archived.pdf,
      },
    ],
  );
}
