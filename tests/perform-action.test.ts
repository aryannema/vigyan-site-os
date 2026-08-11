/**
 * `public.perform_action()` — authorization and audit as ONE operation.
 *
 * The design claim in 004 is that a caller cannot obtain the permission decision
 * without also producing the audit record, because there is a single function
 * that does both. That claim is only worth anything if:
 *
 *   * an allowed call really writes a correct `action_audit_log` row;
 *   * a denied call really RAISES (not "returns false") and writes NOTHING —
 *     including no partial row, which is what makes the atomicity claim real;
 *   * a session cannot pass somebody else's uuid as `p_actor` and borrow their
 *     capabilities. `perform_action` is SECURITY DEFINER, so without that check
 *     it would be a privilege-escalation primitive rather than an audit trail.
 *
 * Expected outcomes are derived from `role_capabilities` at run time; nothing
 * here hardcodes who may do what.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ROLES, RESOURCE_KEYS, ACTIONS } from '../types/schema';
import type { Role } from '../types/schema';
import {
  TestDb,
  expectedCapability,
  loadCapabilityMatrix,
  trackAssertions,
  type CapabilityMatrix,
} from './helpers/db';

/** Postgres SQLSTATEs this function is documented to raise. */
const INSUFFICIENT_PRIVILEGE = '42501';
const INVALID_PARAMETER_VALUE = '22023';

interface AuditRow {
  id: string;
  actor: string;
  actor_claim: string | null;
  resource_key: string;
  action: string;
  target_id: string | null;
  before_data: unknown;
  after_data: unknown;
  created_at: string;
}

let db: TestDb;
let matrix: CapabilityMatrix;
const users = new Map<Role, { id: string; email: string }>();

const uid = (role: Role): string => users.get(role)!.id;
const mail = (role: Role): string => users.get(role)!.email;

/** Audit rows written by any of this file's fixture users. */
async function auditRowsFor(actor: string): Promise<AuditRow[]> {
  await db.asOwner();
  return db.query<AuditRow & Record<string, unknown>>(
    `SELECT id, actor, actor_claim, resource_key, action, target_id, before_data, after_data, created_at
       FROM public.action_audit_log WHERE actor = $1 ORDER BY created_at`,
    [actor],
  ) as Promise<AuditRow[]>;
}

async function auditCount(): Promise<number> {
  await db.asOwner();
  const n = await db.value<string>('SELECT count(*)::text FROM public.action_audit_log');
  return Number(n);
}

trackAssertions('perform-action');

beforeAll(async () => {
  db = await TestDb.open('performaction');
  ({ matrix } = await loadCapabilityMatrix(db));
  for (const role of ROLES) {
    users.set(role, await db.createUser(role));
  }
});

afterAll(async () => {
  if (!db) return;
  const leaked = await db.rollbackAndVerify();
  expect(leaked).toEqual({ users: 0, roles: 0, inquiries: 0, audits: 0 });
  await db.close();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Allowed calls: succeed AND leave a correct record
 * ════════════════════════════════════════════════════════════════════════*/

describe('allowed actions', () => {
  it('returns a receipt and writes exactly one matching audit row', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      await db.loginAs(actor);

      const before = await auditCount();
      await db.loginAs(actor);

      const receipt = await db.value<Record<string, unknown>>(
        `SELECT public.perform_action($1, 'cms', 'edit', $2, $3::jsonb)`,
        [actor, 'hero-section', JSON.stringify({ before: { h: 'old' }, after: { h: 'new' } })],
      );

      expect(receipt).toMatchObject({
        ok: true,
        actor,
        actor_user_id: actor,
        resource_key: 'cms',
        action: 'edit',
        target_id: 'hero-section',
      });
      expect(typeof receipt.audit_id).toBe('string');

      const rows = await auditRowsFor(actor);
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.id).toBe(receipt.audit_id);
      expect(row.actor).toBe(actor);
      expect(row.resource_key).toBe('cms');
      expect(row.action).toBe('edit');
      expect(row.target_id).toBe('hero-section');
      // A payload carrying before/after is SPLIT across the two columns.
      expect(row.before_data).toEqual({ h: 'old' });
      expect(row.after_data).toEqual({ h: 'new' });
      expect(row.created_at).toBeTruthy();

      expect(await auditCount()).toBe(before + 1);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('accepts the 3-argument form (no target, no payload)', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      await db.loginAs(actor);
      const receipt = await db.value<Record<string, unknown>>(
        `SELECT public.perform_action($1, 'blog', 'view')`,
        [actor],
      );
      expect(receipt.ok).toBe(true);
      expect(receipt.target_id).toBeNull();

      const rows = await auditRowsFor(actor);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.target_id).toBeNull();
      expect(rows[0]!.before_data).toBeNull();
      expect(rows[0]!.after_data).toBeNull();
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('stores a payload with no before/after keys whole, in after_data', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      await db.loginAs(actor);
      await db.value(
        `SELECT public.perform_action($1, 'blog', 'create', 'post-1', $2::jsonb)`,
        [actor, JSON.stringify({ title: 'Hello', slug: 'hello' })],
      );
      const rows = await auditRowsFor(actor);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.before_data).toBeNull();
      expect(rows[0]!.after_data).toEqual({ title: 'Hello', slug: 'hello' });
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('stores a non-object payload whole, in after_data', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      await db.loginAs(actor);
      await db.value(
        `SELECT public.perform_action($1, 'blog', 'publish', 'post-1', '["a","b"]'::jsonb)`,
        [actor],
      );
      const rows = await auditRowsFor(actor);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.before_data).toBeNull();
      expect(rows[0]!.after_data).toEqual(['a', 'b']);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('a payload with only `before` leaves after_data NULL', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      await db.loginAs(actor);
      await db.value(
        `SELECT public.perform_action($1, 'crm', 'delete', 'lead-9', $2::jsonb)`,
        [actor, JSON.stringify({ before: { email: 'x@y.z' } })],
      );
      const rows = await auditRowsFor(actor);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.before_data).toEqual({ email: 'x@y.z' });
      expect(rows[0]!.after_data).toBeNull();
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('resolves an actor given as an email address, and records both spellings', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      const email = mail('admin');
      await db.loginAs(actor);
      const receipt = await db.value<Record<string, unknown>>(
        `SELECT public.perform_action($1, 'users', 'view')`,
        [email],
      );
      // CONTRACT CHANGE (008): `actor` is the RESOLVED identity, and the string
      // the caller supplied moves to `actor_claim`. Before 008, p_actor was
      // stored verbatim, so the same person acting as a uuid, as a braced uuid
      // and as an email produced three different `actor` values and an
      // "everything user X did" query silently under-reported. The claim is
      // still recorded — it is just no longer what attribution is keyed on.
      expect(receipt.actor).toBe(actor);
      expect(receipt.actor_claim).toBe(email);
      expect(receipt.actor_user_id).toBe(actor);

      const rows = await auditRowsFor(actor);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor).toBe(actor);
      expect(rows[0]!.actor_claim).toBe(email);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. Every role x every capability it is documented to hold / not hold
 * ════════════════════════════════════════════════════════════════════════*/

describe('perform_action() agrees with the capability matrix for every role', () => {
  // Only resources that exist as tagged tables; `payments` is exercised in the
  // permission-matrix suite where the function under test is the primitive.
  it.each(ROLES.map((role) => ({ role, name: role })))(
    '$name gets exactly the actions role_capabilities grants it',
    async ({ role }) => {
      await db.beginTest();
      try {
        const actor = uid(role);
        for (const resource of RESOURCE_KEYS) {
          for (const action of ACTIONS) {
            const allowed = expectedCapability(matrix, role, resource, action);
            await db.loginAs(actor);

            if (allowed) {
              const receipt = await db.value<Record<string, unknown>>(
                'SELECT public.perform_action($1, $2, $3)',
                [actor, resource, action],
              );
              expect(receipt.ok).toBe(true);
            } else {
              const err = await db.expectSqlError(
                'SELECT public.perform_action($1, $2, $3)',
                [actor, resource, action],
              );
              expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
              expect(err.message).toContain('is not permitted to');
            }
          }
        }

        // The audit log now holds one row per ALLOWED action and nothing else.
        const rows = await auditRowsFor(actor);
        const expectedRows = RESOURCE_KEYS.flatMap((resource) =>
          ACTIONS.filter((action) => expectedCapability(matrix, role, resource, action)),
        ).length;
        expect(rows).toHaveLength(expectedRows);
      } finally {
        await db.rollbackTest();
        await db.asOwner();
      }
    },
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Denied calls write nothing
 * ════════════════════════════════════════════════════════════════════════*/

describe('denied actions', () => {
  it('raise insufficient_privilege and leave the audit log untouched', async () => {
    await db.beginTest();
    try {
      const before = await auditCount();
      const actor = uid('viewer');
      await db.loginAs(actor);

      const err = await db.expectSqlError(
        `SELECT public.perform_action($1, 'cms', 'edit', 'hero-section', '{"after":{}}'::jsonb)`,
        [actor],
      );
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toContain('is not permitted to');

      expect(await auditCount()).toBe(before);
      expect(await auditRowsFor(actor)).toHaveLength(0);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('a user with no role row is denied everything and logs nothing', async () => {
    await db.beginTest();
    try {
      const roleless = await db.createUser(null);
      const before = await auditCount();
      await db.loginAs(roleless.id);
      for (const resource of RESOURCE_KEYS) {
        const err = await db.expectSqlError('SELECT public.perform_action($1, $2, $3)', [
          roleless.id,
          resource,
          'view',
        ]);
        expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
      expect(await auditCount()).toBe(before);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('rejects an unknown resource_key and an unknown action before touching the log', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      const before = await auditCount();
      await db.loginAs(actor);

      // Well-formed but ungoverned resource key: fails the capability check.
      const unknownResource = await db.expectSqlError(
        `SELECT public.perform_action($1, 'no_such_resource', 'view')`,
        [actor],
      );
      expect(unknownResource.code).toBe(INSUFFICIENT_PRIVILEGE);

      // Malformed resource key: rejected by argument validation instead.
      const badResource = await db.expectSqlError(
        `SELECT public.perform_action($1, 'CMS!', 'view')`,
        [actor],
      );
      expect(badResource.code).toBe(INVALID_PARAMETER_VALUE);
      expect(badResource.message).toContain('invalid resource_key');

      const badAction = await db.expectSqlError(
        `SELECT public.perform_action($1, 'cms', 'frobnicate')`,
        [actor],
      );
      expect(badAction.code).toBe(INVALID_PARAMETER_VALUE);
      expect(badAction.message).toContain('invalid action');

      expect(await auditCount()).toBe(before);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('rejects a NULL / blank actor', async () => {
    await db.beginTest();
    try {
      const before = await auditCount();
      await db.loginAs(uid('admin'));
      for (const bad of [null, '', '   ']) {
        const err = await db.expectSqlError(
          `SELECT public.perform_action($1::text, 'cms', 'view')`,
          [bad],
        );
        expect(err.code).toBe(INVALID_PARAMETER_VALUE);
        expect(err.message).toContain('p_actor is required');
      }
      expect(await auditCount()).toBe(before);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('anon cannot execute perform_action() at all', async () => {
    await db.asAnon();
    const err = await db.expectSqlError(
      `SELECT public.perform_action('someone', 'cms', 'view')`,
    );
    expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
    await db.asOwner();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Anti-impersonation — the reason this function is safe to be
 *    SECURITY DEFINER at all
 * ════════════════════════════════════════════════════════════════════════*/

describe('anti-impersonation', () => {
  it('refuses a session acting as another user, even when that user IS allowed', async () => {
    await db.beginTest();
    try {
      const victim = uid('admin');
      const attacker = uid('viewer');

      // Precondition: the borrowed identity really does hold the capability, so
      // a pass here would be a genuine escalation and not a lucky denial.
      await db.asOwner();
      expect(
        await db.value<boolean>(
          `SELECT public.user_has_capability($1::uuid, 'cms', 'delete')`,
          [victim],
        ),
      ).toBe(expectedCapability(matrix, 'admin', 'cms', 'delete'));
      expect(expectedCapability(matrix, 'admin', 'cms', 'delete')).toBe(true);

      const before = await auditCount();
      await db.loginAs(attacker);

      const err = await db.expectSqlError(
        `SELECT public.perform_action($1, 'cms', 'delete', 'hero-section')`,
        [victim],
      );
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toContain('does not match the authenticated session');

      // Nothing logged — not even a denied-attempt row under the victim's name,
      // which would have made the victim look responsible.
      expect(await auditCount()).toBe(before);
      expect(await auditRowsFor(victim)).toHaveLength(0);
      expect(await auditRowsFor(attacker)).toHaveLength(0);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('refuses impersonation by email as well as by uuid', async () => {
    await db.beginTest();
    try {
      await db.loginAs(uid('viewer'));
      const err = await db.expectSqlError(
        `SELECT public.perform_action($1, 'cms', 'edit')`,
        [mail('admin')],
      );
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toContain('does not match the authenticated session');
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('refuses an actor string that resolves to nobody while a session exists', async () => {
    await db.beginTest();
    try {
      await db.loginAs(uid('admin'));
      const err = await db.expectSqlError(
        `SELECT public.perform_action('nobody@nowhere.invalid', 'cms', 'edit')`,
      );
      // Unresolvable actor is DISTINCT FROM the caller, so the impersonation
      // check fires first — the caller is told the identities disagree, not that
      // the address is unknown, which is the right way round for disclosure.
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toContain('does not match the authenticated session');
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('every role is blocked from borrowing every other role', async () => {
    await db.beginTest();
    try {
      const before = await auditCount();
      for (const caller of ROLES) {
        for (const target of ROLES) {
          if (caller === target) continue;
          await db.loginAs(uid(caller));
          const err = await db.expectSqlError(
            `SELECT public.perform_action($1, 'crm', 'view')`,
            [uid(target)],
          );
          expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
          expect(err.message).toContain('does not match the authenticated session');
        }
      }
      expect(await auditCount()).toBe(before);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('a trusted server-side context (auth.uid() IS NULL) MAY act on a user\'s behalf', async () => {
    await db.beginTest();
    try {
      // This is the documented escape hatch in 004 §2: a NULL auth.uid() means
      // service-role / direct backend connection. Asserted so that a future
      // change which tightens or loosens it is a deliberate, visible decision.
      await db.asAuthenticatedWithoutSession();
      expect(await db.value<string | null>('SELECT auth.uid()')).toBeNull();

      const actor = uid('admin');
      const receipt = await db.value<Record<string, unknown>>(
        `SELECT public.perform_action($1, 'cms', 'edit', 'hero-section')`,
        [actor],
      );
      expect(receipt.ok).toBe(true);
      expect(receipt.actor_user_id).toBe(actor);
      expect(await auditRowsFor(actor)).toHaveLength(1);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('an unresolvable actor is refused even from a trusted context', async () => {
    await db.beginTest();
    try {
      await db.asAuthenticatedWithoutSession();
      const before = await auditCount();
      const err = await db.expectSqlError(
        `SELECT public.perform_action('nobody@nowhere.invalid', 'cms', 'edit')`,
      );
      expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      expect(err.message).toContain('could not be resolved');
      expect(await auditCount()).toBe(before);
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. The audit log is not writable any other way
 * ════════════════════════════════════════════════════════════════════════*/

describe('action_audit_log is append-only through perform_action()', () => {
  it('authenticated callers cannot INSERT, UPDATE or DELETE it directly', async () => {
    await db.beginTest();
    try {
      await db.loginAs(uid('admin'));
      for (const stmt of [
        `INSERT INTO public.action_audit_log (actor, resource_key, action) VALUES ('x','cms','edit')`,
        `UPDATE public.action_audit_log SET action = 'view'`,
        `DELETE FROM public.action_audit_log`,
      ]) {
        const err = await db.expectSqlError(stmt);
        // No table GRANT for these commands (004), so this is refused before any
        // policy is even consulted.
        expect(err.code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });

  it('reading the log requires users:view', async () => {
    await db.beginTest();
    try {
      const actor = uid('admin');
      await db.loginAs(actor);
      await db.value(`SELECT public.perform_action($1, 'cms', 'edit', 'hero')`, [actor]);

      for (const role of ROLES) {
        await db.loginAs(uid(role));
        const rows = await db.query('SELECT id FROM public.action_audit_log');
        const canRead = expectedCapability(matrix, role, 'users', 'view');
        if (canRead) {
          expect(rows.length).toBeGreaterThan(0);
        } else {
          expect(rows).toHaveLength(0);
        }
      }
    } finally {
      await db.rollbackTest();
      await db.asOwner();
    }
  });
});
