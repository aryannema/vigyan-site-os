'use server';

import { revalidatePath } from 'next/cache';

import { isAction, isRole, type Action, type Role } from '@/types/schema';

import { mutate, query, toFormError } from '../../lib/db';

export interface SetCapabilityInput {
  role: string;
  resourceKey: string;
  action: string;
  allowed: boolean;
}

export type SetCapabilityResult =
  | { ok: true; role: Role; resourceKey: string; action: Action; allowed: boolean }
  | { ok: false; error: string };

/**
 * The set of resource keys a grant may be created for.
 *
 * `role_capabilities.resource_key` is free text by design (003 §4) so a resource
 * becomes grantable the moment its table is tagged — but "free text in the
 * schema" is not a reason for a UI to write arbitrary strings into it. The
 * allowed set is therefore derived at request time from the two live sources of
 * truth: the `resources` view (tables tagged `resource:<key>`) and the keys the
 * matrix already contains (which is how `payments`, seeded ahead of its table,
 * stays editable).
 */
async function allowedResourceKeys(): Promise<Set<string>> {
  const rows = await query<{ resource_key: string }>(
    `SELECT resource_key FROM public.resources WHERE resource_key IS NOT NULL
     UNION
     SELECT DISTINCT resource_key FROM public.role_capabilities`,
  );
  return new Set(rows.map((r) => r.resource_key));
}

/**
 * Toggling this cell off would remove the only capability that can be used to
 * edit the matrix once the admin UI is auth-gated (`users:edit` on `admin`).
 * Refused rather than silently allowed — recovery would mean an operator going
 * to psql, which is a bad thing to discover after the fact.
 */
function isMatrixLockout(role: string, resourceKey: string, action: string, allowed: boolean) {
  return !allowed && role === 'admin' && resourceKey === 'users' && action === 'edit';
}

export async function setCapability(input: SetCapabilityInput): Promise<SetCapabilityResult> {
  const { role, resourceKey, action, allowed } = input;

  // Validate against the shared contract. `role` and `action` are also CHECK
  // constrained in the database, so this is defence in depth rather than the
  // only gate — but it produces a readable message instead of a 23514.
  if (!isRole(role)) return { ok: false, error: `Unknown role: ${role}` };
  if (!isAction(action)) return { ok: false, error: `Unknown action: ${action}` };
  if (typeof allowed !== 'boolean') return { ok: false, error: 'allowed must be a boolean' };
  if (!/^[a-z0-9_]+$/.test(resourceKey)) {
    return { ok: false, error: `Invalid resource key: ${resourceKey}` };
  }
  if (!(await allowedResourceKeys()).has(resourceKey)) {
    return { ok: false, error: `Unknown resource: ${resourceKey}` };
  }
  if (isMatrixLockout(role, resourceKey, action, allowed)) {
    return {
      ok: false,
      error:
        'Refused: admin + users + edit is the capability that governs this page. ' +
        'Removing it would make the matrix uneditable from the UI.',
    };
  }

  try {
    await mutate(async (client) => {
      // Read the prior state inside the transaction so the audit row records what
      // was actually replaced, and so a concurrent edit cannot be misattributed.
      const before = await client.query<{ allowed: boolean }>(
        `SELECT allowed FROM public.role_capabilities
          WHERE role = $1 AND resource_key = $2 AND action = $3
          FOR UPDATE`,
        [role, resourceKey, action],
      );

      // Never DELETE. `allowed = false` is an explicit, auditable deny; a missing
      // row is "no opinion". Both evaluate to denied (003 §4), and collapsing the
      // two would throw away the record of a deliberate revocation.
      await client.query(
        `INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (role, resource_key, action)
         DO UPDATE SET allowed = EXCLUDED.allowed`,
        [role, resourceKey, action, allowed],
      );

      return {
        result: undefined,
        audit: {
          // Governed by users:edit — see the capability that gates this screen.
          resourceKey: 'users',
          action: 'edit' as const,
          targetId: `role_capabilities:${role}:${resourceKey}:${action}`,
          before: { allowed: before.rows[0]?.allowed ?? null },
          after: { allowed },
        },
      };
    });
  } catch (error) {
    return { ok: false, error: toFormError(error) };
  }

  revalidatePath('/admin/users/capabilities');
  revalidatePath('/admin/users');
  return { ok: true, role, resourceKey, action, allowed };
}
