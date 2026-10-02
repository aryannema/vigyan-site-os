import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { sendInvoiceEmail } from '@/lib/invoice-email';
import { archiveIssuedInvoice } from '@/lib/invoice-issue';
import { getRazorpayConfig } from '@/lib/razorpay';

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get('x-razorpay-signature');

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
    }

    // 1. Verify Razorpay Signature.
    //
    // FAIL CLOSED when the secret is missing. This previously fell back to
    // `|| ''`, which does not disable the check -- it makes the check
    // *forgeable*: HMAC-SHA256(body, '') is computable by anyone, so any caller
    // who knew the URL could sign their own "payment.captured" and have it
    // accepted as genuine. An unset secret means we cannot verify anything, and
    // an unverifiable payment event must be refused, not trusted.
    // The value is issued by Razorpay's dashboard and stored in
    // public.payment_gateway_config (migration 011), edited at
    // /admin/payments/config next to the key id and the live/test switch.
    // Rotating it after a Razorpay-side change is an admin action, not a deploy.
    const { webhookSecret } = await getRazorpayConfig();
    if (!webhookSecret) {
      console.error('[Razorpay] RAZORPAY_WEBHOOK_SECRET is not set — refusing webhook.');
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    // Constant-time compare; a length mismatch is a mismatch, and timingSafeEqual
    // throws on unequal lengths rather than returning false.
    const expectedBuf = Buffer.from(expectedSignature, 'utf8');
    const providedBuf = Buffer.from(signature, 'utf8');
    if (
      expectedBuf.length !== providedBuf.length ||
      !crypto.timingSafeEqual(expectedBuf, providedBuf)
    ) {
      console.error('[Razorpay] Invalid webhook signature detected.');
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // 2. Parse the payload
    const body = JSON.parse(rawBody);
    const event = body.event;

    // 3. Handle Payment Captured
    if (event === 'payment.captured') {
      const payment = body.payload.payment.entity;
      const orderId = payment.order_id;
      const amount = payment.amount / 100; // Razorpay amounts are in paise
      const email = payment.email;

      console.log(`[Razorpay] Payment of ₹${amount} captured for order ${orderId} by ${email}`);

      // 4. Mark OUR order paid and issue its invoice number.
      //
      // This was missing: the webhook granted an entitlement but never touched
      // public.orders, so a paid order stayed 'pending' for ever and no invoice
      // could ever be raised against it.
      //
      // The order is found by razorpay_order_id rather than by anything in the
      // payload's own fields, because that is the link WE created when the order
      // was placed. Guarded on status so a redelivery -- which Razorpay does --
      // cannot re-mark a refunded order as paid.
      const { data: paidOrder } = await supabaseAdmin
        .from('orders')
        .update({
          status: 'paid',
          razorpay_payment_id: payment.id,
          gateway: 'razorpay',
          // BEST EFFORT, NOT TRUTH. Razorpay documents that fee and tax CAN BE
          // NULL in the payment event payload -- the fee is finalised at
          // SETTLEMENT (T+2), not at capture. So this is recorded as
          // fee_source='reported' and must never be treated as final; the
          // settlement webhook overwrites it with fee_source='settled', which
          // is the only figure worth tuning a pricing assumption against.
          actual_fee_minor: typeof payment.fee === 'number' ? payment.fee : null,
          actual_fee_tax_minor: typeof payment.tax === 'number' ? payment.tax : null,
          fee_source: typeof payment.fee === 'number' ? 'reported' : 'none',
        })
        .eq('razorpay_order_id', orderId)
        .in('status', ['pending', 'paid'])
        .select('id, invoice_number')
        .maybeSingle();

      if (!paidOrder) {
        console.error(`[Razorpay] No matching order row for ${orderId} — entitlement only.`);
      } else if (!paidOrder.invoice_number) {
        // Allocated by the database under a row lock (migration 031). Doing it
        // here as select-max-then-insert is how two customers end up holding the
        // same invoice number. The function is idempotent, so a redelivered
        // webhook returns the existing number instead of burning a new one.
        const { data: invoiceNumber, error: invoiceError } = await supabaseAdmin.rpc(
          'allocate_invoice_number',
          { p_order_id: paidOrder.id },
        );
        if (invoiceError) {
          // The payment is real and already recorded. Failing to number the
          // invoice must not cause Razorpay to retry a captured payment.
          console.error('[Razorpay] Could not allocate an invoice number:', invoiceError);
        } else {
          console.log(`[Razorpay] Invoice ${invoiceNumber} issued for order ${paidOrder.id}`);
          // Archive the document at issue, not at first download, so the bytes
          // stored are the ones produced by the template in force on the day it
          // was issued. Failing here is logged and left alone: the invoice can
          // still be rendered on demand, and a captured payment must not be
          // retried because a PDF did not archive.
          try {
            await archiveIssuedInvoice(paidOrder.id);
            // Email it straight away, attachment plus link. A buyer should not
            // have to go looking for a document they just paid for.
            const sent = await sendInvoiceEmail(paidOrder.id);
            if (!sent.success) {
              console.error('[Razorpay] Invoice email failed:', sent.error);
            }
          } catch (archiveError) {
            console.error('[Razorpay] Could not archive or email the invoice:', archiveError);
          }
        }
      }

      // 5. Update Entitlements in Supabase
      // We use supabaseAdmin because this is a server-side verified action that bypasses RLS
      const { error: entitlementError } = await supabaseAdmin
        .from('user_entitlements')
        .upsert({
          email: email,
          order_id: orderId,
          amount: amount,
          status: 'active',
          source: 'razorpay',
          payment_id: payment.id,
          created_at: new Date().toISOString()
        }, { onConflict: 'payment_id' });

      if (entitlementError) {
        console.error('[Supabase] Failed to create entitlement:', entitlementError);
        // We still return 200 to Razorpay to prevent retries of a valid payment, 
        // but we log the error for ops monitoring.
      } else {
        console.log(`[Supabase] Entitlement granted to ${email} for payment ${payment.id}`);
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Razorpay Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
