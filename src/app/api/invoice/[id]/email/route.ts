import { NextResponse } from 'next/server';

import { sendInvoiceEmail } from '@/lib/invoice-email';
import { supabaseAdmin } from '@/lib/supabase';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * POST /api/invoice/[id]/email — send the invoice again.
 *
 * For "can you email me my invoice", which is the most common support request
 * a shop gets.
 *
 * It goes to the address on the account, never to one supplied in the request.
 * Ownership is already checked below, so this is NOT about reaching another
 * person's invoice -- that is impossible either way. It is about not turning a
 * verified sending domain into a relay: a recipient parameter would let any
 * signed-in account send mail from example.com to an arbitrary address, and
 * the cost of that lands on our sender reputation, in bounces and spam
 * complaints we cannot see and did not cause. Fixing the recipient to the
 * account keeps every message we send one a real customer asked for.
 */

/** Sends per order, so a support request cannot become a mail bomb. */
const RESEND_COOLDOWN_MS = 60_000;
const lastSent = new Map<string, number>();

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, user_id, status, invoice_number')
    .eq('id', id)
    .maybeSingle();

  if (!order || order.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (order.status !== 'paid' || !order.invoice_number) {
    return NextResponse.json({ error: 'No invoice has been issued for this order' }, { status: 409 });
  }

  const previous = lastSent.get(order.id);
  if (previous && Date.now() - previous < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - previous)) / 1000);
    return NextResponse.json(
      { error: `Already sent. Try again in ${wait} seconds.` },
      { status: 429 },
    );
  }
  lastSent.set(order.id, Date.now());

  const result = await sendInvoiceEmail(order.id);
  if (!result.success) {
    // Let them retry immediately if it genuinely failed to send.
    lastSent.delete(order.id);
    return NextResponse.json({ error: result.error ?? 'Could not send' }, { status: 502 });
  }

  return NextResponse.json({ success: true });
}
