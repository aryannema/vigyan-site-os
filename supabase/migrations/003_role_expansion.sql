-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003: Roles, derivable resources, capabilities, and all RLS policies
--
-- THIS FILE IS THE ENTIRE ACCESS-CONTROL SURFACE OF vigyan-site-os.
-- If a table can be read or written by a non-service-role client, the rule that
-- allows it is in this file. Review it as a whole.
--
-- ── The model ────────────────────────────────────────────────────────────────
--
--   user  --(user_roles)-->  role  --(role_capabilities)-->  (resource, action)
--
--   * ROLES are a fixed, small, enumerated set (CHECK constraint below).
--   * RESOURCES are NOT enumerated. They are DERIVED FROM THE SCHEMA: any table
--     whose Postgres table comment contains `resource:<key>` belongs to that
--     resource. The `resources` view reads those comments live out of
--     pg_catalog. Adding a whole new governable resource type later (courses,
--     paywalled content, ...) therefore needs no migration to this file — just
--     a COMMENT ON TABLE on the new table plus role_capabilities rows.
--   * ACTIONS are a fixed set: view, create, edit, delete, publish.
--   * CAPABILITIES are EXPLICIT GRANTS. There is no implicit allow anywhere.
--     No row in role_capabilities == denied. No row in user_roles == denied
--     everything. user_has_capability() returns false, never null.
--
-- ── Replaces ─────────────────────────────────────────────────────────────────
-- The source project's flat `get_user_role() IN ('editor','admin')` checks are
-- gone. Every authenticated write path now asks
-- user_has_capability(auth.uid(), '<resource>', '<action>').
-- Public/anonymous READ paths (published posts, open jobs, contact form insert)
-- are NOT capability-gated — they are public by design and are preserved
-- verbatim from the source.
--
-- Safe to re-run: IF NOT EXISTS everywhere; every CREATE POLICY is preceded by
-- DROP POLICY IF EXISTS; the capability seed is ON CONFLICT DO NOTHING so it
-- never stomps an operator's customised matrix.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. user_roles — one role per user
-- ═════════════════════════════════════════════════════════════════════════════
-- Six roles. The three bot/support roles exist because a support desk and an
-- automated responder are not "editors with fewer buttons" — they need CRM
-- write access and zero CMS access, which a 3-role model cannot express.
--   viewer            read-only dashboard access
--   editor            content author/publisher
--   admin             full access to every resource
--   support_human     human agent handling live customer conversations
--   support_bot_text  automated text responder (WhatsApp/chat)
--   support_bot_voice automated voice responder
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id    uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN (
                           'viewer','editor','admin',
                           'support_human','support_bot_voice','support_bot_text')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON public.user_roles (role);


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Resource tags — the schema IS the resource registry
-- ═════════════════════════════════════════════════════════════════════════════
-- Convention: a governable table's comment contains the token `resource:<key>`,
-- where <key> matches [a-z0-9_]+. The `resources` view (section 3) extracts it
-- with a regex, so `resource:cms` and `resource:cms — human readable notes`
-- both work; the token does not have to be the whole comment. A table with no
-- such token is simply not a governable resource and cannot be reached through
-- the capability system at all.
--
-- ⚠ Re-running COMMENT ON TABLE overwrites the previous comment. If you add
--   prose to one of these comments, keep the resource: token in it.

COMMENT ON TABLE public.site_content           IS 'resource:cms';
COMMENT ON TABLE public.content_history        IS 'resource:cms';
COMMENT ON TABLE public.posts                  IS 'resource:blog';
COMMENT ON TABLE public.contact_inquiries      IS 'resource:crm';
COMMENT ON TABLE public.whatsapp_conversations IS 'resource:crm';
COMMENT ON TABLE public.whatsapp_messages      IS 'resource:crm';
COMMENT ON TABLE public.job_openings           IS 'resource:careers';
COMMENT ON TABLE public.user_roles             IS 'resource:users';
COMMENT ON TABLE public.admin_users            IS 'resource:users';

-- INTENTIONALLY UNTAGGED (do not "fix" these without a design decision):
--
--   public.mcp_audit_log      Legacy MCP audit trail, superseded by
--                             action_audit_log. Whether audit trails deserve
--                             their own `audit` resource key is an open
--                             question — see the TODO in 004.
--   public.user_entitlements  Paid-content access grants. Its natural resource
--                             key is `payments`, which does not exist as a
--                             tagged table yet; the payments/entitlements data
--                             model is deferred to Phase 3 and inventing the
--                             tag now would freeze a design that has not been
--                             made. Until then it is read-gated on
--                             users:view (admin-only by default) — see §8.
--   public.role_capabilities  The capability matrix itself. Governing the
--                             governor through the same matrix is a bootstrap
--                             hazard; it is service-role-managed instead.
--   public.action_audit_log   Same reasoning as mcp_audit_log (created in 004).
--   auth.users                Owned by GoTrue, not by this application.
--
-- Untagged does NOT mean unprotected: every one of these tables has RLS enabled
-- with explicit deny-by-default coverage below.


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. resources — a VIEW derived live from the catalog, not a maintained table
-- ═════════════════════════════════════════════════════════════════════════════
-- This is the mechanism that makes resources "derivable from the schema". There
-- is deliberately no `resources` TABLE to drift out of sync: the answer to
-- "what resources exist?" is always recomputed from the table comments.
--
-- security_invoker = true so the view confers no privileges of its own. It
-- reads pg_class/pg_namespace/obj_description, which are readable by every
-- role, so results are consistent regardless of caller. The only information
-- exposed is the set of resource key names, which is not sensitive — it is the
-- vocabulary of the permission system, not any user's permissions.
DROP VIEW IF EXISTS public.resources;
CREATE VIEW public.resources
WITH (security_invoker = true)
AS
SELECT DISTINCT
  substring(obj_description(c.oid, 'pg_class') FROM 'resource:([a-z0-9_]+)') AS resource_key
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')                       -- ordinary + partitioned tables
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND obj_description(c.oid, 'pg_class') ~ 'resource:[a-z0-9_]+';

COMMENT ON VIEW public.resources IS
  'Live-derived list of governable resource keys, parsed from `resource:<key>` tokens in table comments. Not itself a governable resource — deliberately untagged.';

GRANT SELECT ON public.resources TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. role_capabilities — the grant matrix
-- ═════════════════════════════════════════════════════════════════════════════
-- resource_key is intentionally free text (no FK, no CHECK): a new resource
-- must be grantable the moment its table is tagged, without altering this
-- table. role and action ARE constrained — those two vocabularies are part of
-- the system's contract and a typo in them must fail loudly rather than
-- silently create an unreachable grant.
--
-- `allowed` exists so an explicit deny can be recorded distinctly from "no
-- opinion". Both evaluate to denied; the column is for auditability and for a
-- future UI that shows why something is off.
CREATE TABLE IF NOT EXISTS public.role_capabilities (
  role         text    NOT NULL CHECK (role IN (
                         'viewer','editor','admin',
                         'support_human','support_bot_voice','support_bot_text')),
  resource_key text    NOT NULL CHECK (resource_key ~ '^[a-z0-9_]+$'),
  action       text    NOT NULL CHECK (action IN ('view','create','edit','delete','publish')),
  allowed      boolean NOT NULL DEFAULT true,
  PRIMARY KEY (role, resource_key, action)
);

CREATE INDEX IF NOT EXISTS role_capabilities_lookup_idx
  ON public.role_capabilities (role, resource_key, action) WHERE allowed;


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Capability functions
-- ═════════════════════════════════════════════════════════════════════════════

-- get_user_role(): the current session's role, or NULL.
-- SECURITY DEFINER so it can read user_roles without being subject to
-- user_roles' own RLS — that is what prevents infinite policy recursion.
-- search_path is pinned: a SECURITY DEFINER function with a caller-controlled
-- search_path is a privilege-escalation vector.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT ur.role FROM public.user_roles ur WHERE ur.user_id = auth.uid();
$$;

-- user_has_capability(): THE authorization primitive. Everything else defers
-- to this. Contract:
--   * returns true only when an explicit allowed=true grant exists for the
--     user's role on (resource_key, action);
--   * returns FALSE — never NULL — for: no user id, unknown user, user with no
--     role row, role with no matching grant, or an explicit allowed=false.
--     Returning NULL would make `USING (user_has_capability(...))` evaluate to
--     NULL, which RLS treats as false anyway, but a boolean contract that can
--     never be null is far harder to misuse from application code.
CREATE OR REPLACE FUNCTION public.user_has_capability(
  p_user_id     uuid,
  p_resource_key text,
  p_action      text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT COALESCE((
    SELECT rc.allowed
    FROM public.user_roles ur
    JOIN public.role_capabilities rc ON rc.role = ur.role
    WHERE ur.user_id      = p_user_id
      AND rc.resource_key = p_resource_key
      AND rc.action       = p_action
    LIMIT 1
  ), false);
$$;

COMMENT ON FUNCTION public.user_has_capability(uuid, text, text) IS
  'Deny-by-default capability check. Returns true only for an explicit allowed=true grant on the user''s role. Never returns NULL.';

-- Functions are EXECUTE-to-PUBLIC by default in Postgres. These are SECURITY
-- DEFINER and read privileged tables, so lock them down and re-grant narrowly.
-- `authenticated` needs EXECUTE because RLS policy expressions are evaluated as
-- the calling role. `anon` does not: no anon-facing policy calls them.
REVOKE ALL ON FUNCTION public.get_user_role()                        FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_has_capability(uuid, text, text)  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_role()                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.user_has_capability(uuid, text, text) TO authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 6. Default capability matrix
-- ═════════════════════════════════════════════════════════════════════════════
--
--   Role              | cms + blog                      | crm                     | payments                | users
--   ------------------+---------------------------------+-------------------------+-------------------------+-------------------------
--   admin             | view create edit delete publish | view create edit delete | view create edit delete | view create edit delete
--   editor            | view create edit publish        | view                    | —                       | —
--   viewer            | view                            | view                    | —                       | —
--   support_human     | —                               | view create edit        | —                       | —
--   support_bot_text  | —                               | view create             | —                       | —
--   support_bot_voice | —                               | view create             | —                       | —
--
-- Plus: admin gets the full set on `careers` too. Admin is granted every action
-- on every KNOWN resource key; no other role has any careers grant by default,
-- so careers is admin-only until an operator says otherwise.
--
-- Notes on two keys that look odd:
--   `payments`  is seeded but has no tagged table yet (Phase 3). Seeding it now
--               means the eventual payments tables inherit correct admin-only
--               access the moment they are tagged, instead of being briefly
--               ungoverned.
--   `careers`   is deliberately NOT granted to editor/viewer. This is TIGHTER
--               than the source project, where any editor could write job
--               openings. Grant it explicitly if you want that back.
--
-- `delete` is admin-only on every resource, by construction of this matrix.
--
-- ON CONFLICT DO NOTHING: this seeds DEFAULTS. Re-running the migration must
-- not silently revert an operator's deliberate change to the matrix.
INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
SELECT g.role, g.resource_key, a.action, true
FROM (VALUES
  -- admin: everything, on every known resource key
  ('admin',             'cms',      ARRAY['view','create','edit','delete','publish']),
  ('admin',             'blog',     ARRAY['view','create','edit','delete','publish']),
  ('admin',             'careers',  ARRAY['view','create','edit','delete','publish']),
  ('admin',             'crm',      ARRAY['view','create','edit','delete']),
  ('admin',             'payments', ARRAY['view','create','edit','delete']),
  ('admin',             'users',    ARRAY['view','create','edit','delete']),

  -- editor: authors and publishes content; can see the CRM but not touch it
  ('editor',            'cms',      ARRAY['view','create','edit','publish']),
  ('editor',            'blog',     ARRAY['view','create','edit','publish']),
  ('editor',            'crm',      ARRAY['view']),

  -- viewer: read-only
  ('viewer',            'cms',      ARRAY['view']),
  ('viewer',            'blog',     ARRAY['view']),
  ('viewer',            'crm',      ARRAY['view']),

  -- support_human: works the CRM, cannot delete evidence, cannot touch content
  ('support_human',     'crm',      ARRAY['view','create','edit']),

  -- support bots: may read a conversation and append to it, nothing else
  ('support_bot_text',  'crm',      ARRAY['view','create']),
  ('support_bot_voice', 'crm',      ARRAY['view','create'])
) AS g(role, resource_key, actions)
CROSS JOIN LATERAL unnest(g.actions) AS a(action)
ON CONFLICT (role, resource_key, action) DO NOTHING;


-- ═════════════════════════════════════════════════════════════════════════════
-- 7. Enable RLS — every table, no exceptions
-- ═════════════════════════════════════════════════════════════════════════════
-- admin_users already had RLS enabled in 002; repeated here so this file alone
-- proves full coverage.
ALTER TABLE public.site_content           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_inquiries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_audit_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_entitlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_openings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_capabilities      ENABLE ROW LEVEL SECURITY;

-- Reminder for reviewers: the migration runs as the database owner, and a table
-- owner bypasses its own RLS unless FORCE ROW LEVEL SECURITY is set. FORCE is
-- deliberately NOT used: the server-side service role must be able to write
-- through RLS, exactly as Supabase's service_role key does in production.


-- ═════════════════════════════════════════════════════════════════════════════
-- 8. Policies
-- ═════════════════════════════════════════════════════════════════════════════
-- Reading these: policies of the same command are OR-ed. A missing policy for a
-- command means that command is denied for every non-owner role. Several tables
-- below intentionally have no INSERT/UPDATE/DELETE policy — that is the
-- protection, not an oversight, and each one says so.


-- ── 8.1 site_content (resource: cms) ─────────────────────────────────────────
DROP POLICY IF EXISTS "site_content_public_read"     ON public.site_content;
DROP POLICY IF EXISTS "site_content_capability_insert" ON public.site_content;
DROP POLICY IF EXISTS "site_content_capability_update" ON public.site_content;
DROP POLICY IF EXISTS "site_content_capability_delete" ON public.site_content;
-- legacy names from the source project, dropped so a re-point at an old DB is clean
DROP POLICY IF EXISTS "site_content_editor_insert"   ON public.site_content;
DROP POLICY IF EXISTS "site_content_editor_update"   ON public.site_content;
DROP POLICY IF EXISTS "site_content_admin_delete"    ON public.site_content;

-- PUBLIC BY DESIGN: site_content is the rendered marketing site. Preserved
-- verbatim from the source. Do not capability-gate this.
CREATE POLICY "site_content_public_read"
  ON public.site_content FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "site_content_capability_insert"
  ON public.site_content FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_capability(auth.uid(), 'cms', 'create'));

CREATE POLICY "site_content_capability_update"
  ON public.site_content FOR UPDATE
  TO authenticated
  USING      (public.user_has_capability(auth.uid(), 'cms', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'cms', 'edit'));

CREATE POLICY "site_content_capability_delete"
  ON public.site_content FOR DELETE
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'cms', 'delete'));


-- ── 8.2 content_history (resource: cms) ──────────────────────────────────────
DROP POLICY IF EXISTS "content_history_capability_read" ON public.content_history;
DROP POLICY IF EXISTS "content_history_admin_read"      ON public.content_history;

-- DIVERGENCE FROM SOURCE (deliberate): the source restricted history reads to
-- admin. Under the capability model this is cms:view, so editors and viewers
-- can read it too. That is not a new disclosure — content_history holds prior
-- revisions of site_content, and site_content itself is world-readable above.
CREATE POLICY "content_history_capability_read"
  ON public.content_history FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'cms', 'view'));

-- No INSERT/UPDATE/DELETE policy: history is append-only and written by the
-- server (service role) whenever site_content changes. Making it writable from
-- a browser session would let a content editor rewrite the record of what they
-- changed, which defeats the purpose of having it.


-- ── 8.3 posts (resource: blog) ───────────────────────────────────────────────
DROP POLICY IF EXISTS "posts_public_read_published" ON public.posts;
DROP POLICY IF EXISTS "posts_capability_read_all"   ON public.posts;
DROP POLICY IF EXISTS "posts_capability_insert"     ON public.posts;
DROP POLICY IF EXISTS "posts_capability_update"     ON public.posts;
DROP POLICY IF EXISTS "posts_capability_delete"     ON public.posts;
DROP POLICY IF EXISTS "posts_anon_read_published"   ON public.posts;
DROP POLICY IF EXISTS "posts_auth_read_all"         ON public.posts;
DROP POLICY IF EXISTS "posts_editor_insert"         ON public.posts;
DROP POLICY IF EXISTS "posts_editor_update"         ON public.posts;
DROP POLICY IF EXISTS "posts_editor_delete"         ON public.posts;

-- PUBLIC BY DESIGN: published posts are the public blog. Anonymous readers and
-- signed-in readers see exactly the same thing.
CREATE POLICY "posts_public_read_published"
  ON public.posts FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

-- DIVERGENCE FROM SOURCE (deliberate, tighter): the source let ANY
-- authenticated user read every draft. With bot/support roles in the system
-- that is too loose, so unpublished posts now require blog:view. OR-ed with the
-- policy above, so a signed-in user without blog:view still sees published posts.
CREATE POLICY "posts_capability_read_all"
  ON public.posts FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'blog', 'view'));

-- Note on `publish`: 'publish' is a capability the application layer enforces
-- when it flips status to 'published'. RLS cannot express "may edit this row
-- but not that column", so blog:edit is what gates the UPDATE here. Surfaces
-- that change `status` must additionally check blog:publish (and route through
-- perform_action() — see 004).
CREATE POLICY "posts_capability_insert"
  ON public.posts FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_capability(auth.uid(), 'blog', 'create'));

CREATE POLICY "posts_capability_update"
  ON public.posts FOR UPDATE
  TO authenticated
  USING      (public.user_has_capability(auth.uid(), 'blog', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'blog', 'edit'));

CREATE POLICY "posts_capability_delete"
  ON public.posts FOR DELETE
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'blog', 'delete'));


-- ── 8.4 job_openings (resource: careers) ─────────────────────────────────────
DROP POLICY IF EXISTS "job_openings_public_read_open"  ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_capability_read_all" ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_capability_insert"   ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_capability_update"   ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_capability_delete"   ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_anon_read_open"    ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_auth_read_all"     ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_editor_insert"     ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_editor_update"     ON public.job_openings;
DROP POLICY IF EXISTS "job_openings_editor_delete"     ON public.job_openings;

-- PUBLIC BY DESIGN: the careers page.
CREATE POLICY "job_openings_public_read_open"
  ON public.job_openings FOR SELECT
  TO anon, authenticated
  USING (status = 'open');

-- Draft/closed roles require careers:view (admin-only by default).
CREATE POLICY "job_openings_capability_read_all"
  ON public.job_openings FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'careers', 'view'));

CREATE POLICY "job_openings_capability_insert"
  ON public.job_openings FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_capability(auth.uid(), 'careers', 'create'));

CREATE POLICY "job_openings_capability_update"
  ON public.job_openings FOR UPDATE
  TO authenticated
  USING      (public.user_has_capability(auth.uid(), 'careers', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'careers', 'edit'));

CREATE POLICY "job_openings_capability_delete"
  ON public.job_openings FOR DELETE
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'careers', 'delete'));


-- ── 8.5 contact_inquiries (resource: crm) ────────────────────────────────────
DROP POLICY IF EXISTS "contact_inquiries_public_insert"   ON public.contact_inquiries;
DROP POLICY IF EXISTS "contact_inquiries_capability_read" ON public.contact_inquiries;
DROP POLICY IF EXISTS "contact_inquiries_capability_update" ON public.contact_inquiries;
DROP POLICY IF EXISTS "contact_inquiries_capability_delete" ON public.contact_inquiries;
DROP POLICY IF EXISTS "contact_inquiries_admin_read"      ON public.contact_inquiries;
DROP POLICY IF EXISTS "contact_inquiries_anon_insert"     ON public.contact_inquiries;

-- PUBLIC BY DESIGN: the contact form. Preserved verbatim from the source.
-- Insert-only for the public: there is deliberately no anon SELECT policy, so a
-- submitter cannot read back anyone's submission, including their own.
CREATE POLICY "contact_inquiries_public_insert"
  ON public.contact_inquiries FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- ⚠ These rows are customer PII. Per the default matrix crm:view is granted to
-- viewer/editor/support_*/admin — i.e. every role except none. If that is too
-- broad for a given deployment, revoke crm:view from viewer and editor in
-- role_capabilities; no schema change is needed.
CREATE POLICY "contact_inquiries_capability_read"
  ON public.contact_inquiries FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'crm', 'view'));

-- Triage (mark handled, correct a typo'd email) needs crm:edit — admin and
-- support_human only.
CREATE POLICY "contact_inquiries_capability_update"
  ON public.contact_inquiries FOR UPDATE
  TO authenticated
  USING      (public.user_has_capability(auth.uid(), 'crm', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'crm', 'edit'));

-- Deleting a lead (GDPR erasure) is crm:delete — admin only.
CREATE POLICY "contact_inquiries_capability_delete"
  ON public.contact_inquiries FOR DELETE
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'crm', 'delete'));


-- ── 8.6 whatsapp_conversations (resource: crm) ───────────────────────────────
DROP POLICY IF EXISTS "whatsapp_conversations_capability_read"   ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "whatsapp_conversations_capability_insert" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "whatsapp_conversations_capability_update" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "whatsapp_conversations_admin_read"        ON public.whatsapp_conversations;

CREATE POLICY "whatsapp_conversations_capability_read"
  ON public.whatsapp_conversations FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'crm', 'view'));

CREATE POLICY "whatsapp_conversations_capability_insert"
  ON public.whatsapp_conversations FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_capability(auth.uid(), 'crm', 'create'));

-- The human-in-the-loop takeover path: flipping mode auto -> human. crm:edit,
-- so admin and support_human, never the bots.
CREATE POLICY "whatsapp_conversations_capability_update"
  ON public.whatsapp_conversations FOR UPDATE
  TO authenticated
  USING      (public.user_has_capability(auth.uid(), 'crm', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'crm', 'edit'));

-- NO DELETE POLICY, ON PURPOSE — not even for admin. whatsapp_messages cascades
-- off this table's primary key, so a single DELETE here would erase an entire
-- customer's message audit trail. Erasure requests must go through a deliberate
-- server-side (service role) procedure that records what it destroyed, not
-- through a stray DELETE from an admin console.


-- ── 8.7 whatsapp_messages (resource: crm) ────────────────────────────────────
DROP POLICY IF EXISTS "whatsapp_messages_capability_read"   ON public.whatsapp_messages;
DROP POLICY IF EXISTS "whatsapp_messages_capability_insert" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "whatsapp_messages_admin_read"        ON public.whatsapp_messages;

CREATE POLICY "whatsapp_messages_capability_read"
  ON public.whatsapp_messages FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'crm', 'view'));

-- Appending a message (a human agent replying, or a bot's logged turn) is
-- crm:create — which is exactly why support_bot_text/voice have it.
CREATE POLICY "whatsapp_messages_capability_insert"
  ON public.whatsapp_messages FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_capability(auth.uid(), 'crm', 'create'));

-- NO UPDATE OR DELETE POLICY, ON PURPOSE — not even for admin. This table is
-- the evidence trail for automated messaging compliance. Append-only is the
-- entire point; if any role could rewrite it, it would prove nothing.


-- ── 8.8 user_entitlements (untagged; read-gated on users:view) ───────────────
DROP POLICY IF EXISTS "user_entitlements_self_read"       ON public.user_entitlements;
DROP POLICY IF EXISTS "user_entitlements_capability_read" ON public.user_entitlements;
DROP POLICY IF EXISTS "user_entitlements_admin_read"      ON public.user_entitlements;

-- Buyers read their own grants. This is what the paywall check will use.
CREATE POLICY "user_entitlements_self_read"
  ON public.user_entitlements FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- TODO(phase-3-payments): re-point this at a `payments` resource key once the
-- payments/entitlements tables exist and this table can be tagged. users:view
-- is admin-only by default, which is the correct posture in the meantime, but
-- it conflates "manages people" with "manages purchases".
CREATE POLICY "user_entitlements_capability_read"
  ON public.user_entitlements FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'users', 'view'));

-- No write policies: entitlements are granted by the payment webhook (service
-- role). A user being able to INSERT their own entitlement row is the entire
-- paywall bypass, so this must never gain an authenticated INSERT policy.


-- ── 8.9 mcp_audit_log (untagged; read-gated on users:view) ───────────────────
DROP POLICY IF EXISTS "mcp_audit_log_capability_read" ON public.mcp_audit_log;
DROP POLICY IF EXISTS "mcp_audit_log_admin_read"      ON public.mcp_audit_log;

CREATE POLICY "mcp_audit_log_capability_read"
  ON public.mcp_audit_log FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'users', 'view'));

-- No write policies: written by the MCP route using the service role. An audit
-- log an actor can write to directly is not an audit log.


-- ── 8.10 user_roles (resource: users) ────────────────────────────────────────
DROP POLICY IF EXISTS "user_roles_self_read"         ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_capability_read"   ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_capability_update" ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_read"        ON public.user_roles;
DROP POLICY IF EXISTS "user_roles_admin_update"      ON public.user_roles;

-- Everyone can see their own role (the admin shell needs it to render).
CREATE POLICY "user_roles_self_read"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "user_roles_capability_read"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'users', 'view'));

-- Promote/demote. users:edit is admin-only by default, so this cannot be used
-- for self-promotion: you must already hold users:edit to change any role,
-- including your own.
CREATE POLICY "user_roles_capability_update"
  ON public.user_roles FOR UPDATE
  TO authenticated
  USING      (public.user_has_capability(auth.uid(), 'users', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'users', 'edit'));

-- NO INSERT POLICY, ON PURPOSE. Creating the very first role row is the
-- bootstrap moment, and a user with no role row has no capabilities — so an
-- authenticated INSERT path could only ever be exploited, never legitimately
-- used. Role assignment happens server-side through the auth callback and the
-- admin API using the service role.
--
-- NO DELETE POLICY, ON PURPOSE. Deleting your own row is a no-op (you already
-- lose access); deleting someone else's is a denial-of-service on the last
-- remaining admin. Deprovisioning is a server-side operation.


-- ── 8.11 role_capabilities (untagged; the matrix itself) ─────────────────────
DROP POLICY IF EXISTS "role_capabilities_self_read"       ON public.role_capabilities;
DROP POLICY IF EXISTS "role_capabilities_capability_read" ON public.role_capabilities;

-- A signed-in user may read the grants for their OWN role — the admin UI needs
-- this to decide which buttons to render. It discloses nothing they could not
-- already determine by probing user_has_capability().
CREATE POLICY "role_capabilities_self_read"
  ON public.role_capabilities FOR SELECT
  TO authenticated
  USING (role = public.get_user_role());

-- Holders of users:view (admin by default) may read the whole matrix.
CREATE POLICY "role_capabilities_capability_read"
  ON public.role_capabilities FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'users', 'view'));

-- NO WRITE POLICIES, ON PURPOSE. The capability matrix is the thing that
-- decides who may do what; letting it be edited through the same session-level
-- path it governs is a privilege-escalation primitive (grant yourself
-- users:edit, then grant yourself everything). Matrix changes are a
-- service-role/migration operation.


-- ── 8.12 admin_users (resource: users) ───────────────────────────────────────
-- RLS enabled in 002 with no policies: service-role-only. Restated here so this
-- file's coverage list is complete. Deliberately no read policy — the allow-list
-- of admin email addresses is not something an authenticated viewer needs.


-- ═════════════════════════════════════════════════════════════════════════════
-- 9. Table grants — the coarse layer underneath RLS
-- ═════════════════════════════════════════════════════════════════════════════
-- RLS decides WHICH ROWS. Grants decide WHETHER THE COMMAND IS REACHABLE AT ALL.
-- Without a grant, an RLS policy is inert — the client is refused before any
-- policy is evaluated. They are two independent gates and both are used here.
--
-- Supabase's stock setup does `GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
-- authenticated` and leans entirely on RLS. This file does NOT do that. Each
-- role is granted only the commands some policy above actually contemplates, so
-- a future policy mistake on, say, whatsapp_messages UPDATE still cannot be
-- exploited: authenticated has no UPDATE grant on that table to begin with.
--
-- Revoke first so re-running this migration cannot leave a stale wider grant
-- behind after a policy is tightened. Listed table-by-table rather than
-- `ON ALL TABLES` so that re-running 003 does not silently strip grants that a
-- LATER migration issued (004 grants on action_audit_log).
REVOKE ALL ON
  public.site_content, public.content_history, public.posts,
  public.contact_inquiries, public.mcp_audit_log, public.user_entitlements,
  public.job_openings, public.whatsapp_conversations, public.whatsapp_messages,
  public.admin_users, public.user_roles, public.role_capabilities
FROM anon, authenticated;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Re-assert the resources view grant: it is a relation too, and keeping it here
-- makes this section the single place to audit who can read what.
GRANT SELECT ON public.resources TO authenticated;

-- anon: the public website. Read the marketing site and the published/open
-- listings; drop a message in the contact form. Nothing else, ever.
GRANT SELECT                         ON public.site_content      TO anon;
GRANT SELECT                         ON public.posts             TO anon;
GRANT SELECT                         ON public.job_openings      TO anon;
GRANT INSERT                         ON public.contact_inquiries TO anon;

-- authenticated: everything the capability policies can possibly allow.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_content           TO authenticated;
GRANT SELECT                         ON public.content_history        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.posts                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_openings           TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_inquiries      TO authenticated;
GRANT SELECT, INSERT, UPDATE         ON public.whatsapp_conversations TO authenticated;
GRANT SELECT, INSERT                 ON public.whatsapp_messages      TO authenticated;
GRANT SELECT                         ON public.user_entitlements      TO authenticated;
GRANT SELECT                         ON public.mcp_audit_log          TO authenticated;
GRANT SELECT, UPDATE                 ON public.user_roles             TO authenticated;
GRANT SELECT                         ON public.role_capabilities      TO authenticated;
-- public.admin_users: no grant to anon or authenticated. Service role only.

-- service_role bypasses RLS (it is the trusted server identity, equivalent to
-- Supabase's service_role key) but still needs table privileges.
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
