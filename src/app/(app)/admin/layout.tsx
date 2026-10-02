import type { ReactNode } from 'react';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import AdminShell from './AdminShell';

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const email = user?.email ?? '';
  const initials = email ? email.slice(0, 2).toUpperCase() : 'MN';

  return (
    <AdminShell email={email} initials={initials}>
      {children}
    </AdminShell>
  );
}
