'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export default function ResolveButton({ phoneNumber }: { phoneNumber: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleResolve() {
    setError(null);
    const res = await fetch(`/api/admin/whatsapp/${encodeURIComponent(phoneNumber)}/resolve`, {
      method: 'POST',
    });
    if (!res.ok) {
      setError('Failed to mark resolved');
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button onClick={handleResolve} disabled={isPending} variant="default" size="sm">
        {isPending ? 'Resolving…' : 'Mark resolved — back to auto'}
      </Button>
    </div>
  );
}
