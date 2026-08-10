/**
 * The permission matrix, proved rather than asserted.
 *
 * `public.user_has_capability(uuid, resource_key, action)` is the single
 * authorization primitive in this schema — every RLS policy in 003, the PII
 * masking rule in 005 and `perform_action()` in 004 all defer to it. If it is
 * wrong, everything downstream is wrong, and the failure mode is silent.
 *
 * ── What is being tested, and what is deliberately NOT ──────────────────────
 * These tests check THE MECHANISM, not today's grants. Expectations are loaded
 * from `role_capabilities` at run time, so:
 *
 *   * an operator who revokes `crm:view` from `viewer` does not break the suite;
 *   * a bug in `user_has_capability()` — a wrong join, a NULL leaking out, an
 *     implicit allow — does.
 *
 * The one thing hardcoded is the SHAPE of the vocabulary (6 roles x 5 resources
 * x 5 actions = 150 combinations), because that comes from `types/schema.ts`,
 * which is the compile-time contract the application codes against.
 *
 * ── Deny by default ─────────────────────────────────────────────────────────
 * Most of those 150 combinations have NO row in `role_capabilities` at all.
 * Those are the interesting ones: they must return `false`, not NULL and not an
 * error, because `USING (user_has_capability(...))` in a policy turns anything
 * ambiguous into a security decision nobody made.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { ROLES, RESOURCE_KEYS, ACTIONS } from '../types/schema';
import type { Role, ResourceKey, Action } from '../types/schema';
import {
  TestDb,
  capKey,
  databaseUrl,
  expectedCapability,
  loadCapabilityMatrix,
  trackAssertions,
  type CapabilityMatrix,
  type GrantRow,
} from './helpers/db';

interface Combo {
  role: Role;
  resource: ResourceKey;
  action: Action;
  name: string;
}

const COMBINATIONS: Combo[] = ROLES.flatMap((role) =>
  RESOURCE_KEYS.flatMap((resource) =>
    ACTIONS.map((action) => ({
      role,
      resource,
      action,
      name: `${role} / ${resource}:${action}`,
    })),
  ),
);

let db: TestDb;
let matrix: CapabilityMatrix;
let grantRows: GrantRow[];
/** role -> the fixture user holding it. */
const userIdByRole = new Map<Role, string>();
/** `role|resource|action` -> what user_has_capability() actually returned. */
const actual = new Map<string, unknown>();
/** An authenticated user with no `user_roles` row. */
let rolelessUserId = '';

trackAssertions('permission-matrix');

beforeAll(async () => {
  db = await TestDb.open('permmatrix');

  ({ rows: grantRows, matrix } = await loadCapabilityMatrix(db));

  for (const role of ROLES) {
    const user = await db.createUser(role);
    userIdByRole.set(role, user.id);
  }
  rolelessUserId = (await db.createUser(null)).id;

  // One round trip for all 150 combinations. Evaluating them in a single
  // statement also proves the function is usable in a set-returning context,
  // which is how RLS actually calls it (once per candidate row).
  const roleNames = ROLES.map((r) => r);
  const userIds = roleNames.map((r) => userIdByRole.get(r)!);

  const rows = await db.query<{
    role: string;
    resource_key: string;
    action: string;
    allowed: unknown;
  }>(
    `SELECT u.role,
            r.resource_key,
            a.action,
            public.user_has_capability(u.user_id, r.resource_key, a.action) AS allowed
       FROM unnest($1::text[], $2::uuid[]) AS u(role, user_id)
       CROSS JOIN unnest($3::text[])      AS r(resource_key)
       CROSS JOIN unnest($4::text[])      AS a(action)`,
    [roleNames, userIds, [...RESOURCE_KEYS], [...ACTIONS]],
  );

  for (const row of rows) {
    actual.set(capKey(row.role, row.resource_key, row.action), row.allowed);
  }
});

afterAll(async () => {
  if (!db) return;
  const leaked = await db.rollbackAndVerify();
  expect(leaked).toEqual({ users: 0, roles: 0, inquiries: 0, audits: 0 });
  await db.close();
});

/* ══════════════════════════════════════════════════════════════════════════
 * 1. The vocabulary itself
 * ════════════════════════════════════════════════════════════════════════*/

describe('permission vocabulary', () => {
  it('the database agrees with types/schema.ts about which roles exist', async () => {
    await db.asOwner();
    const rows = await db.query<{ role: string }>(
      `SELECT DISTINCT role FROM public.role_capabilities ORDER BY role`,
    );
    for (const row of rows) {
      expect(ROLES as readonly string[]).toContain(row.role);
    }
    // Nothing in role_capabilities may reference a role the CHECK constraint
    // does not allow; the constraint is what makes that true, so this is really
    // a guard against the constraint being dropped.
    expect(rows.length).toBeLessThanOrEqual(ROLES.length);
  });

  it('the `resources` view derives exactly the documented resource keys', async () => {
    await db.asOwner();
    const rows = await db.query<{ resource_key: string }>(
      'SELECT resource_key FROM public.resources ORDER BY resource_key',
    );
    const derived = rows.map((r) => r.resource_key).sort();
    expect(derived).toEqual([...RESOURCE_KEYS].sort());
  });

  it('every action recorded in role_capabilities is a known action', () => {
    for (const row of grantRows) {
      expect(ACTIONS as readonly string[]).toContain(row.action);
    }
  });

  it('the seeded matrix is non-empty (a wiped matrix would make everything pass vacuously)', () => {
    expect(grantRows.length).toBeGreaterThan(0);
    expect(grantRows.some((r) => r.allowed)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The 150 combinations
 * ════════════════════════════════════════════════════════════════════════*/

describe('user_has_capability() over all 6 roles x 5 resources x 5 actions', () => {
  it('covers exactly 150 combinations', () => {
    expect(COMBINATIONS).toHaveLength(150);
    expect(actual.size).toBe(150);
  });

  it.each(COMBINATIONS)('$name', ({ role, resource, action }) => {
    const got = actual.get(capKey(role, resource, action));
    const want = expectedCapability(matrix, role, resource, action);

    // Contract: a real boolean, never NULL/undefined. A NULL here would be
    // read as "false" by RLS but as truthy-ish ambiguity by application code.
    expect(typeof got).toBe('boolean');
    expect(got).toBe(want);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. Deny by default, stated directly
 * ════════════════════════════════════════════════════════════════════════*/

describe('deny by default', () => {
  it('every combination with no row in role_capabilities resolves to false', () => {
    const ungranted = COMBINATIONS.filter(
      ({ role, resource, action }) => !matrix.has(capKey(role, resource, action)),
    );
    // The default matrix grants ~47 of 150; if this ever hits zero the test
    // below would be vacuous, so assert there is something to check.
    expect(ungranted.length).toBeGreaterThan(0);
    for (const { role, resource, action } of ungranted) {
      expect(actual.get(capKey(role, resource, action))).toBe(false);
    }
  });

  it('the number of allowed combinations matches the number of allowed grants', () => {
    const trueCount = [...actual.values()].filter((v) => v === true).length;
    const expectedTrue = grantRows.filter(
      (r) =>
        r.allowed &&
        (ROLES as readonly string[]).includes(r.role) &&
        (RESOURCE_KEYS as readonly string[]).includes(r.resource_key) &&
        (ACTIONS as readonly string[]).includes(r.action),
    ).length;
    expect(trueCount).toBe(expectedTrue);
  });

  it('an explicit allowed = false row denies, exactly like a missing row', async () => {
    await db.beginTest();
    try {
      await db.asOwner();
      const viewer = userIdByRole.get('viewer')!;

      // `careers:view` is ungranted for viewer in the default matrix; record an
      // EXPLICIT deny and confirm it reads the same as the absence did.
      await db.query(
        `INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
         VALUES ('viewer', 'careers', 'view', false)
         ON CONFLICT (role, resource_key, action) DO UPDATE SET allowed = false`,
      );
      const denied = await db.value<unknown>(
        `SELECT public.user_has_capability($1::uuid, 'careers', 'view')`,
        [viewer],
      );
      expect(denied).toBe(false);
      expect(typeof denied).toBe('boolean');

      // ...and flipping the same row to true grants it, proving the function is
      // reading this table and not a cached/derived copy of it.
      await db.query(
        `UPDATE public.role_capabilities SET allowed = true
          WHERE role = 'viewer' AND resource_key = 'careers' AND action = 'view'`,
      );
      const allowed = await db.value<unknown>(
        `SELECT public.user_has_capability($1::uuid, 'careers', 'view')`,
        [viewer],
      );
      expect(allowed).toBe(true);
    } finally {
      await db.rollbackTest();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Grants outside the compile-time resource list
 * ════════════════════════════════════════════════════════════════════════*/

describe('grants on resource keys with no tagged table', () => {
  it('every row in role_capabilities agrees with user_has_capability(), including `payments`', async () => {
    await db.asOwner();
    // `payments` is seeded in 003 §6 but has no table tagged `resource:payments`
    // yet (Phase 3). It must still resolve — resource_key is free text by design,
    // so the check cannot be gated on the `resources` view.
    const offMatrix = grantRows.filter(
      (r) => !(RESOURCE_KEYS as readonly string[]).includes(r.resource_key),
    );
    expect(offMatrix.length).toBeGreaterThan(0);

    for (const row of grantRows) {
      const userId = userIdByRole.get(row.role as Role);
      if (!userId) continue;
      const got = await db.value<unknown>(
        'SELECT public.user_has_capability($1::uuid, $2, $3)',
        [userId, row.resource_key, row.action],
      );
      expect(got).toBe(row.allowed);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Edge cases — everything ambiguous must land on `false`
 * ════════════════════════════════════════════════════════════════════════*/

describe('edge cases', () => {
  const check = async (
    userIdSql: string,
    resource: string | null,
    action: string | null,
    params: unknown[],
  ): Promise<unknown> =>
    db.value<unknown>(
      `SELECT public.user_has_capability(${userIdSql}, $${params.length + 1}, $${params.length + 2})`,
      [...params, resource, action],
    );

  it('a NULL user id is false, not NULL', async () => {
    await db.asOwner();
    const got = await db.value<unknown>(
      `SELECT public.user_has_capability(NULL::uuid, 'cms', 'view')`,
    );
    expect(got).toBe(false);
    expect(typeof got).toBe('boolean');
    expect(got).not.toBeNull();
  });

  it('an unknown user id (no auth.users row at all) is false', async () => {
    await db.asOwner();
    // A random uuid that is not in auth.users. Every resource/action pair.
    const ghost = '00000000-0000-4000-8000-0000000feed0';
    for (const resource of RESOURCE_KEYS) {
      for (const action of ACTIONS) {
        const got = await db.value<unknown>(
          'SELECT public.user_has_capability($1::uuid, $2, $3)',
          [ghost, resource, action],
        );
        expect(got).toBe(false);
      }
    }
  });

  it('a real user with no user_roles row is denied everything', async () => {
    await db.asOwner();
    const rows = await db.query<{ resource_key: string; action: string; allowed: unknown }>(
      `SELECT r.resource_key, a.action,
              public.user_has_capability($1::uuid, r.resource_key, a.action) AS allowed
         FROM unnest($2::text[]) AS r(resource_key)
         CROSS JOIN unnest($3::text[]) AS a(action)`,
      [rolelessUserId, [...RESOURCE_KEYS], [...ACTIONS]],
    );
    expect(rows).toHaveLength(25);
    for (const row of rows) {
      expect(row.allowed).toBe(false);
    }
    // ...and the user really does exist, so this is not a false negative from a
    // missing fixture.
    const exists = await db.value<string>('SELECT count(*) FROM auth.users WHERE id = $1', [
      rolelessUserId,
    ]);
    expect(Number(exists)).toBe(1);
  });

  it('an unknown resource_key is false for every role', async () => {
    await db.asOwner();
    for (const role of ROLES) {
      const got = await db.value<unknown>(
        `SELECT public.user_has_capability($1::uuid, 'no_such_resource', 'view')`,
        [userIdByRole.get(role)!],
      );
      expect(got).toBe(false);
    }
  });

  it('an unknown action is false for every role', async () => {
    await db.asOwner();
    for (const role of ROLES) {
      const got = await db.value<unknown>(
        `SELECT public.user_has_capability($1::uuid, 'cms', 'frobnicate')`,
        [userIdByRole.get(role)!],
      );
      expect(got).toBe(false);
    }
  });

  it('NULL / empty / whitespace resource_key and action are false, never NULL', async () => {
    await db.asOwner();
    const admin = userIdByRole.get('admin')!;
    const cases: Array<[string | null, string | null]> = [
      [null, 'view'],
      ['cms', null],
      [null, null],
      ['', ''],
      ['', 'view'],
      ['cms', ''],
      ['  cms  ', 'view'],
      ['cms', ' view'],
    ];
    for (const [resource, action] of cases) {
      const got = await check('$1::uuid', resource, action, [admin]);
      expect(got).toBe(false);
      expect(typeof got).toBe('boolean');
    }
  });

  it('resource keys and actions are case sensitive (no accidental widening)', async () => {
    await db.asOwner();
    const admin = userIdByRole.get('admin')!;
    for (const [resource, action] of [
      ['CMS', 'view'],
      ['cms', 'VIEW'],
      ['Cms', 'View'],
    ] as const) {
      expect(
        await db.value<unknown>('SELECT public.user_has_capability($1::uuid, $2, $3)', [
          admin,
          resource,
          action,
        ]),
      ).toBe(false);
    }
    // Sanity: the lowercase form the loop is contrasted against IS granted.
    expect(
      await db.value<unknown>(`SELECT public.user_has_capability($1::uuid, 'cms', 'view')`, [
        admin,
      ]),
    ).toBe(expectedCapability(matrix, 'admin', 'cms', 'view'));
  });

  it('hostile strings are denied and do not raise (parameterised, no injection)', async () => {
    await db.asOwner();
    const admin = userIdByRole.get('admin')!;
    const hostile = [
      "cms' OR '1'='1",
      'cms; DROP TABLE role_capabilities;--',
      '%',
      '_ms',
      'cms%',
      '*',
    ];
    for (const resource of hostile) {
      const got = await db.value<unknown>(
        'SELECT public.user_has_capability($1::uuid, $2, $3)',
        [admin, resource, 'view'],
      );
      expect(got).toBe(false);
    }
    // The table is still there, i.e. nothing was executed.
    const count = await db.value<string>('SELECT count(*) FROM public.role_capabilities');
    expect(Number(count)).toBe(grantRows.length);
  });

  it('a malformed uuid raises a type error rather than silently allowing', async () => {
    await db.asOwner();
    const err = await db.expectSqlError(
      `SELECT public.user_has_capability('not-a-uuid'::uuid, 'cms', 'view')`,
    );
    expect(err.code).toBe('22P02'); // invalid_text_representation
  });

  it('two users sharing a role get identical answers (the grant is on the role, not the user)', async () => {
    await db.beginTest();
    try {
      const second = await db.createUser('editor');
      await db.asOwner();
      for (const resource of RESOURCE_KEYS) {
        for (const action of ACTIONS) {
          const a = await db.value<unknown>(
            'SELECT public.user_has_capability($1::uuid, $2, $3)',
            [userIdByRole.get('editor')!, resource, action],
          );
          const b = await db.value<unknown>(
            'SELECT public.user_has_capability($1::uuid, $2, $3)',
            [second.id, resource, action],
          );
          expect(b).toBe(a);
        }
      }
    } finally {
      await db.rollbackTest();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. The function behaves the same for the role the application actually uses
 * ════════════════════════════════════════════════════════════════════════*/

describe('called as the `authenticated` Postgres role', () => {
  it('SECURITY DEFINER lets a signed-in session evaluate its own capabilities', async () => {
    for (const role of ROLES) {
      const userId = userIdByRole.get(role)!;
      await db.loginAs(userId);

      const who = await db.one<{ current_user: string; uid: string | null }>(
        'SELECT current_user, auth.uid() AS uid',
      );
      expect(who.current_user).toBe('authenticated');
      expect(who.uid).toBe(userId);

      for (const resource of RESOURCE_KEYS) {
        for (const action of ACTIONS) {
          const got = await db.value<unknown>(
            'SELECT public.user_has_capability(auth.uid(), $1, $2)',
            [resource, action],
          );
          expect(got).toBe(expectedCapability(matrix, role, resource, action));
        }
      }
    }
    await db.asOwner();
  });

  it('an authenticated session with no JWT (auth.uid() IS NULL) has no capabilities', async () => {
    await db.asAuthenticatedWithoutSession();
    const uid = await db.value<string | null>('SELECT auth.uid()');
    expect(uid).toBeNull();
    for (const resource of RESOURCE_KEYS) {
      for (const action of ACTIONS) {
        expect(
          await db.value<unknown>(
            'SELECT public.user_has_capability(auth.uid(), $1, $2)',
            [resource, action],
          ),
        ).toBe(false);
      }
    }
    await db.asOwner();
  });

  it('anon cannot even execute the capability functions', async () => {
    await db.asAnon();
    const err = await db.expectSqlError(
      `SELECT public.user_has_capability(NULL::uuid, 'cms', 'view')`,
    );
    expect(err.code).toBe('42501'); // insufficient_privilege
    const err2 = await db.expectSqlError('SELECT public.get_user_role()');
    expect(err2.code).toBe('42501');
    await db.asOwner();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. Isolation, proved from outside this connection
 * ════════════════════════════════════════════════════════════════════════*/

describe('test isolation', () => {
  it('fixture rows are invisible to every other connection', async () => {
    const other = new pg.Client({ connectionString: databaseUrl() });
    await other.connect();
    try {
      const ids = [...db.createdUserIds];
      const res = await other.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM auth.users WHERE id = ANY($1::uuid[])',
        [ids],
      );
      expect(ids.length).toBeGreaterThan(0);
      expect(Number(res.rows[0]!.n)).toBe(0);

      const roles = await other.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM public.user_roles WHERE user_id = ANY($1::uuid[])',
        [ids],
      );
      expect(Number(roles.rows[0]!.n)).toBe(0);
    } finally {
      await other.end();
    }
  });
});
