// SERVER ONLY. Every importer is a Server Component or a `'use server'` module.
// (`import 'server-only'` would be the mechanical guard, but that package is not
// a declared dependency of this repo and adding it needs a package.json edit.)
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/**
 * Postgres access for the admin surface.
 *
 * ── Connection identity ──────────────────────────────────────────────────────
 * `DATABASE_URL` connects as the database owner, which is the server-side
 * "service role" identity for this phase. A table owner bypasses its own RLS
 * (003 §7 deliberately omits FORCE ROW LEVEL SECURITY), so these queries see and
 * write every row. That is required, not incidental:
 *
 *   - `role_capabilities` has NO write policy for any session role, by design
 *     (003 §8.11 — "governing the governor through the same matrix it governs is
 *     a privilege-escalation primitive"). Matrix edits are explicitly documented
 *     as a service-role operation, which is exactly what this module is.
 *   - `user_roles` likewise has no INSERT policy: role assignment is documented
 *     as a server-side operation (003 §8.10).
 *
 * ── Acting AS someone ────────────────────────────────────────────────────────
 * Bypassing RLS is not the same as being nobody. When an actor can be resolved,
 * every read and write below runs inside a transaction that establishes that
 * identity through `auth.set_session_identity()` (006), so `auth.uid()` resolves
 * and:
 *
 *   - writes go through `public.perform_action()` — a real capability check plus
 *     an audit row, atomically (004);
 *   - reads of `contact_inquiries_view` mask PII according to that identity's
 *     capabilities rather than returning zero rows (005).
 *
 * ── When NOBODY can be resolved ──────────────────────────────────────────────
 * `mutate()` REFUSES. It does not fall back to writing as a system identity.
 *
 * It used to: with `ADMIN_ACTOR` unset — the state this repo ships in — the
 * write was applied on this RLS-bypassing owner connection and an audit row was
 * recorded as 'system:admin-ui', with no capability decision anywhere in the
 * path. Combined with the absence of an auth layer (BLOCKERS.md #3) that made
 * every admin Server Action reachable by an unauthenticated HTTP request: a
 * plain `curl` with no cookie and no token could rewrite the capability matrix.
 * That was verified end-to-end, not theorised.
 *
 * "Nobody is signed in" is not a reason to skip the permission check; it is the
 * strongest possible reason to refuse. So the admin UI's write paths are
 * non-functional until an auth layer resolves a real actor per request. That is
 * the correct state, not a regression: reads still work, and every write fails
 * with a clear, honest message instead of succeeding as an implicit admin.
 */

declare global {
  // Cached across dev hot-reloads so `next dev` does not leak a pool per compile.
  // eslint-disable-next-line no-var
  var __adminPgPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local.');
  }
  return new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000 });
}

export function getPool(): Pool {
  if (!globalThis.__adminPgPool) globalThis.__adminPgPool = createPool();
  return globalThis.__adminPgPool;
}

/* ───────────────────────────────────────────────────────────────────────────
 * Actor identity
 * ─────────────────────────────────────────────────────────────────────────*/

/**
 * Raised when a mutation is attempted with no resolvable actor.
 *
 * A distinct type so call sites (and `toFormError()`) can tell "the system is
 * not configured to authorize anybody" apart from "you are not allowed to do
 * this" and from a database error.
 */
export class NoAuthenticatedActorError extends Error {
  /** Mirrors the shape of a `pg` error so error handling stays uniform. */
  readonly code = 'ADMIN_NO_ACTOR';

  constructor() {
    super(
      'No authenticated actor — admin writes are disabled until auth is configured. ' +
        'Every write must be attributable to an identity so it can be capability-checked ' +
        'and audited; there is no session layer yet, so there is nobody to check. ' +
        '(For local development, set ADMIN_ACTOR to the uuid or email of an auth.users ' +
        'identity whose role carries the capabilities the admin UI should have.)',
    );
    this.name = 'NoAuthenticatedActorError';
  }
}

/**
 * The identity the admin UI acts as.
 *
 * Real session first: reads the signed-in user via the same `@supabase/ssr`
 * server client the login/callback pages already use (`createServerSupabaseClient`,
 * `lib/supabase-server.ts`). Middleware refreshes the session cookie before this
 * ever runs (see `middleware.ts`), so `getUser()` here is reading an
 * already-validated token, not re-deriving trust from a cookie a client could
 * forge — that trust boundary is `@supabase/ssr` + Supabase Cloud's own GoTrue,
 * not this function.
 *
 * `ADMIN_ACTOR` remains as a fallback ONLY for local scripts/tests that have no
 * browser session to read (there is no cookie jar outside a request). Any real
 * request always has middleware-refreshed cookies, so the session path is what
 * actually runs in the deployed app. Accepts a uuid or an `auth.users` email for
 * that fallback, matching `perform_action()`'s own actor resolution and the
 * `MCP_SERVICE_ACTOR` convention the MCP route uses for the same reason
 * (BLOCKERS.md #4).
 *
 * Returning `null` is the "nobody" case, and every write path refuses on it.
 */
async function resolveActor(client: PoolClient): Promise<string | null> {
  try {
    const { createServerSupabaseClient } = await import('@/lib/supabase-server');
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user?.id) return user.id;
  } catch {
    // No request context (e.g. a script run outside Next's server runtime) —
    // fall through to the ADMIN_ACTOR fallback below rather than throwing.
  }

  const configured = process.env.ADMIN_ACTOR?.trim();
  if (!configured) return null;

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(configured)) {
    return configured;
  }

  const found = await client.query<{ id: string }>(
    `SELECT id FROM auth.users WHERE lower(email) = lower($1)`,
    [configured],
  );
  const id = found.rows[0]?.id;
  if (!id) {
    throw new Error(
      `ADMIN_ACTOR is set to "${configured}", which is not a uuid and matches no auth.users row.`,
    );
  }
  return id;
}

/**
 * Establishes the acting identity for the current transaction.
 *
 * CLOUD/LOCAL DIVERGENCE (2026-08-11): tries `auth.set_session_identity()`
 * (006) first — the correct, hardened mechanism, present on any database
 * migration 006 was applied to (local dev). Falls back to a direct
 * `set_config('request.jwt.claims', ..., true)` only on `42883`
 * (`undefined_function`), which is what Supabase Cloud raises: 006 was never
 * pushed there, because Cloud's `auth` schema is owned by `supabase_auth_admin`
 * and rejects any attempt to create objects in it.
 *
 * The fallback is NOT a reintroduction of the vulnerability 006 closed. That
 * finding was about an UNTRUSTED `authenticated`-role session (e.g. a browser
 * hitting PostgREST/supabase-js directly) forging its own identity by calling
 * `set_config` itself. This connection is different in kind: `getPool()`
 * connects as the table OWNER via `DATABASE_URL` (already bypasses RLS on
 * every table it owns, see the module header), is never reachable by an end
 * user, and `actorId` has already been resolved by `resolveActor()` — either
 * from a verified Supabase session (`supabase.auth.getUser()`, cryptographically
 * validated) or the local-only `ADMIN_ACTOR` fallback — not client-supplied at
 * this point. Confirmed by reading Supabase Cloud's actual `auth.uid()`: it
 * reads `coalesce(request.jwt.claim.sub, request.jwt.claims->>'sub')`, the
 * same GUC — this was always what Supabase's own `auth.uid()` reads, not a
 * local-only mechanism.
 *
 * If a future feature gives an untrusted, `authenticated`-role session direct
 * database access, 006's protection matters for THAT path and needs a
 * Cloud-compatible equivalent then — this fallback should not be widened
 * beyond this owner-only connection.
 */
async function setSessionIdentity(client: PoolClient, actorId: string): Promise<void> {
  // A failed statement poisons the REST of this transaction until a ROLLBACK —
  // catching the JS exception alone does not clear that, so the fallback query
  // below would itself fail with "current transaction is aborted" without this
  // SAVEPOINT. (Found live: the first version of this function shipped without
  // it and broke every write on Cloud, where the first query always fails.)
  await client.query('SAVEPOINT before_session_identity');
  try {
    await client.query('SELECT auth.set_session_identity($1::uuid)', [actorId]);
    await client.query('RELEASE SAVEPOINT before_session_identity');
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : undefined;
    await client.query('ROLLBACK TO SAVEPOINT before_session_identity');
    if (code !== '42883') throw error;
    await client.query(
      `SELECT set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [actorId],
    );
  }
}

/**
 * Runs `fn` in a transaction, impersonating the configured actor for its duration.
 */
async function withActor<T>(
  fn: (client: PoolClient, actorId: string | null) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let rollbackFailed = false;
  try {
    await client.query('BEGIN');
    const actorId = await resolveActor(client);
    if (actorId) {
      await setSessionIdentity(client, actorId);
    }
    const out = await fn(client, actorId);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // If ROLLBACK itself fails, this connection's transaction state is
      // unknown/possibly still aborted. Releasing it normally would return a
      // poisoned client to the pool — the NEXT unrelated request that checks
      // it out would inherit an already-aborted transaction and see this
      // same "current transaction is aborted" error for a completely
      // different reason. Marked below so `finally` destroys it instead.
      rollbackFailed = true;
      console.error('[admin/db] ROLLBACK failed after an error; destroying connection:', rollbackError);
    }
    throw error;
  } finally {
    client.release(rollbackFailed);
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * Reads
 * ─────────────────────────────────────────────────────────────────────────*/

/**
 * Plain read. Use for tables the admin UI reads as the service role: the
 * capability matrix, users, posts, job openings.
 */
export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as unknown[]);
  return result.rows;
}

/**
 * Read as the configured actor — required for relations whose contents depend on
 * `auth.uid()`, i.e. `contact_inquiries_view`, whose row gate AND PII masking are
 * both decided from it (005 §3). Querying `contact_inquiries` directly instead
 * would return raw PII regardless of capabilities, which is precisely the bypass
 * 005 §4 exists to close.
 */
export async function queryAsActor<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<{ rows: T[]; actorId: string | null }> {
  return withActor(async (client, actorId) => {
    const result = await client.query<T>(text, params as unknown[]);
    return { rows: result.rows, actorId };
  });
}

/* ───────────────────────────────────────────────────────────────────────────
 * Writes
 * ─────────────────────────────────────────────────────────────────────────*/

/**
 * The actor string this module USED to write when no identity was configured.
 *
 * Nothing writes it any more — `mutate()` refuses instead. It is kept exported,
 * and named, for two reasons: any `action_audit_log` row bearing it was produced
 * by the fail-open path and should be treated as unattributed, and a test asserts
 * on the constant so the name cannot be quietly reused for a new implicit
 * identity.
 */
export const ANONYMOUS_ADMIN_ACTOR = 'system:admin-ui';

export interface AuditEntry {
  resourceKey: string;
  action: 'view' | 'create' | 'edit' | 'delete' | 'publish';
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
}

/**
 * The single write path for the admin UI: perform the mutation, authorize it, and
 * record it — all in one transaction.
 *
 * `fn` returns both its result and the audit entry describing what it did, so the
 * record can quote real before/after values (including ones only known
 * mid-transaction, such as a generated id).
 *
 * With an actor resolved this calls `public.perform_action()`, which is 004's
 * whole point: the capability decision and the audit row are one operation, so a
 * caller cannot obtain the former without producing the latter. It is called
 * AFTER the data change but inside the same transaction — on denial it raises
 * `insufficient_privilege` and the data change rolls back with it.
 *
 * WITHOUT an actor there is nobody to check a capability against, so this
 * FAILS CLOSED: it throws `NoAuthenticatedActorError` BEFORE `fn` runs, so no
 * data is touched and no audit row is written. It does not degrade to an
 * unchecked write under a system identity — that is the fail-open behaviour this
 * replaces, and it made every admin Server Action an unauthenticated write
 * endpoint. See the module header.
 *
 * The refusal happens inside the transaction, which is then rolled back, so
 * there is no partial state and no successful-looking no-op: callers that wrap
 * this in `try/catch` surface `toFormError()`'s message, and callers that do not
 * propagate a real error rather than reporting success.
 */
export async function mutate<T>(
  fn: (client: PoolClient) => Promise<{ result: T; audit: AuditEntry }>,
): Promise<T> {
  return withActor(async (client, actorId) => {
    // Checked FIRST: an unauthorized mutation must not be executed and then
    // rolled back, it must never run. `fn` may have effects of its own.
    if (!actorId) throw new NoAuthenticatedActorError();

    const { result, audit } = await fn(client);

    const payload = JSON.stringify({
      before: audit.before ?? null,
      after: audit.after ?? null,
    });

    await client.query('SELECT public.perform_action($1, $2, $3, $4, $5::jsonb)', [
      actorId,
      audit.resourceKey,
      audit.action,
      audit.targetId ?? null,
      payload,
    ]);

    return result;
  });
}

/* ───────────────────────────────────────────────────────────────────────────
 * Error shaping
 * ─────────────────────────────────────────────────────────────────────────*/

/** Postgres error codes the admin forms translate into readable messages. */
const PG_MESSAGES: Record<string, string> = {
  '23505': 'That value must be unique and is already taken (most likely the slug).',
  '23503': 'That references a row that does not exist.',
  '23514': 'A database constraint rejected one of the values.',
  '23502': 'A required field was left empty.',
  '22P02': 'One of the values was not in the format the database expects.',
};

/** Turns an unknown thrown value into a message safe to render in a form. */
export function toFormError(error: unknown): string {
  // No identity to authorize against. Surfaced verbatim: it says what is wrong
  // and what has to happen before the UI can write, which is exactly what an
  // operator hitting this needs to read.
  if (error instanceof NoAuthenticatedActorError) return error.message;

  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;

  // A capability denial from perform_action(). Surface it as a permission
  // problem rather than as a raw Postgres exception.
  if (code === '42501') {
    const message = error instanceof Error ? error.message : '';
    return message.includes('not permitted')
      ? `Permission denied: ${message.replace(/^perform_action: /, '')}`
      : 'Permission denied.';
  }

  if (code && PG_MESSAGES[code]) return PG_MESSAGES[code];
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
