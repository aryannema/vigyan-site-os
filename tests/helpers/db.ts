/**
 * Integration-test harness for the vigyan-site-os permission system.
 *
 * These tests run against the REAL local Postgres database named in
 * `DATABASE_URL` (see `.env.local`). Nothing is mocked: RLS, SECURITY DEFINER
 * functions and view ownership only behave correctly on a real server, and a
 * mock of `user_has_capability()` would only ever prove that the mock agrees
 * with itself.
 *
 * ── Isolation contract ──────────────────────────────────────────────────────
 * Every test file:
 *   1. opens ONE dedicated connection,
 *   2. issues a single `BEGIN` in `beforeAll`,
 *   3. does all of its fixture creation and assertions inside that transaction,
 *      with a SAVEPOINT taken/rolled back around every individual test,
 *   4. `ROLLBACK`s in `afterAll` and then asserts that none of its fixture rows
 *      survive.
 *
 * Because the transaction is never committed, fixture rows are invisible to
 * every other connection for their entire lifetime, so parallel test files (and
 * anything else using the database) cannot see or collide with them.
 *
 * ── Identity ────────────────────────────────────────────────────────────────
 * There is no GoTrue in this phase. `supabase/migrations/000_local_auth_stub.sql`
 * provides `auth.local_login(uuid)`, which stuffs a fake JWT claims blob into the
 * `request.jwt.claims` GUC so `auth.uid()` resolves. Two things about it matter
 * for tests and are handled here:
 *
 *   * it is owner-only (`REVOKE ALL ... FROM PUBLIC`), so it must be called
 *     BEFORE switching to the `authenticated` role, not after;
 *   * it uses `set_config(..., is_local => false)`, i.e. the claims are SESSION
 *     scoped and DO NOT unwind on `ROLLBACK`. `logout()` is therefore called
 *     explicitly during teardown rather than being left to the transaction.
 *
 * ── Why the role switch matters ─────────────────────────────────────────────
 * `DATABASE_URL` connects as `vigyan_site_os`, which OWNS every table. A table
 * owner bypasses its own RLS (003 §7 deliberately does not use FORCE ROW LEVEL
 * SECURITY). Any test that means to exercise a POLICY must therefore run under
 * `SET LOCAL ROLE authenticated`; tests that only exercise a function's own
 * logic may run as the owner.
 */

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, expect } from 'vitest';
import type { Role } from '../../types/schema';

const { Client } = pg;

/* ────────────────────────────────────────────────────────────────────────────
 * Environment
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Reads `DATABASE_URL`. `process.env` wins (so CI can inject it); otherwise
 * `.env.local` at the repo root is parsed directly — there is no dotenv
 * dependency in this project and adding one is outside this suite's scope.
 */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const envPath = fileURLToPath(new URL('../../.env.local', import.meta.url));
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(
      `DATABASE_URL is not set and ${envPath} could not be read. These are ` +
        `integration tests and require a live Postgres instance.`,
    );
  }

  for (const line of raw.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m || m[1] !== 'DATABASE_URL') continue;
    let value = (m[2] ?? '').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }

  throw new Error(`No DATABASE_URL found in ${envPath}.`);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Test database handle
 * ──────────────────────────────────────────────────────────────────────────*/

export type Row = Record<string, unknown>;

/** A Postgres error as thrown by node-postgres, narrowed to what we assert on. */
export interface SqlError extends Error {
  code?: string;
  message: string;
}

export class TestDb {
  private constructor(
    readonly client: pg.Client,
    private readonly label: string,
  ) {}

  private savepointSeq = 0;
  private readonly fixtureUserIds: string[] = [];
  private readonly fixtureInquiryIds: string[] = [];
  private open = false;

  /** Connect and enter the file-wide transaction. */
  static async open(label: string): Promise<TestDb> {
    const client = new Client({ connectionString: databaseUrl() });
    await client.connect();
    const db = new TestDb(client, label);
    // Start from a known identity: no JWT claims, owner role.
    await client.query('RESET ROLE');
    await client.query('SELECT auth.local_logout()');
    await client.query('BEGIN');
    db.open = true;
    return db;
  }

  async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.client.query<T>(text, params);
    return res.rows;
  }

  /** Exactly one row expected. Throws otherwise — a shape bug should fail loudly. */
  async one<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(text, params);
    if (rows.length !== 1) {
      throw new Error(`Expected exactly 1 row from \`${text}\`, got ${rows.length}`);
    }
    return rows[0] as T;
  }

  /** First column of the first row. */
  async value<T>(text: string, params: unknown[] = []): Promise<T> {
    const row = await this.one(text, params);
    return Object.values(row)[0] as T;
  }

  /* ── identity ───────────────────────────────────────────────────────────*/

  /** Drop back to the connection owner (`vigyan_site_os`), which bypasses RLS. */
  async asOwner(): Promise<void> {
    await this.client.query('RESET ROLE');
  }

  /**
   * Impersonate `userId` as the `authenticated` Postgres role — i.e. exactly
   * what a signed-in browser session looks like to the policies.
   * Login happens as the owner because `auth.local_login` is owner-only.
   */
  async loginAs(userId: string): Promise<void> {
    await this.client.query('RESET ROLE');
    await this.client.query('SELECT auth.local_login($1::uuid)', [userId]);
    await this.client.query('SET LOCAL ROLE authenticated');
  }

  /** A signed-out visitor: no JWT claims, `anon` Postgres role. */
  async asAnon(): Promise<void> {
    await this.client.query('RESET ROLE');
    await this.client.query('SELECT auth.local_logout()');
    await this.client.query('SET LOCAL ROLE anon');
  }

  /**
   * An authenticated Postgres role with NO resolvable session — the shape a
   * request with a missing/blank JWT takes. `auth.uid()` is NULL.
   */
  async asAuthenticatedWithoutSession(): Promise<void> {
    await this.client.query('RESET ROLE');
    await this.client.query('SELECT auth.local_logout()');
    await this.client.query('SET LOCAL ROLE authenticated');
  }

  /** Clear the (session-scoped, rollback-surviving) JWT claims. */
  async logout(): Promise<void> {
    await this.client.query('RESET ROLE');
    await this.client.query('SELECT auth.local_logout()');
  }

  /* ── savepoints ─────────────────────────────────────────────────────────*/

  /** Per-test nesting: anything a test writes is undone by `releaseTest()`. */
  async beginTest(): Promise<void> {
    await this.client.query('SAVEPOINT test_case');
  }

  async rollbackTest(): Promise<void> {
    await this.client.query('ROLLBACK TO SAVEPOINT test_case');
    await this.client.query('RELEASE SAVEPOINT test_case');
  }

  /**
   * Run a statement that is EXPECTED to fail and return the error.
   *
   * Wrapped in its own savepoint because a failed statement poisons the
   * enclosing transaction — without this, one expected denial would abort every
   * later query in the file.
   */
  async expectSqlError(text: string, params: unknown[] = []): Promise<SqlError> {
    const name = `err_${++this.savepointSeq}`;
    await this.client.query(`SAVEPOINT ${name}`);
    try {
      await this.client.query(text, params);
    } catch (err) {
      await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await this.client.query(`RELEASE SAVEPOINT ${name}`);
      return err as SqlError;
    }
    await this.client.query(`RELEASE SAVEPOINT ${name}`);
    throw new Error(`Expected \`${text}\` to raise, but it succeeded.`);
  }

  /** Convenience: assert a statement succeeds, returning its rows. */
  async expectSqlOk<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
    return this.query<T>(text, params);
  }

  /* ── fixtures ───────────────────────────────────────────────────────────*/

  /**
   * Create an `auth.users` row, optionally with a `user_roles` row.
   * `role: null` produces the "authenticated but ungranted" user that the
   * deny-by-default tests need.
   */
  async createUser(role: Role | null): Promise<{ id: string; email: string }> {
    await this.asOwner();
    const email = `${this.label}-${role ?? 'norole'}-${randomUUID()}@vigyan-site-os.test`;
    const { id } = await this.one<{ id: string }>(
      'INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), $1) RETURNING id',
      [email],
    );
    if (role !== null) {
      await this.query('INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2)', [
        id,
        role,
      ]);
    }
    this.fixtureUserIds.push(id);
    return { id, email };
  }

  /** Create a `contact_inquiries` row as the owner (RLS bypassed on purpose). */
  async createInquiry(input: {
    full_name: string;
    email: string;
    phone_number: string | null;
    message: string;
  }): Promise<string> {
    await this.asOwner();
    const { id } = await this.one<{ id: string }>(
      `INSERT INTO public.contact_inquiries (full_name, email, phone_number, message)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [input.full_name, input.email, input.phone_number, input.message],
    );
    this.fixtureInquiryIds.push(id);
    return id;
  }

  get createdUserIds(): readonly string[] {
    return this.fixtureUserIds;
  }

  get createdInquiryIds(): readonly string[] {
    return this.fixtureInquiryIds;
  }

  /* ── teardown ───────────────────────────────────────────────────────────*/

  /**
   * Roll the file-wide transaction back, clear the session identity, then PROVE
   * the database is pristine by re-querying for every fixture id. Returns the
   * leak counts so the caller can assert on them.
   */
  async rollbackAndVerify(): Promise<{ users: number; roles: number; inquiries: number; audits: number }> {
    if (!this.open) return { users: 0, roles: 0, inquiries: 0, audits: 0 };
    await this.client.query('ROLLBACK');
    this.open = false;
    // The JWT claims GUC is session scoped (is_local => false in 000), so the
    // rollback above does NOT clear it. Do it explicitly.
    await this.logout();

    const userIds = this.fixtureUserIds;
    const inquiryIds = this.fixtureInquiryIds;

    const users = await this.value<string>(
      'SELECT count(*) FROM auth.users WHERE id = ANY($1::uuid[])',
      [userIds],
    );
    const roles = await this.value<string>(
      'SELECT count(*) FROM public.user_roles WHERE user_id = ANY($1::uuid[])',
      [userIds],
    );
    const inquiries = await this.value<string>(
      'SELECT count(*) FROM public.contact_inquiries WHERE id = ANY($1::uuid[])',
      [inquiryIds],
    );
    const audits = await this.value<string>(
      'SELECT count(*) FROM public.action_audit_log WHERE actor = ANY($1::text[])',
      [userIds],
    );

    return {
      users: Number(users),
      roles: Number(roles),
      inquiries: Number(inquiries),
      audits: Number(audits),
    };
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Ground truth loaded from the live database
 * ──────────────────────────────────────────────────────────────────────────*/

export interface GrantRow {
  role: string;
  resource_key: string;
  action: string;
  allowed: boolean;
}

/** `role|resource|action` -> allowed. Absent key means "no grant recorded". */
export type CapabilityMatrix = Map<string, boolean>;

export const capKey = (role: string, resource: string, action: string): string =>
  `${role}|${resource}|${action}`;

/**
 * THE point of this suite: expectations come from `role_capabilities` as it
 * actually is right now, never from a hand-copied table in a test file. If an
 * operator changes a grant, these tests keep testing the MECHANISM instead of
 * failing on a stale constant.
 *
 * Read as the owner: `role_capabilities` has RLS policies that would filter this
 * for an `authenticated` caller.
 */
export async function loadCapabilityMatrix(db: TestDb): Promise<{
  rows: GrantRow[];
  matrix: CapabilityMatrix;
}> {
  await db.asOwner();
  const rows = await db.query<GrantRow & Row>(
    'SELECT role, resource_key, action, allowed FROM public.role_capabilities ORDER BY role, resource_key, action',
  );
  const matrix: CapabilityMatrix = new Map();
  for (const r of rows) matrix.set(capKey(r.role, r.resource_key, r.action), r.allowed);
  return { rows: rows as GrantRow[], matrix };
}

/** Deny-by-default lookup: no row at all, or an explicit `allowed = false`. */
export const expectedCapability = (
  matrix: CapabilityMatrix,
  role: string,
  resource: string,
  action: string,
): boolean => matrix.get(capKey(role, resource, action)) === true;

/* ────────────────────────────────────────────────────────────────────────────
 * Assertion accounting
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Sums `expect()` calls across a file and prints the total, so the suite can
 * report how much it actually checks rather than how many `it()` blocks it has.
 */
export function trackAssertions(label: string): { total: () => number } {
  let total = 0;
  afterEach(() => {
    const state = expect.getState() as { assertionCalls?: number };
    total += state.assertionCalls ?? 0;
  });
  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(`[assertions] ${label}: ${total}`);
  });
  return { total: () => total };
}
