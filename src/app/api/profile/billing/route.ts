import { NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase';
import { createServerSupabaseClient } from '@/lib/supabase-server';

/**
 * GET /api/profile/billing — the billing details already on the account.
 *
 * Lets checkout skip the billing step for a returning buyer instead of asking
 * again. Returns only what the tax calculation needs; there is no reason for a
 * checkout screen to pull the rest of someone's profile.
 */
export async function GET() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data } = await supabaseAdmin
    .from('site_accounts')
    .select('billing_country, billing_state_code, gstin')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    country: data?.billing_country ?? 'IN',
    stateCode: data?.billing_state_code ?? null,
    gstin: data?.gstin ?? null,
    // An Indian buyer with no state has never completed this, so checkout must
    // ask before pricing anything.
    complete: Boolean(
      data?.billing_country && (data.billing_country !== 'IN' || data.billing_state_code),
    ),
  });
}
