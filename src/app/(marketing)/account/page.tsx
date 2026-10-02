import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase-server';
import { isProfileComplete } from '@/lib/site-accounts';
import SignOutButton from './SignOutButton';
import DeleteAccountButton from './DeleteAccountButton';

export const dynamic = 'force-dynamic';

interface Order {
  id: string;
  razorpay_order_id: string | null;
  amount_paise: number;
  status: string;
  created_at: string;
  products: { title: string; slug: string } | null;
}

/**
 * Public "my account" page — reads through the signed-in user's own Supabase
 * session, so RLS (site_accounts/user_entitlements "self" policies, 011 §4)
 * decides what is visible. No admin/service-role connection anywhere here;
 * this page has no way to see another user's data, let alone admin data.
 */
export default async function AccountPage() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/account/register');

  const [{ data: account }, { data: orders }] = await Promise.all([
    supabase
      .from('site_accounts')
      .select('email, full_name, created_at, first_name, last_name, whatsapp_verified_at, billing_country, billing_state_code')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('orders')
      .select('id, razorpay_order_id, amount_paise, status, created_at, products(title, slug)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
  ]);

  // Returning session, no fresh OAuth callback fired (that's covered by
  // auth/site-callback/route.ts) — this is the other call site for the same
  // mandatory profile-completion gate.
  if (account && !isProfileComplete(account)) redirect('/complete-profile?next=/account');

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-bold text-ink">My Account</h1>
        <p className="mt-1 text-sm text-muted">
          {account?.full_name ? `${account.full_name} — ` : ''}
          {account?.email ?? user.email}
        </p>
      </div>

      <section className="rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink">Orders</h2>
        {!orders || orders.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No purchases yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
            {(orders as unknown as Order[]).map((o) => (
              <li key={o.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-bold text-ink">{o.products?.title ?? 'Order'}</p>
                  {o.razorpay_order_id && (
                    <p className="font-mono text-xs text-muted">{o.razorpay_order_id}</p>
                  )}
                  <p className="text-xs text-faint">
                    {new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-ink">
                    {new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(o.amount_paise / 100)}
                  </p>
                  <p className="text-xs text-muted">{o.status}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-6">
        <h2 className="text-sm font-bold uppercase tracking-widest text-ink">Profile</h2>
        <p className="mt-2 text-sm text-muted">
          {account?.first_name} {account?.last_name}
        </p>
        <a
          href="/complete-profile?next=/account"
          className="mt-3 inline-block text-xs font-bold text-saffron-ink hover:underline"
        >
          Edit name / WhatsApp number
        </a>
      </section>

      <SignOutButton />

      <DeleteAccountButton />
    </div>
  );
}
