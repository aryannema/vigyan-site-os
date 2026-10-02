'use server';

import { revalidatePath } from 'next/cache';

import { currentKeyVersion } from '@/lib/app-secrets';
import { rotateKeys, versionCounts } from '@/lib/key-rotation';

import { mutate } from '../../lib/db';
import { toFormState, type FormState } from '../../lib/form';

/**
 * Key rotation, run by an administrator.
 *
 * Through mutate() so the capability check and the audit row are one
 * transaction — rotating the key that protects every stored secret is the last
 * thing that should happen unattributed.
 */
export async function runRotation(_prev: FormState): Promise<FormState> {
  try {
    const target = currentKeyVersion();

    const before = await versionCounts();
    const stale = before.filter((c) => c.version !== target);
    if (stale.length === 0) {
      return { success: `Nothing to do — everything is already on key v${target}.` };
    }

    // Permission first. mutate() runs its callback BEFORE perform_action checks
    // the capability, and rotateKeys writes outside that transaction, so doing
    // the rotation inside the callback let any signed-in user re-encrypt every
    // secret before being refused. This call does nothing but authorise + audit.
    await mutate(async () => ({
      result: undefined,
      audit: {
        resourceKey: 'settings',
        action: 'edit' as const,
        targetId: 'encryption_key_rotation',
        before: { versions: stale.map((s) => `${s.source} v${s.version} x${s.row_count}`) },
        after: { to_version: target, started: true },
      },
    }));

    const result = await rotateKeys('admin-ui');

    revalidatePath('/admin/settings/keys');

    const r = result as { rowsRotated: number; rowsTotal: number };
    return {
      success:
        `Re-encrypted ${r.rowsRotated} of ${r.rowsTotal} values onto key v${target}. ` +
        `Check the report below before removing any old key from the environment.`,
    };
  } catch (error) {
    // A failed rotation is surfaced, never swallowed: it leaves rows on two
    // versions, and an operator who thinks it succeeded may delete a key those
    // rows still need.
    console.error('[keys] rotation failed:', error);
    const reason = error instanceof Error ? error.message : String(error);
    return toFormState(error, `The rotation did not complete (${reason}). Keep every existing key in place.`);
  }
}
