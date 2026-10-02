import { NextResponse, type NextRequest } from 'next/server';
import { createRouteHandlerSupabaseClient } from '@/lib/supabase-server';
import { isProfileComplete, normalizeWhatsAppNumber } from '@/lib/site-accounts';
import { getWhatsAppNumber } from '@/lib/whatsapp-number';
import { profileGateApplies } from '@/lib/feature-flags';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/profile/status — what the profile gate needs to decide whether a
 * signed-in visitor must finish onboarding, plus the form's initial values.
 * Public pages stay statically cached; this per-user check runs client-side.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const response = new NextResponse(null);
  const supabase = createRouteHandlerSupabaseClient(request, response);
  const reply = (body: unknown) => {
    const json = NextResponse.json(body, { headers: { 'Cache-Control': 'private, no-store' } });
    for (const cookie of response.cookies.getAll()) json.cookies.set(cookie);
    return json;
  };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return reply({ signedIn: false });

  const { data: account } = await supabase
    .from('site_accounts')
    .select('first_name, last_name, whatsapp_number, whatsapp_opt_in, whatsapp_verified_at, billing_country, billing_state_code, gstin')
    .eq('user_id', user.id)
    .maybeSingle();

  const { data: role } = await supabaseAdmin.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
  const isStaff = ['admin', 'editor'].includes(role?.role ?? '');
  const gate = await profileGateApplies(isStaff);

  const emailVerified = Boolean(user.email_confirmed_at);
  const profileComplete = isProfileComplete(account);

  return reply({
    signedIn: true,
    email: user.email ?? null,
    emailVerified,
    profileComplete,
    complete: !gate || (emailVerified && profileComplete),
    gate,
    form: profileComplete
      ? null
      : {
          initialFirstName: account?.first_name ?? '',
          initialLastName: account?.last_name ?? '',
          initialWhatsappNumber: account?.whatsapp_number ? normalizeWhatsAppNumber(account.whatsapp_number) : '',
          initialWhatsappVerified: Boolean(account?.whatsapp_verified_at),
          initialWhatsappOptIn: account?.whatsapp_opt_in ?? false,
          initialBillingCountry: account?.billing_country ?? 'IN',
          initialBillingStateCode: account?.billing_state_code ?? null,
          initialTaxId: account?.gstin ?? null,
          businessWhatsappNumber: await getWhatsAppNumber(),
        },
  });
}
