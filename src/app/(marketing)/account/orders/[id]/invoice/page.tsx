import { notFound, redirect } from 'next/navigation';

import { INDIAN_STATES } from '@/lib/gst';
import { supabaseAdmin } from '@/lib/supabase';
import { createServerSupabaseClient } from '@/lib/supabase-server';

import { PrintButton } from './PrintButton';

export const dynamic = 'force-dynamic';

/**
 * Tax invoice, rendered from the order.
 *
 * Nothing is stored as a file. The order carries an immutable snapshot of every
 * figure printed here (migration 030), so the document is reproduced from that
 * and cannot drift from the record. Printing to PDF is the browser's job --
 * "Save as PDF" in the print dialog produces a real one, which is cheaper and
 * more portable than shipping a headless browser to render it server-side.
 */

/**
 * The registered supplier.
 *
 * Kept beside the invoice rather than in app_config because it is a Companies
 * Act identity, not an operational setting: it changes when the company
 * changes, which is a code change and a legal event, not a toggle.
 */
const SELLER = {
  name: 'YourSite Solutions Private Limited',
  cin: 'U00000KA2026PTC000000',
} as const;

const rupees = (p: number) =>
  `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface InvoiceOrder {
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
  buyer_country: string;
  buyer_gstin: string | null;
  buyer_vat_id: string | null;
  tax_treatment: string;
  invoice_number: string | null;
  invoice_date: string | null;
  created_at: string;
  razorpay_payment_id: string | null;
  product_id: string | null;
}

const stateName = (code: string | null) =>
  code ? (INDIAN_STATES.find((s) => s.code === code)?.name ?? code) : '—';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/account/orders/${id}/invoice`);

  // Typed explicitly: a concatenated select string defeats the client's column
  // inference and every field degrades to an error type.
  const { data: order } = (await supabaseAdmin
    .from('orders')
    .select(
      'id, user_id, status, amount_paise, tax_base_paise, cgst_paise, sgst_paise, igst_paise, gst_rate_bp, place_of_supply, buyer_country, buyer_gstin, buyer_vat_id, tax_treatment, invoice_number, invoice_date, created_at, razorpay_payment_id, product_id',
    )
    .eq('id', id)
    .maybeSingle()) as { data: InvoiceOrder | null };

  // Scoped to the buyer. An invoice id is guessable enough that ownership has to
  // be checked rather than assumed from possession of the link.
  if (!order || order.user_id !== user.id) notFound();

  // An unpaid order has no invoice. GST is due on a supply, not on an intent.
  if (order.status !== 'paid' || !order.invoice_number) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="font-display text-2xl">No invoice yet</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          An invoice is issued once payment is confirmed. This order is currently{' '}
          <strong>{order.status}</strong>.
        </p>
      </main>
    );
  }

  const [{ data: product }, { data: account }, { data: cfgRows }] = await Promise.all([
    supabaseAdmin.from('products').select('title, sac_code').eq('id', order.product_id).maybeSingle(),
    supabaseAdmin
      .from('site_accounts')
      .select('first_name, last_name, email, billing_state_code, billing_country')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabaseAdmin.from('app_config').select('key, value').in('key', ['gst_seller_gstin', 'gst_seller_state_code']),
  ]);
  const cfg = new Map((cfgRows ?? []).map((r) => [r.key, r.value]));

  const isExport = order.tax_treatment === 'export_zero_rated';

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 print:px-0 print:py-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <a href="/account/orders" className="text-sm text-muted-foreground hover:text-foreground">
          ← Orders
        </a>
        <PrintButton orderId={order.id} />
      </div>

      <article className="rounded-card border border-hairline bg-card p-10 print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-hairline pb-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Tax Invoice</p>
            {/* The legal entity, not the brand — a tax invoice names the
                registered supplier. */}
            <h1 className="mt-2 font-display text-xl leading-tight">{SELLER.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Bangalore, Karnataka, India</p>
            {cfg.get('gst_seller_gstin') && (
              <p className="mt-1 font-mono text-xs">GSTIN: {String(cfg.get('gst_seller_gstin'))}</p>
            )}
            <p className="font-mono text-xs text-muted-foreground">CIN: {SELLER.cin}</p>
          </div>
          <dl className="text-right text-sm">
            <dt className="text-xs text-muted-foreground">Invoice number</dt>
            <dd className="font-mono font-semibold">{order.invoice_number}</dd>
            <dt className="mt-2 text-xs text-muted-foreground">Date</dt>
            <dd>{new Date(order.invoice_date!).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</dd>
          </dl>
        </header>

        <section className="grid gap-6 border-b border-hairline py-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billed to</p>
            <p className="mt-1 text-sm font-semibold">
              {[account?.first_name, account?.last_name].filter(Boolean).join(' ') || account?.email}
            </p>
            <p className="text-sm text-muted-foreground">{account?.email}</p>
            {order.buyer_gstin && <p className="mt-1 font-mono text-xs">GSTIN: {order.buyer_gstin}</p>}
            {order.buyer_vat_id && <p className="mt-1 font-mono text-xs">VAT / Tax ID: {order.buyer_vat_id}</p>}
          </div>
          <div className="sm:text-right">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Place of supply</p>
            <p className="mt-1 text-sm">
              {isExport ? 'Outside India' : stateName(order.place_of_supply)}
            </p>
          </div>
        </section>

        <table className="w-full border-b border-hairline py-6 text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="py-3 font-semibold">Description</th>
              <th className="py-3 font-semibold">SAC</th>
              <th className="py-3 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-hairline">
              <td className="py-3">{product?.title ?? 'Item'}</td>
              <td className="py-3 font-mono text-xs">{product?.sac_code ?? '—'}</td>
              <td className="py-3 text-right">{rupees(order.tax_base_paise)}</td>
            </tr>
          </tbody>
        </table>

        <section className="ml-auto mt-6 max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Taxable value</span>
            <span>{rupees(order.tax_base_paise)}</span>
          </div>
          {order.cgst_paise > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">CGST @ {order.gst_rate_bp / 200}%</span>
                <span>{rupees(order.cgst_paise)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">SGST @ {order.gst_rate_bp / 200}%</span>
                <span>{rupees(order.sgst_paise)}</span>
              </div>
            </>
          )}
          {order.igst_paise > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">IGST @ {order.gst_rate_bp / 100}%</span>
              <span>{rupees(order.igst_paise)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-hairline pt-2 text-base font-semibold">
            <span>Total</span>
            <span>{rupees(order.amount_paise)}</span>
          </div>
        </section>

        <footer className="mt-10 border-t border-hairline pt-6 text-xs text-muted-foreground">
          {isExport && (
            <p className="mb-2 font-semibold">
              Supply meant for export of services — zero-rated. No Indian GST charged.
            </p>
          )}
          {order.razorpay_payment_id && (
            <p className="font-mono">Payment reference: {order.razorpay_payment_id}</p>
          )}
          <p className="mt-2">
            This is a computer-generated invoice and is valid without a signature.
          </p>
        </footer>
      </article>
    </main>
  );
}
