'use client';

import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function SignOutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push('/account/register');
  };

  return (
    <button onClick={handleLogout} className="text-xs text-muted transition hover:text-ink">
      Sign out
    </button>
  );
}
