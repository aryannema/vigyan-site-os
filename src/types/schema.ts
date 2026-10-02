/**
 * site-os — shared database type contract.
 *
 * Ported from the vigyan-site-os template (2026-08-11) alongside the
 * roles-and-capabilities schema in `supabase/migrations/00{1..9}_*.sql`, which
 * this file describes.
 *
 * SINGLE SOURCE OF TRUTH for the NEW schema. Every downstream module (admin UI,
 * MCP tools, API routes, webhooks, agents) should import its database shapes
 * from here rather than redeclaring them. If a type here disagrees with
 * `supabase/migrations/*.sql`, the SQL wins and this file is the bug.
 *
 * NOTE for this repo specifically: `src/lib/blog-schema.ts` predates this file
 * and declares its own, looser `ContentBlock` plus the ajv `BLOG_POST_SCHEMA`
 * the MCP route validates against. That one is the INPUT-BOUNDARY contract for
 * MCP/webhook writers; this file (plus `src/lib/content/blocks.ts`) is the
 * canonical render/edit contract. They agree on block shapes — see
 * `src/lib/content/legacy.ts` for the adapter that reconciles pre-existing rows.
 *
 * Conventions used throughout:
 *   - `uuid`        -> string
 *   - `text`        -> string
 *   - `timestamptz` -> string, ISO 8601 (e.g. "2026-08-10T16:20:00.000Z")
 *   - `date`        -> string, "YYYY-MM-DD"
 *   - `numeric`     -> number   (safe for the money/confidence magnitudes here;
 *                                revisit if arbitrary-precision values appear)
 *   - `jsonb`       -> a named shape where one is knowable, else Json
 *   - nullable SQL columns are `| null`, NOT optional (`?`). A column that
 *     exists and is null is different from a field the caller omitted, and
 *     conflating them hides bugs at insert time.
 *
 * Named exports only — no default export.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * JSON primitives
 * ──────────────────────────────────────────────────────────────────────────*/

export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

/* ────────────────────────────────────────────────────────────────────────────
 * Roles, resources, actions — the permission vocabulary
 *
 * These three arrays mirror, in order:
 *   - the CHECK constraint on user_roles.role / role_capabilities.role
 *   - the `resource:<key>` table comments that the `resources` VIEW derives from
 *   - the CHECK constraint on role_capabilities.action
 *
 * RESOURCE_KEYS is the one to watch: resources are DERIVED FROM THE SCHEMA at
 * runtime (any table tagged `resource:<key>`), so this array is a compile-time
 * convenience listing the keys that exist TODAY, not a closed set the database
 * enforces. When a migration tags a new table, add its key here too. Query
 * `select resource_key from resources` for the live truth.
 * ──────────────────────────────────────────────────────────────────────────*/

export const ROLES = [
  'viewer',
  'editor',
  'admin',
  'support_human',
  'support_bot_voice',
  'support_bot_text',
] as const;

export type Role = (typeof ROLES)[number];

export const RESOURCE_KEYS = [
  'cms',
  'blog',
  'crm',
  'careers',
  'users',
  'settings',
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'publish'] as const;

export type Action = (typeof ACTIONS)[number];

/** Runtime narrowing helpers — useful when validating untrusted input. */
export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export const isResourceKey = (value: unknown): value is ResourceKey =>
  typeof value === 'string' &&
  (RESOURCE_KEYS as readonly string[]).includes(value);

export const isAction = (value: unknown): value is Action =>
  typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);

/* ────────────────────────────────────────────────────────────────────────────
 * Permission tables — 003_role_expansion.sql
 * ──────────────────────────────────────────────────────────────────────────*/

/** public.user_roles — one row per user, at most one role each. */
export interface UserRole {
  user_id: string;
  role: Role;
  created_at: string;
}

/**
 * public.role_capabilities — the grant matrix.
 *
 * `resource_key` is deliberately widened beyond ResourceKey: the SQL column is
 * free text so a resource can be granted the moment its table is tagged, and
 * the seed already contains rows for `payments`, which has no table yet. Use
 * `isResourceKey()` if you need to narrow.
 *
 * `allowed: false` records an explicit deny. Both a false row and a missing row
 * evaluate to denied — the distinction exists for auditability.
 */
export interface CapabilityGrant {
  role: Role;
  resource_key: ResourceKey | (string & {});
  action: Action;
  allowed: boolean;
}

/** Alias matching the SQL table name, for callers who prefer it. */
export type RoleCapability = CapabilityGrant;

/** A row of the public.resources VIEW (derived live from table comments). */
export interface ResourceRow {
  resource_key: string;
}

/**
 * Return shape of public.perform_action(). Denials throw rather than return.
 *
 * `actor` is the RESOLVED identity (an auth.users uuid as text), not the string
 * that was passed in — 008 canonicalises it so that "everything actor X did" is
 * a single equality predicate over action_audit_log. What the caller supplied is
 * echoed back in `actor_claim` and stored in the same column on the audit row.
 *
 * `payload_discarded` is true when a payload was passed with `action: 'view'`.
 * A view mutates nothing, so it never records before/after state (008 rule A);
 * the flag says the payload was dropped rather than letting a caller believe a
 * state claim was recorded.
 */
export interface PerformActionReceipt {
  ok: true;
  audit_id: string;
  actor: string;
  actor_claim: string;
  actor_user_id: string;
  resource_key: string;
  action: Action;
  target_id: string | null;
  payload_discarded: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Admin auth — 002_admin_auth.sql
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * public.admin_users — the admin allow-list.
 *
 * Never seeded by a migration. The first admins come from the
 * BOOTSTRAP_ADMIN_EMAILS env var; every later one is added through the admin UI.
 * Service-role access only (RLS enabled, no policies).
 */
export interface AdminUser {
  email: string;
  added_at: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * CMS — site_content / content_history (resource: cms)
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * The jsonb document stored in site_content.content_data.
 *
 * Intentionally open: this template does not dictate section shapes, and the
 * application layer (not the database) validates them. Deployments should
 * declare their own per-section interfaces and narrow this on read.
 */
export type ContentData = JsonObject;

/** public.site_content — one row per addressable section of the site. */
export interface SiteContent {
  section_id: string;
  content_data: ContentData;
  updated_at: string | null;
}

/** public.content_history — append-only revisions of site_content. */
export interface ContentHistory {
  id: string;
  section_id: string | null;
  content_data: ContentData;
  changed_by: string | null;
  created_at: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Blog — posts (resource: blog)
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * One element of posts.content_blocks.
 *
 * `type` is the discriminant every renderer switches on; the remaining fields
 * are block-specific. Deployments should declare a discriminated union of their
 * own block types and narrow this on read.
 */
export interface ContentBlock {
  type: string;
  [key: string]: Json | undefined;
}

export const POST_STATUSES = [
  'draft',
  'scheduled',
  'published',
  'archived',
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

/**
 * public.posts — blog/article store.
 *
 * NOTE: status defaults to 'draft', not 'published'. 'published' is the
 * anon-readable state, so it must be set deliberately (and should go through
 * the `blog:publish` capability).
 */
export interface Post {
  id: string;
  title: string;
  slug: string;
  category: string;
  seo_description: string | null;
  featured_image: string | null;
  content_blocks: ContentBlock[];
  status: PostStatus;
  published_at: string | null;
  created_at: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Careers — job_openings (resource: careers)
 * ──────────────────────────────────────────────────────────────────────────*/

export const EMPLOYMENT_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACTOR',
  'INTERN',
  'TEMPORARY',
] as const;

export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const WORKPLACE_TYPES = ['on-site', 'remote', 'hybrid'] as const;

export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];

export const SALARY_PERIODS = ['YEAR', 'MONTH', 'HOUR'] as const;

export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export const JOB_OPENING_STATUSES = ['draft', 'open', 'closed'] as const;

export type JobOpeningStatus = (typeof JOB_OPENING_STATUSES)[number];

/**
 * public.job_openings — careers listings.
 *
 * NOTE: status defaults to 'draft', not 'open', for the same reason as posts.
 */
export interface JobOpening {
  id: string;
  title: string;
  slug: string;
  department: string | null;
  location: string | null;
  employment_type: EmploymentType;
  workplace_type: WorkplaceType | null;
  salary_min: number | null;
  salary_max: number | null;
  salary_currency: string | null;
  salary_period: SalaryPeriod | null;
  description: string;
  responsibilities: string[] | null;
  requirements: string[] | null;
  apply_url: string | null;
  apply_email: string | null;
  status: JobOpeningStatus;
  valid_through: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * CRM — contact_inquiries + WhatsApp (resource: crm)
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * public.contact_inquiries — public contact/lead form submissions. Contains PII.
 *
 * ⚠ THIS IS THE RAW TABLE. Since 005_contact_pii_masking.sql it is readable only
 * by callers holding `crm:edit`, `crm:create` or `crm:delete` (and the service
 * role). A `crm:view`-only caller gets ZERO ROWS from it — not an error, just an
 * empty result, which is the usual RLS shape and a common source of confusion.
 *
 * READ THROUGH {@link ContactInquiryView} / `contact_inquiries_view` INSTEAD.
 * That is the supported read path for every role, including the ones that would
 * see identical values here. Use this type for INSERTs (the public contact form)
 * and for service-role code that legitimately needs raw identifiers.
 */
export interface ContactInquiry {
  id: string;
  full_name: string;
  email: string;
  phone_number: string | null;
  message: string;
  created_at: string | null;
}

/**
 * public.contact_inquiries_view — the read path for contact inquiries.
 *
 * Same columns as {@link ContactInquiry} plus `pii_masked`, but `email` and
 * `phone_number` are partially masked unless the caller can act on the inquiry:
 *
 *   crm:edit OR crm:create -> raw values,    pii_masked === false
 *   crm:view only          -> masked values, pii_masked === true
 *   no crm:view            -> no rows at all
 *
 * Against the default capability matrix that means admin, support_human and both
 * support bots see raw values, while editor and viewer see masked ones.
 *
 * Masked forms (see the algorithms in 005_contact_pii_masking.sql):
 *   email        'anita.sharma@acme-corp.co.in' -> 'a***@acme-corp.co.in'
 *   phone_number '+91 98765 43210'              -> '+91 XXXXX XXX10'
 *   a NULL phone_number stays NULL — it is not masked into a placeholder.
 *
 * `full_name` and `message` are NOT masked for any role.
 *
 * The masking is decided in the database, so `pii_masked` is the authoritative
 * answer to "may this UI offer a mailto:/tel: link?". Do not re-derive it from
 * the user's role in application code — that duplicates the rule and will drift.
 * The strings are already masked on arrival; there is nothing to unmask client
 * side, and a masked value must never be sent back in an update.
 */
export interface ContactInquiryView {
  id: string;
  full_name: string;
  /** Masked (`j***@domain.tld`) unless `pii_masked` is false. */
  email: string;
  /** Masked (`+91 XXXXX XXX10`) unless `pii_masked` is false. NULL stays NULL. */
  phone_number: string | null;
  message: string;
  created_at: string | null;
  /** True when this row's email/phone_number arrived masked. */
  pii_masked: boolean;
}

export const CONVERSATION_MODES = ['auto', 'human'] as const;

/** 'auto' = the bot may reply. 'human' = a person took over; the bot stays silent. */
export type ConversationMode = (typeof CONVERSATION_MODES)[number];

/** public.whatsapp_conversations — one row per customer phone number. */
export interface WhatsAppConversation {
  phone_number: string;
  mode: ConversationMode;
  last_inbound_at: string | null;
  escalated_at: string | null;
  escalation_reason: string | null;
  unresolved_turns: number;
  created_at: string;
  updated_at: string;
}

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'] as const;

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/**
 * public.whatsapp_messages — append-only conversation evidence trail.
 *
 * There are no UPDATE or DELETE policies on this table for any role, by design.
 * Treat rows as immutable.
 */
export interface WhatsAppMessage {
  id: string;
  phone_number: string;
  direction: MessageDirection;
  body: string;
  model: string | null;
  confidence: number | null;
  escalated: boolean;
  escalation_reason: string | null;
  cost_estimate_usd: number | null;
  wa_message_id: string | null;
  created_at: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Entitlements (untagged — Phase 3 payments)
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * public.user_entitlements — paid/gated content access grants.
 *
 * Placeholder for the deferred paywalled-content feature. The real shape
 * (price, order reference, expiry) is Phase 3 work.
 */
export interface UserEntitlement {
  id: string;
  user_id: string | null;
  entitlement: string;
  created_at: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Audit trails
 * ──────────────────────────────────────────────────────────────────────────*/

/**
 * public.action_audit_log — the audit trail for every governed write.
 *
 * Rows are produced by perform_action(), which checks the capability and writes
 * the record as one operation, and by the audit-by-construction triggers on
 * posts / job_openings (007), which derive their rows from the data itself and
 * so cannot be shaped by a caller. Append-only: no role has INSERT/UPDATE/DELETE.
 *
 * `actor` is always the resolved identity: an auth.users uuid, or
 * `system:<database role>` for a change a trigger observed with no session
 * identity. `actor_claim` holds the identity string a perform_action() caller
 * supplied (uuid, braced uuid, or email, verbatim) and is NULL for trigger rows.
 * Attribute by `actor`; `actor_claim` is evidence of what was asserted.
 */
export interface ActionAuditLog {
  id: string;
  actor: string;
  actor_claim: string | null;
  resource_key: string;
  action: string;
  target_id: string | null;
  before_data: Json | null;
  after_data: Json | null;
  created_at: string;
}

/**
 * public.mcp_audit_log — legacy MCP-tool-call audit trail.
 *
 * @deprecated Superseded by ActionAuditLog / perform_action(). Retained for
 * backward compatibility with the existing MCP route.
 */
export interface McpAuditLog {
  id: string;
  tool_name: string;
  arguments: Json | null;
  success: boolean | null;
  error_message: string | null;
  changed_by: string | null;
  created_at: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Insert/update helpers
 *
 * Columns with database defaults are optional on insert. Primary keys and
 * generated timestamps should not be supplied by callers.
 * ──────────────────────────────────────────────────────────────────────────*/

/** Makes the listed keys optional; everything else stays required. */
export type WithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type SiteContentInsert = WithDefaults<SiteContent, 'updated_at'>;
export type ContentHistoryInsert = WithDefaults<
  ContentHistory,
  'id' | 'created_at'
>;
export type PostInsert = WithDefaults<
  Post,
  'id' | 'status' | 'created_at' | 'published_at'
>;
export type ContactInquiryInsert = WithDefaults<
  ContactInquiry,
  'id' | 'created_at'
>;
export type JobOpeningInsert = WithDefaults<
  JobOpening,
  'id' | 'employment_type' | 'salary_currency' | 'salary_period' | 'status' | 'created_at' | 'updated_at'
>;
export type WhatsAppConversationInsert = WithDefaults<
  WhatsAppConversation,
  'mode' | 'unresolved_turns' | 'created_at' | 'updated_at'
>;
export type WhatsAppMessageInsert = WithDefaults<
  WhatsAppMessage,
  'id' | 'escalated' | 'created_at'
>;
export type UserEntitlementInsert = WithDefaults<
  UserEntitlement,
  'id' | 'created_at'
>;
export type UserRoleInsert = WithDefaults<UserRole, 'created_at'>;
export type AdminUserInsert = WithDefaults<AdminUser, 'added_at'>;

/* ────────────────────────────────────────────────────────────────────────────
 * Table registry
 *
 * Maps SQL table names to their row types, for generic helpers and for the
 * supabase-js `Database` generic if one is generated later.
 * ──────────────────────────────────────────────────────────────────────────*/

export interface Tables {
  site_content: SiteContent;
  content_history: ContentHistory;
  posts: Post;
  contact_inquiries: ContactInquiry;
  mcp_audit_log: McpAuditLog;
  user_entitlements: UserEntitlement;
  job_openings: JobOpening;
  whatsapp_conversations: WhatsAppConversation;
  whatsapp_messages: WhatsAppMessage;
  admin_users: AdminUser;
  user_roles: UserRole;
  role_capabilities: CapabilityGrant;
  action_audit_log: ActionAuditLog;
}

export type TableName = keyof Tables;

/**
 * Read-only relations that are views, not tables.
 *
 * Separate from {@link Tables} because nothing here is writable: `resources` is
 * derived live from table comments, and `contact_inquiries_view` is a read path
 * over contact_inquiries. Writes go to the underlying table.
 */
export interface Views {
  resources: ResourceRow;
  contact_inquiries_view: ContactInquiryView;
}

export type ViewName = keyof Views;

/**
 * Which resource key governs which table, mirroring the `resource:<key>` table
 * comments in 003_role_expansion.sql. `null` means intentionally untagged —
 * those tables are service-role-managed and are not reachable through the
 * capability system. Keep in sync with the migration; `select * from resources`
 * is the runtime truth.
 */
export const TABLE_RESOURCE_MAP: Readonly<Record<TableName, ResourceKey | null>> =
  {
    site_content: 'cms',
    content_history: 'cms',
    posts: 'blog',
    contact_inquiries: 'crm',
    whatsapp_conversations: 'crm',
    whatsapp_messages: 'crm',
    job_openings: 'careers',
    user_roles: 'users',
    admin_users: 'users',
    mcp_audit_log: null,
    user_entitlements: null,
    role_capabilities: null,
    action_audit_log: null,
  } as const;
