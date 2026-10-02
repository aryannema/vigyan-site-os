import { supabaseAdmin } from '@/lib/supabase';


export const dynamic = 'force-dynamic';
interface Entitlement {
  id: string;
  email: string;
  order_id: string;
  payment_id: string;
  amount: number;
  status: string;
  source: string;
  created_at: string;
}

async function getPayments(): Promise<Entitlement[]> {
  const { data, error } = await supabaseAdmin
    .from('user_entitlements')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) return [];
  return data as Entitlement[];
}

function formatINR(amount: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

export default async function PaymentsPage() {
  const payments = await getPayments();

  const totalRevenue = payments
    .filter((p) => p.status === 'active')
    .reduce((sum, p) => sum + (p.amount || 0), 0);

  const activeCount = payments.filter((p) => p.status === 'active').length;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-ink dark:text-white">Payments</h1>
        <p className="text-sm text-muted dark:text-faint mt-1">All Razorpay transactions from template purchases</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-6 rounded-2xl bg-surface dark:bg-surface border border-hairline dark:border-hairline space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Total Revenue</p>
          <p className="text-3xl font-bold text-ink dark:text-white">{formatINR(totalRevenue)}</p>
        </div>
        <div className="p-6 rounded-2xl bg-surface dark:bg-surface border border-hairline dark:border-hairline space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Active Purchases</p>
          <p className="text-3xl font-bold text-ink dark:text-white">{activeCount}</p>
        </div>
        <div className="p-6 rounded-2xl bg-surface dark:bg-surface border border-hairline dark:border-hairline space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Total Transactions</p>
          <p className="text-3xl font-bold text-ink dark:text-white">{payments.length}</p>
        </div>
      </div>

      {/* Payments table */}
      <div className="rounded-2xl bg-surface dark:bg-surface border border-hairline dark:border-hairline overflow-hidden">
        {payments.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-muted text-sm">No payments yet.</p>
            <p className="text-faint text-xs mt-2">Payments will appear here after a Razorpay webhook fires.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-hairline dark:border-hairline text-[10px] font-bold uppercase tracking-widest text-muted">
                  <th className="text-left px-6 py-4">Email</th>
                  <th className="text-left px-4 py-4">Amount</th>
                  <th className="text-left px-4 py-4">Status</th>
                  <th className="text-left px-4 py-4">Payment ID</th>
                  <th className="text-left px-4 py-4">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline-faint">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-sand dark:hover:bg-surface transition">
                    <td className="px-6 py-4 text-ink dark:text-white font-medium text-sm">{p.email}</td>
                    <td className="px-4 py-4 text-green-ink font-bold">{formatINR(p.amount)}</td>
                    <td className="px-4 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                        p.status === 'active'
                          ? 'bg-brand-bytes/20 text-green-ink border-brand-bytes/30'
                          : 'bg-sand text-muted border-hairline'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-muted text-xs font-mono truncate max-w-[180px]">{p.payment_id}</td>
                    <td className="px-4 py-4 text-muted text-xs">
                      {new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
