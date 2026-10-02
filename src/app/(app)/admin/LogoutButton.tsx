'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function LogoutButton({ collapsed }: { collapsed?: boolean }) {
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (collapsed) {
    return (
      <button
        onClick={handleLogout}
        className="mt-2 flex h-8 w-full items-center justify-center rounded-md text-muted transition hover:bg-red-500/10 hover:text-red-600"
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      className="mt-2 w-full rounded-md px-3 py-2 text-left text-xs font-bold text-muted transition hover:bg-red-500/10 hover:text-red-600"
    >
      Sign out
    </button>
  );
}
