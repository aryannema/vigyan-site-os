'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import { deleteMediaObject } from './storage';

export function DeleteMediaButton({ name }: { name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-destructive"
        disabled={pending}
        onClick={() => {
          // eslint-disable-next-line no-alert
          if (!window.confirm(`Delete "${name}"? This cannot be undone, and any post referencing this image will show a broken image.`)) {
            return;
          }
          setError(null);
          startTransition(async () => {
            const result = await deleteMediaObject(name);
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
      >
        {pending ? 'Deleting…' : 'Delete'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
