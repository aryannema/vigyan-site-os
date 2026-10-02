import { profileGateApplies } from '@/lib/feature-flags';
import { NextResponse } from 'next/server';
import { readAttribution } from '@/lib/attribution';

import { cfgBool, cfgString } from '@/lib/app-config';
import { computeTax, stateCodeFromGstin } from '@/lib/gst';
import { priceState } from '@/lib/pricing';
import { getRazorpayConfig, keyModeMismatch, authHeader } from '@/lib/razorpay';
import { supabaseAdmin } from '@/lib/supabase';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * POST /api/checkout/order — creates a Razorpay order for one product.
 *
 * This is the half of checkout that was missing: the webhook that records a
 * payment existed, but nothing ever created an order for it to be about.
 *
 * The price is read from the database by product id. It is never taken from the
 * request body -- a client-supplied amount is a client-chosen price, and the
 * browser is not a trusted source for what something costs.
 */
export async function POST(request: Request) {
  try {
    // 1. Who is buying. An order is a row against a real user, so an
    //    unauthenticated caller has nothing to attach a purchase to.
    const supabase = await createServerSupabaseClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Sign in to continue' }, { status: 401 });
    }

    // The profile gate is UX; this is the rule. Billing location is collected
    // in this same request, so only identity is required up front.
    const { data: buyer } = await supabaseAdmin
      .from('site_accounts')
      .select('first_name, last_name, whatsapp_verified_at')
      .eq('user_id', user.id)
      .maybeSingle();
    const { data: buyerRole } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    const gate = await profileGateApplies(['admin', 'editor'].includes(buyerRole?.role ?? ''));
    if (gate && (!user.email_confirmed_at || !buyer?.first_name || !buyer?.last_name || !buyer?.whatsapp_verified_at)) {
      return NextResponse.json(
        { error: 'Confirm your email and complete your profile before buying.', code: 'profile_incomplete' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const productId = typeof body?.productId === 'string' ? body.productId : '';
    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    // 2. Gateway must be usable before we promise the visitor a checkout.
    const cfg = await getRazorpayConfig();
    if (!cfg.configured) {
      return NextResponse.json(
        { error: 'Payments are not configured yet.' },
        { status: 503 },
      );
    }
    const mismatch = keyModeMismatch(cfg);
    if (mismatch) {
      // Refuse rather than transact in a mode nobody intended.
      console.error('[checkout] gateway mode mismatch:', mismatch);
      return NextResponse.json({ error: 'Payments are misconfigured.' }, { status: 503 });
    }

    // 3. The price comes from OUR record of the product.
    const { data: product } = await supabaseAdmin
      .from('products')
      .select('id, title, price_paise, currency, status, gst_rate_bp, sac_code, discount_bp, offer_ends_at')
      .eq('id', productId)
      .maybeSingle();

    if (!product || product.status !== 'active') {
      return NextResponse.json({ error: 'Product is not available' }, { status: 404 });
    }
    // The price is decided HERE, at order time, not when the page was rendered.
    // The obvious move is to open the page while an offer runs and complete the
    // purchase after it ends; the deadline is therefore re-evaluated now.
    const price = priceState(product as never);

    if (!price.effectiveP || price.effectiveP <= 0) {
      // Zero means "request a quote" (src/lib/form-schema.ts), not "free".
      return NextResponse.json(
        { error: 'This product is not sold through checkout.' },
        { status: 400 },
      );
    }

    // 4. Billing details. Sent on the FIRST purchase and persisted, so every
    //    later one is prefilled. They are saved BEFORE the tax is computed --
    //    settling the address after the order would price it from whatever
    //    happened to be on file, which for a new buyer is our own state, and
    //    would put an intra-state split on an invoice that owed IGST.
    const billing = body?.billing;
    if (billing && typeof billing === 'object') {
      const country = String(billing.country ?? 'IN').toUpperCase() === 'IN' ? 'IN' : String(billing.country).toUpperCase();
      const stateCode = country === 'IN' && typeof billing.stateCode === 'string' ? billing.stateCode : null;
      const gstin = typeof billing.gstin === 'string' ? billing.gstin.trim().toUpperCase() : '';

      const fromGstin = stateCodeFromGstin(gstin);
      if (gstin && fromGstin && stateCode && fromGstin !== stateCode) {
        return NextResponse.json(
          { error: 'The GSTIN does not match the state you selected.' },
          { status: 400 },
        );
      }

      await supabaseAdmin
        .from('site_accounts')
        .update({
          billing_country: country,
          billing_state_code: stateCode,
          gstin: gstin || null,
        })
        .eq('user_id', user.id);
    }

    // 5. GST. Computed here, not by Razorpay -- the gateway moves money, the
    //    seller owes the tax. The buyer's state decides CGST+SGST vs IGST, and
    //    their country decides whether Indian GST applies at all.
    const [{ data: account }, { data: cfgRows }] = await Promise.all([
      supabaseAdmin
        .from('site_accounts')
        .select('billing_state_code, billing_country, gstin')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabaseAdmin
        .from('app_config')
        .select('key, value')
        .in('key', ['gst_seller_state_code', 'gst_prices_include_tax']),
    ]);
    const cfg2 = new Map((cfgRows ?? []).map((r) => [r.key, r.value]));

    const tax = computeTax({
      priceP: price.effectiveP,
      rateBp: product.gst_rate_bp ?? 1800,
      sellerStateCode: cfgString(cfg2.get('gst_seller_state_code'), '29'),
      buyerStateCode: account?.billing_state_code ?? null,
      buyerCountry: account?.billing_country ?? 'IN',
      pricesIncludeTax: cfgBool(cfg2.get('gst_prices_include_tax'), true),
    });

    // 6. Our order row first, so a payment can always be traced to a purchase
    //    even if the Razorpay call or the browser dies straight afterwards.
    //    The tax is STORED, not recomputed later: rates change, and an invoice
    //    must reproduce what was charged on the day.
    // Which campaign, if any, sent this buyer. Read from the cookie the
    // short-link redirect set; empty for a direct visit, which is not an error.
    const attribution = await readAttribution();

    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .insert({
        user_id: user.id,
        product_id: product.id,
        // Stamped onto the ORDER, not looked up later: attribution is a
        // historical fact about this sale and must survive the link being
        // edited, archived or deleted afterwards.
        link_slug: attribution.link_slug ?? null,
        utm_source: attribution.utm_source ?? null,
        utm_medium: attribution.utm_medium ?? null,
        utm_campaign: attribution.utm_campaign ?? null,
        amount_paise: tax.totalP,
        status: 'pending',
        tax_base_paise: tax.baseP,
        cgst_paise: tax.cgstP,
        sgst_paise: tax.sgstP,
        igst_paise: tax.igstP,
        gst_rate_bp: tax.rateBp,
        place_of_supply: tax.placeOfSupply,
        buyer_country: account?.billing_country ?? 'IN',
        // An Indian buyer's identifier is a GSTIN; a foreign buyer's is a VAT
        // or local tax number. Same field on the account, different column on
        // the order, because the invoice must label it correctly -- printing
        // "GSTIN" above a German VAT number would be wrong on a tax document.
        buyer_gstin: (account?.billing_country ?? 'IN') === 'IN' ? (account?.gstin ?? null) : null,
        buyer_vat_id: (account?.billing_country ?? 'IN') !== 'IN' ? (account?.gstin ?? null) : null,
        tax_treatment: tax.treatment,
      })
      .select('id')
      .single();

    if (orderError || !order) {
      throw new Error(orderError?.message ?? 'Could not create the order');
    }

    // 7. Razorpay's order. receipt carries our id so the webhook can find the
    //    row again without trusting anything the browser sends back.
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { Authorization: authHeader(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: tax.totalP,
        currency: product.currency || 'INR',
        receipt: order.id,
        notes: { order_id: order.id, product: product.title },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('[checkout] Razorpay rejected the order:', response.status, detail);
      await supabaseAdmin.from('orders').update({ status: 'failed' }).eq('id', order.id);
      return NextResponse.json({ error: 'Could not start checkout.' }, { status: 502 });
    }

    const rzpOrder = await response.json();
    await supabaseAdmin
      .from('orders')
      .update({ razorpay_order_id: rzpOrder.id })
      .eq('id', order.id);

    // Only the key id goes back to the browser -- it is publishable by design.
    // The key secret never leaves the server.
    return NextResponse.json({
      orderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: cfg.keyId,
      isLive: cfg.isLive,
      internalOrderId: order.id,
      productTitle: product.title,
      tax: {
        baseP: tax.baseP,
        cgstP: tax.cgstP,
        sgstP: tax.sgstP,
        igstP: tax.igstP,
        totalP: tax.totalP,
        label: tax.label,
      },
    });
  } catch (error) {
    console.error('[checkout] order creation failed:', error);
    return NextResponse.json({ error: 'Could not start checkout.' }, { status: 500 });
  }
}
