import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Waitlist signup. One endpoint for every pre-launch product; `product` picks
 * the list.
 *
 * Kept separate from /api/contact because the two carry different consent. A
 * contact enquiry is a question to answer; this is permission to email someone
 * about ONE product when it ships. Routing both through one endpoint into one
 * table is how a launch announcement ends up in the inbox of someone who only
 * ever asked about pricing.
 */

const PRODUCTS = ['voice', 'sample_product'] as const;
type Product = (typeof PRODUCTS)[number];

// Deliberately permissive: this rejects "not an email at all", not every
// address RFC 5322 disallows. Over-strict validation rejects real addresses
// (plus-tags, long TLDs, apostrophes) and the cost of that is a lost lead,
// while the cost of letting a bad one through is one dead row.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
    }

    const { product, email, fullName, note, source, website } = body as Record<string, unknown>;

    // Honeypot. A hidden field no human fills in; bots fill everything. Returns
    // success rather than an error, so a scripted submitter cannot tell it
    // failed and retry with the field removed.
    if (typeof website === 'string' && website.trim() !== '') {
      return NextResponse.json({ success: true, message: "You're on the list." });
    }

    if (typeof product !== 'string' || !PRODUCTS.includes(product as Product)) {
      return NextResponse.json({ error: 'Unknown product.' }, { status: 400 });
    }

    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!EMAIL.test(cleanEmail)) {
      return NextResponse.json(
        { error: 'Enter an email address we can reach you at.' },
        { status: 400 },
      );
    }

    const row = {
      product,
      email: cleanEmail,
      full_name: typeof fullName === 'string' && fullName.trim() ? fullName.trim().slice(0, 120) : null,
      note: typeof note === 'string' && note.trim() ? note.trim().slice(0, 1000) : null,
      source: typeof source === 'string' && source.trim() ? source.trim().slice(0, 120) : null,
    };

    const { error } = await supabaseAdmin.from('waitlist_signups').insert([row]);

    if (error) {
      // 23505 is the (email, product) unique violation — someone signing up
      // twice. That is not a failure from their side, and telling them it is
      // would be both confusing and a way to probe who is already on the list.
      if (error.code === '23505') {
        return NextResponse.json({ success: true, message: "You're already on the list." });
      }
      console.error('[waitlist] insert failed:', error.message);
      return NextResponse.json(
        { error: 'Could not save that just now. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "You're on the list. We'll email you when it's ready.",
    });
  } catch (err) {
    console.error('[waitlist] unexpected error:', err);
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
