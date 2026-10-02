import { NextResponse } from 'next/server';

import { cfgBool, cfgString } from '@/lib/app-config';
import { computeTax, stateCodeFromGstin } from '@/lib/gst';
import { priceState } from '@/lib/pricing';
import { supabaseAdmin } from '@/lib/supabase';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * POST /api/checkout/quote — prices a product for a given billing location,
 * WITHOUT creating an order or charging anything.
 *
 * This exists so the tax is settled before the order is, not after. Creating
 * the order first and asking for an address later means the split is computed
 * from whatever happened to be on file — which, for a buyer who has never told
 * us their state, is our own. That charges an intra-state CGST+SGST split to
 * someone who owed IGST, and puts it on an invoice.
 *
 * Purely a calculation: it writes nothing, so it is safe to call on every
 * keystroke in the billing form.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Sign in to continue' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const productId = typeof body?.productId === 'string' ? body.productId : '';
    if (!productId) return NextResponse.json({ error: 'productId is required' }, { status: 400 });

    const country = String(body?.country ?? 'IN').toUpperCase() === 'IN' ? 'IN' : 'OTHER';
    const stateCode = typeof body?.stateCode === 'string' ? body.stateCode : null;
    const gstin = typeof body?.gstin === 'string' ? body.gstin.trim().toUpperCase() : '';

    // A GSTIN carries its own state in the first two digits. If it disagrees
    // with the selected state, one of them is wrong and we cannot know which —
    // so refuse rather than silently pick one and print it on an invoice.
    if (gstin && country === 'IN') {
      const fromGstin = stateCodeFromGstin(gstin);
      if (fromGstin && stateCode && fromGstin !== stateCode) {
        return NextResponse.json(
          { error: `That GSTIN belongs to state ${fromGstin}, which does not match the state you selected.` },
          { status: 400 },
        );
      }
    }

    const [{ data: product }, { data: cfgRows }] = await Promise.all([
      supabaseAdmin
        .from('products')
        .select('id, title, price_paise, currency, status, gst_rate_bp, discount_bp, offer_ends_at, offer_label')
        .eq('id', productId)
        .maybeSingle(),
      supabaseAdmin
        .from('app_config')
        .select('key, value')
        .in('key', ['gst_seller_state_code', 'gst_prices_include_tax']),
    ]);

    if (!product || product.status !== 'active') {
      return NextResponse.json({ error: 'Product is not available' }, { status: 404 });
    }

    const cfg = new Map((cfgRows ?? []).map((r) => [r.key, r.value]));
    // Offer applied server-side, from the same rule the product page rendered
    // with. The deadline is evaluated NOW, not when the page was loaded.
    const price = priceState(product as never);

    const tax = computeTax({
      priceP: price.effectiveP,
      rateBp: product.gst_rate_bp ?? 1800,
      sellerStateCode: cfgString(cfg.get('gst_seller_state_code'), '29'),
      buyerStateCode: country === 'IN' ? stateCode : null,
      buyerCountry: country === 'IN' ? 'IN' : 'XX',
      pricesIncludeTax: cfgBool(cfg.get('gst_prices_include_tax'), true),
    });

    return NextResponse.json({
      productTitle: product.title,
      currency: product.currency || 'INR',
      // `needsState` drives the form: an Indian buyer who has not chosen a state
      // is being quoted our fallback, and should be told so rather than shown a
      // confident number that may change.
      needsState: country === 'IN' && !stateCode,
      offer: price.offerActive
        ? { listP: price.listP, savedP: price.savedP, endsAt: price.offerEndsAt, label: price.offerLabel }
        : null,
      tax: {
        baseP: tax.baseP, cgstP: tax.cgstP, sgstP: tax.sgstP,
        igstP: tax.igstP, totalP: tax.totalP, label: tax.label,
        treatment: tax.treatment,
      },
    });
  } catch (error) {
    console.error('[checkout] quote failed:', error);
    return NextResponse.json({ error: 'Could not price this item.' }, { status: 500 });
  }
}
