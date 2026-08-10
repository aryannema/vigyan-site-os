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
 * Bypassing RLS is not the same as being nobody. When `ADMIN_ACTOR` names an
 * identity, every read and write below runs inside a transaction that sets
 * `request.jwt.claims`, so `auth.uid()` resolves and:
 *
 *   - writes go through `public.perform_action()` — a real capability check plus
 *     an audit row, atomically (004);
 *   - reads of `contact_inquiries_view` mask PII according to that identity's
 *     capabilities rather than returning zero rows (005).
 *
 * With `ADMIN_ACTOR` unset the UI still works — writes fall back to recording an
 * audit row directly, with no capability check — which is the only thing that can
 * be done honestly before an auth layer exists. See BLOCKERS.md #3.
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
 * The identity the admin UI acts as.
 *
 * TODO(auth-phase): this comes from an env var only because there is no session
 * to read it from. When GoTrue lands, replace `resolveActor()` with the session
 * user's id — nothing else in this file, and nothing in any page or action,
 * needs to change: the capability check and the audit trail are already wired to
 * whatever this returns.
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
 * `set_config(..., true)` is TRANSACTION-LOCAL. A session-level setting would
 * leak the impersonated identity onto the next borrower of this pooled
 * connection, which is a cross-request authorization bug, not a tidiness issue.
 */
async function withActor<T>(
  fn: (client: PoolClient, actorId: string | null) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const actorId = await resolveActor(client);
    if (actorId) {
      await client.query('SELECT set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: actorId, role: 'authenticated' }),
      ]);
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

/** Recorded as the actor when no identity is configured. */
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
 * With an actor configured this calls `public.perform_action()`, which is 004's
 * whole point: the capability decision and the audit row are one operation, so a
 * caller cannot obtain the former without producing the latter. It is called
 * AFTER the data change but inside the same transaction — on denial it raises
 * `insufficient_privilege` and the data change rolls back with it.
 *
 * Without an actor there is nobody to check a capability against, so it degrades
 * to writing the audit row directly. That keeps the trail complete and honest
 * about who acted (`system:admin-ui`), and is the only defensible behaviour
 * before an auth layer exists — the alternative would be inventing a user id,
 * i.e. faking the identity the check exists to verify.
 */
export async function mutate<T>(
  fn: (client: PoolClient) => Promise<{ result: T; audit: AuditEntry }>,
): Promise<T> {
  return withActor(async (client, actorId) => {
    const { result, audit } = await fn(client);

    const payload = JSON.stringify({
      before: audit.before ?? null,
      after: audit.after ?? null,
    });

    if (actorId) {
      await client.query('SELECT public.perform_action($1, $2, $3, $4, $5::jsonb)', [
        actorId,
        audit.resourceKey,
        audit.action,
        audit.targetId ?? null,
        payload,
      ]);
    } else {
      await client.query(
        `INSERT INTO public.action_audit_log
           (actor, resource_key, action, target_id, before_data, after_data)
         VALUES ($1, $2, $3, $4, ($5::jsonb)->'before', ($5::jsonb)->'after')`,
        [
          ANONYMOUS_ADMIN_ACTOR,
          audit.resourceKey,
          audit.action,
          audit.targetId ?? null,
          payload,
        ],
      );
    }

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
