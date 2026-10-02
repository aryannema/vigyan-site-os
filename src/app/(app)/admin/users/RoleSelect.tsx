'use client';

import { useState, useTransition } from 'react';

import { ROLES } from '@/types/schema';
import { Select } from '@/components/ui/select';

import { setUserRole } from './actions';

interface RoleSelectProps {
  userId: string;
  role: string | null;
}

export function RoleSelect({ userId, role }: RoleSelectProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      <Select
        className="h-8 w-44"
        defaultValue={role ?? ''}
        disabled={isPending}
        aria-label="Role"
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (!next) return;
          startTransition(async () => {
            const result = await setUserRole(userId, next);
            setError(result.ok ? null : result.error);
          });
        }}
      >
        <option value="" disabled>
          No role
        </option>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </Select>
      {isPending ? <span className="text-xs text-muted">Saving…</span> : null}
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </div>
  );
}
