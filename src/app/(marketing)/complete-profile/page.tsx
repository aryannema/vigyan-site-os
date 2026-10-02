import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { safeNextPath, normalizeWhatsAppNumber } from '@/lib/site-accounts';
import { getWhatsAppNumber } from '@/lib/whatsapp-number';
import CompleteProfileForm from './CompleteProfileForm';

export const dynamic = 'force-dynamic';

/**
 * Mandatory (or voluntary-edit) profile-completion page. Reached two ways:
 *  - Forced: auth/site-callback/route.ts or account/page.tsx redirect here
 *    when first_name/last_name/whatsapp_verified_at is missing.
 *  - Voluntary: a signed-in, already-complete user clicks "Edit" on
 *    /account (next=/account) to change their name or WhatsApp number.
 * Same page/component either way — no second component needed.
 */
export default async function CompleteProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/account/register');

  const { data: account } = await supabase
    .from('site_accounts')
    .select('first_name, last_name, whatsapp_number, whatsapp_opt_in, whatsapp_verified_at, billing_country, billing_state_code, gstin')
    .eq('user_id', user.id)
    .maybeSingle();

  const businessWhatsappNumber = await getWhatsAppNumber();
  const { next } = await searchParams;
  const nextPath = safeNextPath(next, '/account');

  return (
    <div className="relative flex min-h-[80vh] items-center justify-center overflow-hidden bg-paper p-4 pt-24">
      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold text-ink">Just one more thing</h1>
          <p className="text-sm text-muted">
            Just need this once so we can reach you on WhatsApp.
          </p>
        </div>

        <CompleteProfileForm
          initialFirstName={account?.first_name ?? ''}
          initialLastName={account?.last_name ?? ''}
          initialWhatsappNumber={account?.whatsapp_number ? normalizeWhatsAppNumber(account.whatsapp_number) : ''}
          initialWhatsappVerified={Boolean(account?.whatsapp_verified_at)}
          initialWhatsappOptIn={account?.whatsapp_opt_in ?? false}
          initialBillingCountry={account?.billing_country ?? 'IN'}
          initialBillingStateCode={account?.billing_state_code ?? null}
          initialTaxId={account?.gstin ?? null}
          next={nextPath}
          businessWhatsappNumber={businessWhatsappNumber}
        />
      </div>
    </div>
  );
}
