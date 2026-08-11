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
 * TODO(auth-phase): this comes from an env var only because there is no session
 * to read it from. When GoTrue lands, replace `resolveActor()` with the session
 * user's id — nothing else in this file, and nothing in any page or action,
 * needs to change: the capability check and the audit trail are already wired to
 * whatever this returns. Returning `null` is the "nobody" case, and every write
 * path refuses on it.
 *
 * Accepts a uuid or an `auth.users` email, matching `perform_action()`'s own
 * actor resolution. Mirrors the `MCP_SERVICE_ACTOR` convention the MCP route
 * uses for the same reason (BLOCKERS.md #4).
 */
async function resolveActor(client: PoolClient): Promise<string | null> {
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
 * Runs `fn` in a transaction, impersonating the configured actor for its duration.
 *
 * `auth.set_session_identity()` (006) is TRANSACTION-LOCAL. A session-level
 * setting would leak the impersonated identity onto the next borrower of this
 * pooled connection, which is a cross-request authorization bug, not a tidiness
 * issue. It replaces the previous `set_config('request.jwt.claims', ...)` call:
 * that GUC is writable by any session, so as of 006 `auth.uid()` no longer reads
 * it and only this owner-only, SECURITY DEFINER setter can establish an identity.
 */
async function withActor<T>(
  fn: (client: PoolClient, actorId: string | null) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const actorId = await resolveActor(client);
    if (actorId) {
      await client.query('SELECT auth.set_session_identity($1::uuid)', [actorId]);
    }
    const out = await fn(client, actorId);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
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
