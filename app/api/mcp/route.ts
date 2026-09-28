/**
 * vigyan-site-os — MCP (Model Context Protocol) JSON-RPC endpoint.
 *
 * POST /api/mcp
 *
 * A brand-neutral tool surface over the site's governed resources: blog posts,
 * CMS sections, job openings and CRM inquiries. Every tool is capability-checked
 * in the DATABASE before it touches data, using the primitives from
 * supabase/migrations/003_role_expansion.sql and 004_audit_by_construction.sql:
 *
 *   reads   ->  public.user_has_capability(actor_uuid, resource_key, action)
 *   writes  ->  public.perform_action(actor, resource_key, action, target, payload)
 *
 * perform_action() authorizes AND audits in one atomic step, so no write path
 * here can produce a permission decision without also producing an audit row.
 * Every tool call runs inside a single transaction, so if the data write fails
 * after the audit row is inserted, both roll back together.
 *
 * ── Identity ────────────────────────────────────────────────────────────────
 *
 * There is no GoTrue/auth backend wired up for this repo yet, so the ONLY
 * identity path implemented today is the service bearer token:
 *
 *   Authorization: Bearer ${MCP_SECRET_KEY}   ->  identity 'mcp-service-token'
 *
 * A bearer token is not, by itself, an identity the database can authorize.
 * 004 §2's TODO(phase-1.5-or-later) is explicit about this: perform_action()
 * resolves p_actor ONLY as a user_roles-backed identity (a uuid, or an
 * auth.users email), because service_tokens(token_name, role) does not exist
 * yet. So the service token is mapped to a configured backing identity:
 *
 *   MCP_SERVICE_ACTOR = <uuid | email of an auth.users row>
 *
 * That identity's role decides what the token may do — the token confers no
 * privilege of its own, and an unconfigured deployment gets a clear error
 * rather than accidental access. See BLOCKERS.md.
 *
 * ── auth.uid() and the anti-impersonation check ─────────────────────────────
 *
 * 004 §2 permits a NULL auth.uid() (a service role / direct backend connection)
 * to act on a user's behalf; a NON-NULL auth.uid() must match p_actor. This
 * route connects with `pg` straight to DATABASE_URL, so auth.uid() would be
 * NULL by default and the trusted-backend branch would apply.
 *
 * It deliberately does NOT rely on that. Each transaction establishes the
 * resolved actor as the session identity (transaction-local, through
 * `auth.set_session_identity()` — 006), because:
 *
 *   1. public.contact_inquiries_view is not security_invoker and gates its rows
 *      and its PII masking on auth.uid() (005 §3). With auth.uid() NULL it
 *      returns ZERO ROWS, and the only way to read inquiries would be the raw
 *      table — which is precisely the masking bypass 005 §4 closes. Reading the
 *      view as the actor is the supported path.
 *   2. It keeps RLS meaningful if this route is ever pointed at a non-owner
 *      database role.
 *
 * With the identity established, auth.uid() === the actor's uuid, so
 * perform_action()'s anti-impersonation check is satisfied by construction
 * rather than skipped.
 */

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';

import { jwtEnabled, verifyMcpJwt } from '@/lib/mcp-auth';

import {
  EMPLOYMENT_TYPES,
  JOB_OPENING_STATUSES,
  POST_STATUSES,
  SALARY_PERIODS,
  WORKPLACE_TYPES,
  type Action,
  type ContactInquiryView,
  type ContentData,
  type Json,
  type JobOpening,
  type PerformActionReceipt,
  type Post,
  type ResourceKey,
  type SiteContent,
} from '@/types/schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/* ────────────────────────────────────────────────────────────────────────────
 * Database access — raw `pg`, parameterized queries only, no ORM.
 * ──────────────────────────────────────────────────────────────────────────*/

declare global {
  // eslint-disable-next-line no-var
  var __vigyanMcpPool: Pool | undefined;
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new McpError(
      ERROR_CODES.SERVER_MISCONFIGURED,
      'DATABASE_URL is not set; the MCP endpoint cannot reach the database.',
      500,
    );
  }
  // Cached on globalThis so Next's dev-mode module reloading does not leak a
  // new pool per edit.
  globalThis.__vigyanMcpPool ??= new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  return globalThis.__vigyanMcpPool;
}

/* ────────────────────────────────────────────────────────────────────────────
 * JSON-RPC errors
 * ──────────────────────────────────────────────────────────────────────────*/

const ERROR_CODES = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  /** Caller presented no credential, or a credential we do not accept. */
  UNAUTHENTICATED: -32001,
  /** Caller is known but the capability matrix denies the action. */
  FORBIDDEN: -32002,
  /** The credential is valid but cannot be mapped to a database identity. */
  IDENTITY_UNRESOLVED: -32003,
  /** Something the operator must fix (missing env var, unreachable DB). */
  SERVER_MISCONFIGURED: -32004,
  /** Well-formed, authorized request naming a row that does not exist. */
  NOT_FOUND: -32005,
} as const;

class McpError extends Error {
  readonly code: number;
  readonly httpStatus: number;
  readonly data?: Json;

  constructor(code: number, message: string, httpStatus = 400, data?: Json) {
    super(message);
    this.name = 'McpError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.data = data;
  }
}

/** Postgres SQLSTATEs this route knows how to turn into a good error message. */
function fromPostgresError(err: unknown): McpError {
  const e = err as { code?: string; message?: string; detail?: string; constraint?: string };
  const message = e?.message ?? 'Database error';

  switch (e?.code) {
    // Raised by perform_action() on denial and on an unresolvable actor.
    case '42501':
      return new McpError(
        message.includes('could not be resolved')
          ? ERROR_CODES.IDENTITY_UNRESOLVED
          : ERROR_CODES.FORBIDDEN,
        message,
        403,
      );
    // perform_action() argument validation.
    case '22023':
      return new McpError(ERROR_CODES.INVALID_PARAMS, message, 400);
    case '23505':
      return new McpError(
        ERROR_CODES.INVALID_PARAMS,
        `Uniqueness violation${e.constraint ? ` (${e.constraint})` : ''}: ${message}`,
        409,
      );
    case '23503':
      return new McpError(ERROR_CODES.INVALID_PARAMS, `Foreign key violation: ${message}`, 400);
    case '23514':
      return new McpError(ERROR_CODES.INVALID_PARAMS, `Check constraint violation: ${message}`, 400);
    default:
      return new McpError(ERROR_CODES.INTERNAL_ERROR, message, 500);
  }
}

function asMcpError(err: unknown): McpError {
  if (err instanceof McpError) return err;
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return fromPostgresError(err);
  }
  return new McpError(
    ERROR_CODES.INTERNAL_ERROR,
    err instanceof Error ? err.message : 'Internal error',
    500,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. Identity resolution
 * ──────────────────────────────────────────────────────────────────────────*/

// Note: nothing below is exported except the route handler. Next's App Router
// rejects a route module that exports anything other than its HTTP handlers and
// the recognised route-segment config, so these stay module-private.

/** The identity string recorded for callers holding the service bearer token. */
const SERVICE_TOKEN_IDENTITY = 'mcp-service-token';
/** Namespaces JWT identities so they cannot collide with the service token. */
const JWT_IDENTITY_PREFIX = 'jwt:';

/** Length-independent constant-time comparison of two secrets. */
function secretsMatch(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Resolve who is calling.
 *
 * Returns an opaque identity string, or `null` when the request carries no
 * credential we accept. It never throws and never decides what to DO about an
 * anonymous caller — that is the handler's job.
 */
async function resolveCallerIdentity(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const secret = process.env.MCP_SECRET_KEY;
  if (secret && secretsMatch(header, `Bearer ${secret}`)) {
    return SERVICE_TOKEN_IDENTITY;
  }

  // A JWT identifies WHICH client called, expires on its own, and can be issued
  // per person or per service — none of which a single shared secret can do.
  // It authenticates only: the subject's role in user_roles still decides every
  // capability, so a token cannot grant what the database has not granted.
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (bearer && bearer.split('.').length === 3) {
    const verified = await verifyMcpJwt(bearer);
    if (verified) return `${JWT_IDENTITY_PREFIX}${verified.subject}`;
  }

  // TODO(auth-phase): session-cookie identity once GoTrue lands. The shape:
  // read the auth cookie, verify it, return the session user's uuid. Everything
  // downstream already works in terms of an identity string that resolves to an
  // auth.users row. Deliberately not stubbed — pretending would hide the gap.

  return null;
}

/** An identity resolved all the way down to a database-authorizable actor. */
interface ResolvedActor {
  /** The opaque caller identity (what authenticated). */
  identity: string;
  /** The string handed to perform_action(p_actor) — recorded verbatim in the audit log. */
  actor: string;
  /** The auth.users uuid that `actor` resolves to; what capability checks use. */
  actorUserId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Map an authenticated identity onto a database identity.
 *
 * For the service token this is the configured MCP_SERVICE_ACTOR. The token is
 * an authenticator, not an authorization: the backing identity's role in
 * user_roles is what actually decides every capability check below.
 */
async function resolveActor(client: PoolClient, identity: string): Promise<ResolvedActor> {
  // A JWT names its own subject, so it does NOT borrow MCP_SERVICE_ACTOR. That
  // is the practical gain over the shared secret: the audit log records who
  // called, not merely that something did.
  if (identity.startsWith(JWT_IDENTITY_PREFIX)) {
    const subject = identity.slice(JWT_IDENTITY_PREFIX.length);
    const { rows } = UUID_RE.test(subject)
      ? await client.query<{ id: string; email: string | null }>(
          'select u.id::text as id, u.email from auth.users u where u.id = $1::uuid limit 1',
          [subject],
        )
      : await client.query<{ id: string; email: string | null }>(
          'select u.id::text as id, u.email from auth.users u where lower(u.email) = lower(btrim($1)) limit 1',
          [subject],
        );
    const found = rows[0];
    if (!found) {
      throw new McpError(
        ERROR_CODES.IDENTITY_UNRESOLVED,
        'The token is valid but its subject does not match any auth.users row, so ' +
          'perform_action() cannot resolve it. Issue tokens whose sub is a real ' +
          'identity holding a role in user_roles.',
        403,
      );
    }
    return { identity, actor: subject, actorUserId: found.id };
  }

  if (identity !== SERVICE_TOKEN_IDENTITY) {
    throw new McpError(
      ERROR_CODES.IDENTITY_UNRESOLVED,
      `Unknown identity kind: ${identity}`,
      500,
    );
  }

  const configured = process.env.MCP_SERVICE_ACTOR?.trim();
  if (!configured) {
    throw new McpError(
      ERROR_CODES.SERVER_MISCONFIGURED,
      'MCP_SERVICE_ACTOR is not configured. The Bearer service token authenticates ' +
        'the caller but confers no capabilities of its own: set MCP_SERVICE_ACTOR to ' +
        'the uuid or email of an auth.users identity whose role in user_roles grants ' +
        'the capabilities this automation should have.',
      500,
    );
  }

  const { rows } = UUID_RE.test(configured)
    ? await client.query<{ id: string; email: string | null }>(
        'select u.id::text as id, u.email from auth.users u where u.id = $1::uuid limit 1',
        [configured],
      )
    : await client.query<{ id: string; email: string | null }>(
        'select u.id::text as id, u.email from auth.users u where lower(u.email) = lower(btrim($1)) limit 1',
        [configured],
      );

  const row = rows[0];
  if (!row) {
    throw new McpError(
      ERROR_CODES.IDENTITY_UNRESOLVED,
      'MCP_SERVICE_ACTOR does not match any auth.users row, so perform_action() ' +
        'cannot resolve it to a known identity. Point it at a real identity that ' +
        'holds a role in user_roles.',
      500,
    );
  }

  return { identity, actor: configured, actorUserId: row.id };
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. Capability checking + auditing
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * Establishes the acting identity for the current transaction.
 *
 * CLOUD/LOCAL DIVERGENCE (2026-08-11): tries `auth.set_session_identity()`
 * (006) first — the correct, hardened mechanism, present on any database 006
 * was applied to (local dev). Falls back to a direct
 * `set_config('request.jwt.claims', ..., true)` only on `42883`
 * (`undefined_function`), which is what Supabase Cloud raises: the `auth`
 * schema there is owned by `supabase_auth_admin`, and Cloud projects reject
 * any attempt to create objects in it (`permission denied for schema auth`),
 * so 006 was never pushed there.
 *
 * The fallback is NOT the vulnerability 006 closed. That finding was about an
 * UNTRUSTED `authenticated`-role session (e.g. a browser hitting PostgREST or
 * supabase-js directly) forging its own identity by calling `set_config`
 * itself, bypassing RLS. This connection is different in kind: it connects as
 * the table OWNER via `DATABASE_URL` (already bypasses RLS on every table it
 * owns — 003 §7 deliberately omits FORCE ROW LEVEL SECURITY), is never
 * reachable by an end user, and `actorUserId` has already been resolved via
 * `resolveCallerIdentity()`'s Bearer-token check or a verified Supabase
 * session — not client-supplied at this point. Confirmed by reading Supabase
 * Cloud's real `auth.uid()` (owner `supabase_auth_admin`): it reads
 * `coalesce(request.jwt.claim.sub, request.jwt.claims->>'sub')`, the same GUC
 * — this is what Supabase's own `auth.uid()` was always going to read, on
 * both environments.
 *
 * If a future feature gives an untrusted, `authenticated`-role session direct
 * SQL/PostgREST/supabase-js access to this database, 006's protection matters
 * again for THAT path and needs a Cloud-compatible equivalent then — this
 * fallback should not be widened beyond this owner-only connection.
 */
async function setSessionIdentity(client: PoolClient, actorUserId: string): Promise<void> {
  // A failed statement poisons the REST of this transaction until a ROLLBACK —
  // catching the JS exception alone does not clear that, so the fallback query
  // below would itself fail with "current transaction is aborted" without this
  // SAVEPOINT. (Found live: the first version of this function shipped without
  // it and broke every write on Cloud, where the first query always fails.)
  await client.query('savepoint before_session_identity');
  try {
    await client.query('select auth.set_session_identity($1::uuid)', [actorUserId]);
    await client.query('release savepoint before_session_identity');
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : undefined;
    await client.query('rollback to savepoint before_session_identity');
    if (code !== '42883') throw error;
    await client.query(
      `select set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [actorUserId],
    );
  }
}

/** Run `fn` in one transaction, acting as the resolved actor. */
async function withActorTransaction<T>(
  actorUserId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let rollbackFailed = false;
  try {
    await client.query('begin');
    await setSessionIdentity(client, actorUserId);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (err) {
    try {
      await client.query('rollback');
    } catch (rollbackError) {
      // See app/admin/lib/db.ts's withActor() for why this must destroy the
      // connection rather than release it normally: a client whose ROLLBACK
      // failed may still be mid-transaction, and returning it to the pool
      // would poison the next unrelated request that checks it out.
      rollbackFailed = true;
      console.error('[mcp] rollback failed after an error; destroying connection:', rollbackError);
    }
    throw err;
  } finally {
    client.release(rollbackFailed);
  }
}

/**
 * Read-only authorization. Writes must use performAction() instead — it is the
 * only path that produces an audit row.
 */
async function requireCapability(
  client: PoolClient,
  actor: ResolvedActor,
  resourceKey: ResourceKey,
  action: Action,
): Promise<void> {
  const { rows } = await client.query<{ allowed: boolean }>(
    'select public.user_has_capability($1::uuid, $2::text, $3::text) as allowed',
    [actor.actorUserId, resourceKey, action],
  );

  if (!rows[0]?.allowed) {
    throw new McpError(
      ERROR_CODES.FORBIDDEN,
      `Permission denied: identity '${actor.identity}' (actor '${actor.actor}') does not hold ` +
        `the capability ${resourceKey}:${action}.`,
      403,
    );
  }
}

/**
 * Authorize + audit a write, atomically. Raises (and therefore aborts the
 * surrounding transaction) on denial.
 */
async function performAction(
  client: PoolClient,
  actor: ResolvedActor,
  resourceKey: ResourceKey,
  action: Action,
  targetId: string | null,
  payload: { before?: Json; after?: Json } | null,
): Promise<PerformActionReceipt> {
  const { rows } = await client.query<{ receipt: PerformActionReceipt }>(
    'select public.perform_action($1::text, $2::text, $3::text, $4::text, $5::jsonb) as receipt',
    [actor.actor, resourceKey, action, targetId, payload ? JSON.stringify(payload) : null],
  );
  return rows[0]!.receipt;
}

/**
 * Provenance stamped into the audited `after` payload.
 *
 * It goes INSIDE `after` on purpose: perform_action() splits a payload with a
 * `before`/`after` key into the two audit columns and discards every sibling
 * key, so a top-level field here would be silently dropped.
 */
function stamp(tool: string, actor: ResolvedActor, after: Record<string, unknown>): Json {
  return { ...after, _tool: tool, _via: actor.identity } as Json;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. Row mappers
 *
 * `pg` returns numeric as a string and date as a local-midnight Date; both are
 * normalised here so responses match types/schema.ts exactly.
 * ──────────────────────────────────────────────────────────────────────────*/

const toIso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : v;

const toNum = (v: string | number | null): number | null =>
  v === null || v === undefined ? null : typeof v === 'number' ? v : Number(v);

function toPost(row: Record<string, unknown>): Post {
  return {
    id: row.id as string,
    title: row.title as string,
    slug: row.slug as string,
    category: row.category as string,
    seo_description: (row.seo_description as string | null) ?? null,
    featured_image: (row.featured_image as string | null) ?? null,
    content_blocks: (row.content_blocks as Post['content_blocks']) ?? [],
    status: row.status as Post['status'],
    published_at: toIso(row.published_at as Date | null),
    created_at: toIso(row.created_at as Date | null),
  };
}

function toJobOpening(row: Record<string, unknown>): JobOpening {
  return {
    id: row.id as string,
    title: row.title as string,
    slug: row.slug as string,
    department: (row.department as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    employment_type: row.employment_type as JobOpening['employment_type'],
    workplace_type: (row.workplace_type as JobOpening['workplace_type']) ?? null,
    salary_min: toNum(row.salary_min as string | null),
    salary_max: toNum(row.salary_max as string | null),
    salary_currency: (row.salary_currency as string | null) ?? null,
    salary_period: (row.salary_period as JobOpening['salary_period']) ?? null,
    description: row.description as string,
    responsibilities: (row.responsibilities as string[] | null) ?? null,
    requirements: (row.requirements as string[] | null) ?? null,
    apply_url: (row.apply_url as string | null) ?? null,
    apply_email: (row.apply_email as string | null) ?? null,
    status: row.status as JobOpening['status'],
    valid_through: (row.valid_through as string | null) ?? null, // selected ::text
    posted_at: toIso(row.posted_at as Date | null),
    created_at: toIso(row.created_at as Date | null) as string,
    updated_at: toIso(row.updated_at as Date | null) as string,
  };
}

function toSiteContent(row: Record<string, unknown>): SiteContent {
  return {
    section_id: row.section_id as string,
    content_data: row.content_data as ContentData,
    updated_at: toIso(row.updated_at as Date | null),
  };
}

function toContactInquiry(row: Record<string, unknown>): ContactInquiryView {
  return {
    id: row.id as string,
    full_name: row.full_name as string,
    email: row.email as string,
    phone_number: (row.phone_number as string | null) ?? null,
    message: row.message as string,
    created_at: toIso(row.created_at as Date | null),
    pii_masked: row.pii_masked as boolean,
  };
}

const POST_COLUMNS =
  'id, title, slug, category, seo_description, featured_image, content_blocks, status, published_at, created_at';

const JOB_COLUMNS =
  'id, title, slug, department, location, employment_type, workplace_type, salary_min, salary_max, ' +
  'salary_currency, salary_period, description, responsibilities, requirements, apply_url, apply_email, ' +
  'status, valid_through::text as valid_through, posted_at, created_at, updated_at';

/* ────────────────────────────────────────────────────────────────────────────
 * 4. Argument schemas
 * ──────────────────────────────────────────────────────────────────────────*/

const slug = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase, hyphen-separated slug');

const contentBlock = z.object({ type: z.string().min(1) }).catchall(z.unknown());

const jsonObject = z.record(z.string(), z.unknown());

const pagination = {
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
};

/** id or slug — exactly the two ways to name a row. */
const byIdOrSlug = { id: z.uuid().optional(), slug: slug.optional() };
const requireIdOrSlug = <T extends { id?: string; slug?: string }>(v: T, ctx: z.RefinementCtx) => {
  if (!v.id && !v.slug) {
    ctx.addIssue({ code: 'custom', message: 'Provide either `id` or `slug`.' });
  }
};

const listPostsArgs = z.object({
  status: z.enum(POST_STATUSES).optional().describe('Filter by lifecycle status.'),
  category: z.string().min(1).optional(),
  search: z.string().min(1).max(200).optional().describe('Case-insensitive match on title or slug.'),
  ...pagination,
});

const postFields = {
  title: z.string().min(1).max(300),
  slug,
  category: z.string().min(1).max(120),
  seo_description: z.string().max(500).nullable().optional(),
  featured_image: z.string().max(2000).nullable().optional(),
  content_blocks: z.array(contentBlock).optional().describe('Ordered renderer blocks; each needs a `type`.'),
  status: z.enum(POST_STATUSES).optional().describe("Defaults to 'draft'. Setting 'published' also requires blog:publish."),
  published_at: z.string().datetime({ offset: true }).nullable().optional(),
};

const createPostArgs = z.object(postFields);

const updatePostArgs = z
  .object({
    ...byIdOrSlug,
    new_slug: slug.optional().describe('Set to rename the slug; `slug` is only a lookup key here.'),
    title: postFields.title.optional(),
    category: postFields.category.optional(),
    seo_description: postFields.seo_description,
    featured_image: postFields.featured_image,
    content_blocks: postFields.content_blocks,
    status: postFields.status,
    published_at: postFields.published_at,
  })
  .superRefine((v, ctx) => {
    requireIdOrSlug(v, ctx);
    const { id: _id, slug: _slug, ...rest } = v;
    if (Object.values(rest).every((x) => x === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update.' });
    }
  });

const getPostArgs = z.object(byIdOrSlug).superRefine(requireIdOrSlug);

const getSiteContentArgs = z.object({
  section_id: z.string().min(1).max(200).optional().describe('Omit to list every section.'),
  ...pagination,
});

const setSiteContentArgs = z.object({
  section_id: z.string().min(1).max(200),
  content_data: jsonObject.describe('The complete replacement document for this section.'),
});

const listJobOpeningsArgs = z.object({
  status: z.enum(JOB_OPENING_STATUSES).optional(),
  department: z.string().min(1).optional(),
  ...pagination,
});

const jobFields = {
  title: z.string().min(1).max(300),
  slug,
  description: z.string().min(1),
  department: z.string().max(160).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  employment_type: z.enum(EMPLOYMENT_TYPES).optional(),
  workplace_type: z.enum(WORKPLACE_TYPES).nullable().optional(),
  salary_min: z.number().nonnegative().nullable().optional(),
  salary_max: z.number().nonnegative().nullable().optional(),
  salary_currency: z.string().length(3).nullable().optional().describe('ISO 4217 code, e.g. USD.'),
  salary_period: z.enum(SALARY_PERIODS).nullable().optional(),
  responsibilities: z.array(z.string().min(1)).nullable().optional(),
  requirements: z.array(z.string().min(1)).nullable().optional(),
  apply_url: z.string().max(2000).nullable().optional(),
  apply_email: z.email().nullable().optional(),
  status: z.enum(JOB_OPENING_STATUSES).optional().describe("Defaults to 'draft'. Setting 'open' also requires careers:publish."),
  valid_through: z.iso.date().nullable().optional().describe('YYYY-MM-DD.'),
};

const createJobOpeningArgs = z.object(jobFields);

const updateJobOpeningArgs = z
  .object({
    ...byIdOrSlug,
    new_slug: slug.optional().describe('Set to rename the slug; `slug` is only a lookup key here.'),
    title: jobFields.title.optional(),
    description: jobFields.description.optional(),
    department: jobFields.department,
    location: jobFields.location,
    employment_type: jobFields.employment_type,
    workplace_type: jobFields.workplace_type,
    salary_min: jobFields.salary_min,
    salary_max: jobFields.salary_max,
    salary_currency: jobFields.salary_currency,
    salary_period: jobFields.salary_period,
    responsibilities: jobFields.responsibilities,
    requirements: jobFields.requirements,
    apply_url: jobFields.apply_url,
    apply_email: jobFields.apply_email,
    status: jobFields.status,
    valid_through: jobFields.valid_through,
  })
  .superRefine((v, ctx) => {
    requireIdOrSlug(v, ctx);
    const { id: _id, slug: _slug, ...rest } = v;
    if (Object.values(rest).every((x) => x === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Provide at least one field to update.' });
    }
  });

const listContactInquiriesArgs = z.object({
  search: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Case-insensitive match on full_name or message. Email/phone are not searchable: they may be masked.'),
  since: z.string().datetime({ offset: true }).optional().describe('Only inquiries created at or after this instant.'),
  ...pagination,
});

const noArgs = z.object({});

/* ────────────────────────────────────────────────────────────────────────────
 * 5. Tools
 * ──────────────────────────────────────────────────────────────────────────*/

interface ToolContext {
  client: PoolClient;
  actor: ResolvedActor;
  tool: string;
}

interface ToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  /** The governed resource + action this tool needs. `null` for self-describing tools. */
  capability: { resource: ResourceKey; action: Action } | null;
  /** True when the handler writes; writes must route through perform_action(). */
  mutates: boolean;
  schema: S;
  handler: (ctx: ToolContext, args: z.infer<S>) => Promise<Json>;
}

function defineTool<S extends z.ZodType>(def: ToolDefinition<S>): ToolDefinition<z.ZodType> {
  return def as unknown as ToolDefinition<z.ZodType>;
}

/** Build a parameterized SET list from a whitelist of column -> value. */
function buildUpdate(
  columns: Record<string, { value: unknown; cast?: string } | undefined>,
  startIndex: number,
): { clauses: string[]; values: unknown[] } {
  const clauses: string[] = [];
  const values: unknown[] = [];
  for (const [column, entry] of Object.entries(columns)) {
    if (entry === undefined) continue;
    values.push(entry.value);
    clauses.push(`${column} = $${startIndex + values.length - 1}${entry.cast ?? ''}`);
  }
  return { clauses, values };
}

const col = (value: unknown, cast?: string) =>
  value === undefined ? undefined : { value, cast };

const jsonCol = (value: unknown) =>
  value === undefined ? undefined : { value: JSON.stringify(value), cast: '::jsonb' };

async function findPost(
  client: PoolClient,
  args: { id?: string; slug?: string },
): Promise<Record<string, unknown>> {
  const { rows } = args.id
    ? await client.query(`select ${POST_COLUMNS} from public.posts where id = $1::uuid`, [args.id])
    : await client.query(`select ${POST_COLUMNS} from public.posts where slug = $1`, [args.slug]);
  const row = rows[0];
  if (!row) {
    throw new McpError(
      ERROR_CODES.NOT_FOUND,
      `No post matches ${args.id ? `id '${args.id}'` : `slug '${args.slug}'`}.`,
      404,
    );
  }
  return row;
}

async function findJobOpening(
  client: PoolClient,
  args: { id?: string; slug?: string },
): Promise<Record<string, unknown>> {
  const { rows } = args.id
    ? await client.query(`select ${JOB_COLUMNS} from public.job_openings where id = $1::uuid`, [args.id])
    : await client.query(`select ${JOB_COLUMNS} from public.job_openings where slug = $1`, [args.slug]);
  const row = rows[0];
  if (!row) {
    throw new McpError(
      ERROR_CODES.NOT_FOUND,
      `No job opening matches ${args.id ? `id '${args.id}'` : `slug '${args.slug}'`}.`,
      404,
    );
  }
  return row;
}

const TOOLS: ToolDefinition<z.ZodType>[] = [
  /* ── blog ──────────────────────────────────────────────────────────────── */

  defineTool({
    name: 'list_posts',
    description:
      'List blog posts, newest first, with optional status/category/text filters. Requires blog:view.',
    capability: { resource: 'blog', action: 'view' },
    mutates: false,
    schema: listPostsArgs,
    async handler({ client }, args) {
      const { rows } = await client.query(
        `select ${POST_COLUMNS}
           from public.posts
          where ($1::text is null or status = $1::text)
            and ($2::text is null or category = $2::text)
            and ($3::text is null or title ilike '%' || $3::text || '%' or slug ilike '%' || $3::text || '%')
          order by coalesce(published_at, created_at) desc nulls last, id
          limit $4::int offset $5::int`,
        [args.status ?? null, args.category ?? null, args.search ?? null, args.limit, args.offset],
      );
      return {
        count: rows.length,
        limit: args.limit,
        offset: args.offset,
        posts: rows.map(toPost),
      } as unknown as Json;
    },
  }),

  defineTool({
    name: 'get_post',
    description: 'Fetch one blog post by id or slug, in any status. Requires blog:view.',
    capability: { resource: 'blog', action: 'view' },
    mutates: false,
    schema: getPostArgs,
    async handler({ client }, args) {
      return toPost(await findPost(client, args)) as unknown as Json;
    },
  }),

  defineTool({
    name: 'create_post',
    description:
      "Create a blog post. Requires blog:create, plus blog:publish when status is 'published'. " +
      'Audited through perform_action().',
    capability: { resource: 'blog', action: 'create' },
    mutates: true,
    schema: createPostArgs,
    async handler({ client, actor, tool }, args) {
      const { rows: idRows } = await client.query<{ id: string }>('select gen_random_uuid()::text as id');
      const id = idRows[0]!.id;

      const status = args.status ?? 'draft';
      const publishedAt =
        args.published_at ?? (status === 'published' ? new Date().toISOString() : null);

      const receipt = await performAction(
        client,
        actor,
        'blog',
        'create',
        id,
        { after: stamp(tool, actor, { ...args, id, status }) },
      );

      // 003 §8.3: RLS cannot gate a single column, so 'publish' is enforced here
      // — and audited as its own action, because it is its own decision.
      const publishReceipt =
        status === 'published'
          ? await performAction(client, actor, 'blog', 'publish', id, {
              after: stamp(tool, actor, { id, slug: args.slug, status }),
            })
          : null;

      const { rows } = await client.query(
        `insert into public.posts
           (id, title, slug, category, seo_description, featured_image, content_blocks, status, published_at)
         values ($1::uuid, $2, $3, $4, $5, $6, coalesce($7::jsonb, '[]'::jsonb), $8, $9::timestamptz)
         returning ${POST_COLUMNS}`,
        [
          id,
          args.title,
          args.slug,
          args.category,
          args.seo_description ?? null,
          args.featured_image ?? null,
          args.content_blocks ? JSON.stringify(args.content_blocks) : null,
          status,
          publishedAt,
        ],
      );

      return {
        post: toPost(rows[0]!),
        audit_id: receipt.audit_id,
        publish_audit_id: publishReceipt?.audit_id ?? null,
      } as unknown as Json;
    },
  }),

  defineTool({
    name: 'update_post',
    description:
      "Update a blog post by id or slug (partial update). Requires blog:edit, plus blog:publish when " +
      "transitioning status to 'published'. Audited with before/after through perform_action().",
    capability: { resource: 'blog', action: 'edit' },
    mutates: true,
    schema: updatePostArgs,
    async handler({ client, actor, tool }, args) {
      const before = await findPost(client, args);
      const id = before.id as string;
      const becomingPublished = args.status === 'published' && before.status !== 'published';

      const { id: _id, slug: _lookupSlug, new_slug, ...patch } = args;
      const changes: Record<string, unknown> = { ...patch };
      if (new_slug !== undefined) changes.slug = new_slug;

      const receipt = await performAction(client, actor, 'blog', 'edit', id, {
        before: toPost(before) as unknown as Json,
        after: stamp(tool, actor, changes),
      });

      const publishReceipt = becomingPublished
        ? await performAction(client, actor, 'blog', 'publish', id, {
            after: stamp(tool, actor, { id, status: 'published' }),
          })
        : null;

      const publishedAt =
        args.published_at !== undefined
          ? args.published_at
          : becomingPublished && before.published_at === null
            ? new Date().toISOString()
            : undefined;

      const { clauses, values } = buildUpdate(
        {
          title: col(args.title),
          slug: col(new_slug),
          category: col(args.category),
          seo_description: col(args.seo_description),
          featured_image: col(args.featured_image),
          content_blocks: jsonCol(args.content_blocks),
          status: col(args.status),
          published_at: col(publishedAt, '::timestamptz'),
        },
        2,
      );

      if (clauses.length === 0) {
        // Only reachable if the sole field supplied was `new_slug: undefined`;
        // superRefine already rejects the empty patch.
        return { post: toPost(before), audit_id: receipt.audit_id } as unknown as Json;
      }

      const { rows } = await client.query(
        `update public.posts set ${clauses.join(', ')} where id = $1::uuid returning ${POST_COLUMNS}`,
        [id, ...values],
      );

      return {
        post: toPost(rows[0]!),
        audit_id: receipt.audit_id,
        publish_audit_id: publishReceipt?.audit_id ?? null,
      } as unknown as Json;
    },
  }),

  /* ── cms ───────────────────────────────────────────────────────────────── */

  defineTool({
    name: 'get_site_content',
    description:
      'Read one CMS section by section_id, or list every section when section_id is omitted. Requires cms:view.',
    capability: { resource: 'cms', action: 'view' },
    mutates: false,
    schema: getSiteContentArgs,
    async handler({ client }, args) {
      if (args.section_id) {
        const { rows } = await client.query(
          'select section_id, content_data, updated_at from public.site_content where section_id = $1',
          [args.section_id],
        );
        if (!rows[0]) {
          throw new McpError(
            ERROR_CODES.NOT_FOUND,
            `No site_content section '${args.section_id}'.`,
            404,
          );
        }
        return toSiteContent(rows[0]) as unknown as Json;
      }

      const { rows } = await client.query(
        `select section_id, content_data, updated_at
           from public.site_content
          order by section_id
          limit $1::int offset $2::int`,
        [args.limit, args.offset],
      );
      return {
        count: rows.length,
        limit: args.limit,
        offset: args.offset,
        sections: rows.map(toSiteContent),
      } as unknown as Json;
    },
  }),

  defineTool({
    name: 'set_site_content',
    description:
      'Create or replace a CMS section document. Requires cms:create for a new section_id, cms:edit for an ' +
      'existing one. The previous document is copied into content_history first. Audited through perform_action().',
    capability: { resource: 'cms', action: 'edit' },
    mutates: true,
    schema: setSiteContentArgs,
    async handler({ client, actor, tool }, args) {
      const { rows: existingRows } = await client.query(
        'select section_id, content_data, updated_at from public.site_content where section_id = $1',
        [args.section_id],
      );
      const existing = existingRows[0];
      const action: Action = existing ? 'edit' : 'create';

      // `before` is omitted rather than sent as null for a new section:
      // perform_action() copies the key through verbatim, so a null would land
      // in before_data as jsonb 'null' instead of SQL NULL.
      const receipt = await performAction(client, actor, 'cms', action, args.section_id, {
        ...(existing ? { before: toSiteContent(existing) as unknown as Json } : {}),
        after: stamp(tool, actor, { section_id: args.section_id, content_data: args.content_data }),
      });

      // content_history has no authenticated INSERT policy by design (003 §8.2):
      // revisions are written server-side, exactly here.
      if (existing) {
        await client.query(
          'insert into public.content_history (section_id, content_data, changed_by) values ($1, $2::jsonb, $3)',
          [args.section_id, JSON.stringify(existing.content_data), actor.actor],
        );
      }

      const { rows } = await client.query(
        `insert into public.site_content (section_id, content_data, updated_at)
         values ($1, $2::jsonb, now())
         on conflict (section_id) do update
            set content_data = excluded.content_data, updated_at = now()
         returning section_id, content_data, updated_at`,
        [args.section_id, JSON.stringify(args.content_data)],
      );

      return {
        section: toSiteContent(rows[0]!),
        action,
        history_written: Boolean(existing),
        audit_id: receipt.audit_id,
      } as unknown as Json;
    },
  }),

  /* ── careers ───────────────────────────────────────────────────────────── */

  defineTool({
    name: 'list_job_openings',
    description: 'List job openings in any status, newest first. Requires careers:view.',
    capability: { resource: 'careers', action: 'view' },
    mutates: false,
    schema: listJobOpeningsArgs,
    async handler({ client }, args) {
      const { rows } = await client.query(
        `select ${JOB_COLUMNS}
           from public.job_openings
          where ($1::text is null or status = $1::text)
            and ($2::text is null or department = $2::text)
          order by coalesce(posted_at, created_at) desc nulls last, id
          limit $3::int offset $4::int`,
        [args.status ?? null, args.department ?? null, args.limit, args.offset],
      );
      return {
        count: rows.length,
        limit: args.limit,
        offset: args.offset,
        job_openings: rows.map(toJobOpening),
      } as unknown as Json;
    },
  }),

  defineTool({
    name: 'create_job_opening',
    description:
      "Create a job opening. Requires careers:create, plus careers:publish when status is 'open' (an open " +
      'listing is publicly readable). Audited through perform_action().',
    capability: { resource: 'careers', action: 'create' },
    mutates: true,
    schema: createJobOpeningArgs,
    async handler({ client, actor, tool }, args) {
      const { rows: idRows } = await client.query<{ id: string }>('select gen_random_uuid()::text as id');
      const id = idRows[0]!.id;
      const status = args.status ?? 'draft';

      const receipt = await performAction(client, actor, 'careers', 'create', id, {
        after: stamp(tool, actor, { ...args, id, status }),
      });

      const publishReceipt =
        status === 'open'
          ? await performAction(client, actor, 'careers', 'publish', id, {
              after: stamp(tool, actor, { id, slug: args.slug, status }),
            })
          : null;

      const { rows } = await client.query(
        `insert into public.job_openings
           (id, title, slug, department, location, employment_type, workplace_type, salary_min, salary_max,
            salary_currency, salary_period, description, responsibilities, requirements, apply_url,
            apply_email, status, valid_through, posted_at)
         values ($1::uuid, $2, $3, $4, $5, coalesce($6, 'FULL_TIME'), $7, $8::numeric, $9::numeric,
                 coalesce($10, 'INR'), coalesce($11, 'YEAR'), $12, $13::text[], $14::text[], $15,
                 $16, $17, $18::date, case when $17 = 'open' then now() else null end)
         returning ${JOB_COLUMNS}`,
        [
          id,
          args.title,
          args.slug,
          args.department ?? null,
          args.location ?? null,
          args.employment_type ?? null,
          args.workplace_type ?? null,
          args.salary_min ?? null,
          args.salary_max ?? null,
          args.salary_currency ?? null,
          args.salary_period ?? null,
          args.description,
          args.responsibilities ?? null,
          args.requirements ?? null,
          args.apply_url ?? null,
          args.apply_email ?? null,
          status,
          args.valid_through ?? null,
        ],
      );

      return {
        job_opening: toJobOpening(rows[0]!),
        audit_id: receipt.audit_id,
        publish_audit_id: publishReceipt?.audit_id ?? null,
      } as unknown as Json;
    },
  }),

  defineTool({
    name: 'update_job_opening',
    description:
      "Update a job opening by id or slug (partial update). Requires careers:edit, plus careers:publish when " +
      "transitioning status to 'open'. Audited with before/after through perform_action().",
    capability: { resource: 'careers', action: 'edit' },
    mutates: true,
    schema: updateJobOpeningArgs,
    async handler({ client, actor, tool }, args) {
      const before = await findJobOpening(client, args);
      const id = before.id as string;
      const becomingOpen = args.status === 'open' && before.status !== 'open';

      const { id: _id, slug: _lookupSlug, new_slug, ...patch } = args;
      const changes: Record<string, unknown> = { ...patch };
      if (new_slug !== undefined) changes.slug = new_slug;

      const receipt = await performAction(client, actor, 'careers', 'edit', id, {
        before: toJobOpening(before) as unknown as Json,
        after: stamp(tool, actor, changes),
      });

      const publishReceipt = becomingOpen
        ? await performAction(client, actor, 'careers', 'publish', id, {
            after: stamp(tool, actor, { id, status: 'open' }),
          })
        : null;

      const { clauses, values } = buildUpdate(
        {
          title: col(args.title),
          slug: col(new_slug),
          department: col(args.department),
          location: col(args.location),
          employment_type: col(args.employment_type),
          workplace_type: col(args.workplace_type),
          salary_min: col(args.salary_min, '::numeric'),
          salary_max: col(args.salary_max, '::numeric'),
          salary_currency: col(args.salary_currency),
          salary_period: col(args.salary_period),
          description: col(args.description),
          responsibilities: col(args.responsibilities, '::text[]'),
          requirements: col(args.requirements, '::text[]'),
          apply_url: col(args.apply_url),
          apply_email: col(args.apply_email),
          status: col(args.status),
          valid_through: col(args.valid_through, '::date'),
          posted_at: becomingOpen && before.posted_at === null ? { value: new Date().toISOString(), cast: '::timestamptz' } : undefined,
        },
        2,
      );

      if (clauses.length === 0) {
        return { job_opening: toJobOpening(before), audit_id: receipt.audit_id } as unknown as Json;
      }

      const { rows } = await client.query(
        `update public.job_openings set ${clauses.join(', ')} where id = $1::uuid returning ${JOB_COLUMNS}`,
        [id, ...values],
      );

      return {
        job_opening: toJobOpening(rows[0]!),
        audit_id: receipt.audit_id,
        publish_audit_id: publishReceipt?.audit_id ?? null,
      } as unknown as Json;
    },
  }),

  /* ── crm ───────────────────────────────────────────────────────────────── */

  defineTool({
    name: 'list_contact_inquiries',
    description:
      'List contact-form inquiries, newest first, through public.contact_inquiries_view. Requires crm:view. ' +
      'email and phone_number arrive partially masked unless the caller holds crm:edit or crm:create; the ' +
      'per-row `pii_masked` flag reports which form was returned.',
    capability: { resource: 'crm', action: 'view' },
    mutates: false,
    schema: listContactInquiriesArgs,
    async handler({ client }, args) {
      // 005: read the VIEW, never the base table. The view decides masking from
      // auth.uid() (set to the actor for this transaction), so querying
      // contact_inquiries directly here would be the exact bypass 005 §4 closes.
      const { rows } = await client.query(
        `select id, full_name, email, phone_number, message, created_at, pii_masked
           from public.contact_inquiries_view
          where ($1::text is null or full_name ilike '%' || $1::text || '%' or message ilike '%' || $1::text || '%')
            and ($2::timestamptz is null or created_at >= $2::timestamptz)
          order by created_at desc nulls last, id
          limit $3::int offset $4::int`,
        [args.search ?? null, args.since ?? null, args.limit, args.offset],
      );
      const inquiries = rows.map(toContactInquiry);
      return {
        count: inquiries.length,
        limit: args.limit,
        offset: args.offset,
        pii_masked: inquiries[0]?.pii_masked ?? null,
        inquiries,
      } as unknown as Json;
    },
  }),

  /* ── introspection ─────────────────────────────────────────────────────── */

  defineTool({
    name: 'get_caller_context',
    description:
      'Report the resolved caller identity, its backing database actor, its role, and the capability grants ' +
      'that role holds. Requires no capability: it discloses only what the caller could already determine by ' +
      'attempting each tool.',
    capability: null,
    mutates: false,
    schema: noArgs,
    async handler({ client, actor }) {
      const { rows } = await client.query<{ role: string | null; capabilities: Json }>(
        `select ur.role,
                coalesce(
                  json_agg(json_build_object('resource_key', rc.resource_key, 'action', rc.action)
                           order by rc.resource_key, rc.action)
                  filter (where rc.allowed), '[]'::json
                ) as capabilities
           from public.user_roles ur
           left join public.role_capabilities rc on rc.role = ur.role
          where ur.user_id = $1::uuid
          group by ur.role`,
        [actor.actorUserId],
      );

      return {
        identity: actor.identity,
        actor: actor.actor,
        actor_user_id: actor.actorUserId,
        role: rows[0]?.role ?? null,
        capabilities: rows[0]?.capabilities ?? [],
      } as unknown as Json;
    },
  }),
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** MCP `tools/list` payload: JSON Schema derived from the same zod schemas that validate calls. */
const TOOL_MANIFEST = TOOLS.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: z.toJSONSchema(tool.schema, { io: 'input' }),
  annotations: {
    readOnlyHint: !tool.mutates,
    destructiveHint: false,
    requiredCapability: tool.capability
      ? `${tool.capability.resource}:${tool.capability.action}`
      : null,
  },
}));

/* ────────────────────────────────────────────────────────────────────────────
 * 6. Dispatch
 * ──────────────────────────────────────────────────────────────────────────*/

const SERVER_INFO = { name: 'vigyan-site-os', version: '1.0.0' } as const;
const PROTOCOL_VERSION = '2025-06-18';

type RpcId = string | number | null;

function rpcResult(id: RpcId, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: '2.0', id, result }, { status });
}

function rpcError(id: RpcId, err: McpError) {
  return NextResponse.json(
    {
      jsonrpc: '2.0',
      id,
      error: { code: err.code, message: err.message, ...(err.data ? { data: err.data } : {}) },
    },
    { status: err.httpStatus },
  );
}

async function callTool(identity: string, params: unknown): Promise<Json> {
  const parsedParams = z
    .object({ name: z.string().min(1), arguments: z.record(z.string(), z.unknown()).optional() })
    .safeParse(params);

  if (!parsedParams.success) {
    throw new McpError(
      ERROR_CODES.INVALID_PARAMS,
      'tools/call requires params.name (string) and optional params.arguments (object).',
      400,
    );
  }

  const tool = TOOLS_BY_NAME.get(parsedParams.data.name);
  if (!tool) {
    throw new McpError(
      ERROR_CODES.METHOD_NOT_FOUND,
      `Unknown tool '${parsedParams.data.name}'. Call tools/list for the available tools.`,
      404,
    );
  }

  const parsedArgs = tool.schema.safeParse(parsedParams.data.arguments ?? {});
  if (!parsedArgs.success) {
    throw new McpError(
      ERROR_CODES.INVALID_PARAMS,
      `Invalid arguments for '${tool.name}': ${parsedArgs.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
      400,
      parsedArgs.error.issues as unknown as Json,
    );
  }

  // The actor lookup needs a connection but must not sit inside the tool's
  // transaction — a failure to resolve it is a configuration error, not a
  // rolled-back write.
  const setupClient = await getPool().connect();
  let actor: ResolvedActor;
  try {
    actor = await resolveActor(setupClient, identity);
  } finally {
    setupClient.release();
  }

  return withActorTransaction(actor.actorUserId, async (client) => {
    // Deny before touching any data.
    //
    // Read-only tools are gated here with user_has_capability(). Mutating tools
    // are NOT pre-checked: their gate is perform_action(), which makes the
    // permission decision and the audit row a single operation. Checking twice
    // would create two places that could disagree, and would let a write be
    // authorized without being recorded.
    if (tool.capability && !tool.mutates) {
      await requireCapability(client, actor, tool.capability.resource, tool.capability.action);
    }

    return tool.handler({ client, actor, tool: tool.name }, parsedArgs.data);
  });
}

export async function POST(request: Request) {
  // Authenticate before parsing anything: an anonymous caller gets no
  // processing beyond a header comparison.
  const identity = await resolveCallerIdentity(request);
  if (!identity) {
    return rpcError(
      null,
      new McpError(
        ERROR_CODES.UNAUTHENTICATED,
        'Unauthorized: send `Authorization: Bearer <token>`, where the token is ' +
          'either MCP_SECRET_KEY or a JWT signed with MCP_JWT_SECRET carrying the ' +
          '`mcp` scope. Session-cookie authentication is not available yet.',
        401,
      ),
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(
      null,
      new McpError(ERROR_CODES.PARSE_ERROR, 'Request body is not valid JSON.', 400),
    );
  }

  if (Array.isArray(body)) {
    return rpcError(
      null,
      new McpError(
        ERROR_CODES.INVALID_REQUEST,
        'Batched JSON-RPC requests are not supported; send one request per POST.',
        400,
      ),
    );
  }

  if (typeof body !== 'object' || body === null) {
    return rpcError(
      null,
      new McpError(ERROR_CODES.INVALID_REQUEST, 'Request body must be a JSON-RPC object.', 400),
    );
  }

  const { jsonrpc, id: rawId, method, params } = body as Record<string, unknown>;
  const id: RpcId =
    typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;

  if (jsonrpc !== '2.0') {
    return rpcError(
      id,
      new McpError(ERROR_CODES.INVALID_REQUEST, "Missing or invalid `jsonrpc`; expected '2.0'.", 400),
    );
  }

  if (typeof method !== 'string') {
    return rpcError(
      id,
      new McpError(ERROR_CODES.INVALID_REQUEST, '`method` must be a string.', 400),
    );
  }

  // Notifications (no id) carry no response body. `notifications/initialized` is
  // the one MCP clients send routinely.
  if (rawId === undefined && method.startsWith('notifications/')) {
    return new NextResponse(null, { status: 202 });
  }

  try {
    switch (method) {
      case 'initialize':
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Every tool is capability-checked in the database and every write is audited. Call ' +
            'get_caller_context to see which capabilities the current credential actually holds.',
        });

      case 'ping':
        return rpcResult(id, {});

      case 'tools/list':
        return rpcResult(id, { tools: TOOL_MANIFEST });

      case 'tools/call': {
        const payload = await callTool(identity, params);
        return rpcResult(id, {
          content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
          isError: false,
        });
      }

      default:
        return rpcError(
          id,
          new McpError(
            ERROR_CODES.METHOD_NOT_FOUND,
            `Unsupported method '${method}'. Supported: initialize, ping, tools/list, tools/call.`,
            404,
          ),
        );
    }
  } catch (err) {
    const mcpError = asMcpError(err);
    if (mcpError.code === ERROR_CODES.INTERNAL_ERROR) {
      console.error('[mcp] unhandled error', err);
    }
    return rpcError(id, mcpError);
  }
}


/**
 * Streamable HTTP — the transport the MCP specification adopted in revision
 * 2025-03-26, replacing the older HTTP+SSE pair.
 *
 * A client MAY open a GET stream on the same URL to receive server-initiated
 * messages. This server has none to send: every tool call here is a synchronous
 * request/response against Postgres, with no progress notifications and no
 * subscriptions. So the honest answer to GET is 405 with `Allow: POST`, which
 * the specification explicitly permits — the alternative is an idle stream that
 * holds a connection open and never carries a byte.
 *
 * POST alone is a complete Streamable HTTP implementation. Adding a stream
 * would mean adding something worth streaming first.
 *
 * The old HTTP+SSE transport is NOT implemented, deliberately. It is deprecated,
 * and building on it now would be building on something already replaced.
 */
export async function GET(request: Request) {
  // Authenticate even to say "not supported": an anonymous caller should not be
  // able to learn anything about this endpoint, including its shape.
  const identity = await resolveCallerIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }
  return NextResponse.json(
    {
      error: 'This endpoint does not open a server-initiated stream.',
      detail:
        'Streamable HTTP permits a server to decline the optional GET stream. Every ' +
        'tool here is a synchronous request/response, so there is nothing to push. ' +
        'Send JSON-RPC over POST to this same URL.',
    },
    { status: 405, headers: { Allow: 'POST' } },
  );
}

/**
 * Session termination. Streamable HTTP lets a client DELETE to end a session it
 * started with `Mcp-Session-Id`.
 *
 * This server is stateless: identity is re-established from the bearer token on
 * every request, so there is no session to end. Returning 204 keeps
 * well-behaved clients happy — they are cleaning up, and telling them the
 * cleanup failed would be misleading.
 */
export async function DELETE(request: Request) {
  const identity = await resolveCallerIdentity(request);
  if (!identity) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
    );
  }
  return new NextResponse(null, { status: 204 });
}

/**
 * Preflight. A browser-based MCP client sends Authorization, which is not a
 * CORS-safelisted header, so it preflights.
 *
 * Origin is NOT reflected and credentials are NOT allowed: this endpoint is for
 * programmatic clients holding a bearer token, and echoing arbitrary origins
 * would let any page a victim visits call it with their token.
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
      'Access-Control-Max-Age': '600',
    },
  });
}
