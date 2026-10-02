-- ═════════════════════════════════════════════════════════════════════════════
-- 013_blog_comments_whatsapp_optin.sql
-- ═════════════════════════════════════════════════════════════════════════════
-- Two independent additions, bundled because both extend the public-visitor
-- surface introduced in 011 (site_accounts):
--
--   1. Blog comments. Signed-in visitors only (site_accounts, same auth.users
--      identity as everywhere else) may post a comment; every comment starts
--      'pending' and is invisible to the public until an admin/editor with
--      blog:edit approves it. Decided explicitly with the operator
--      2026-08-15: signed-in-only (spam resistance via a real Google-verified
--      identity, no CAPTCHA needed yet) + admin-approval-first (standard for a
--      company blog, prevents anything going live unmoderated).
--
--   2. WhatsApp number + opt-in on site_accounts, collected post-sign-in (not
--      during the Google OAuth flow itself — Google does not hand back a phone
--      number, so this is necessarily a separate step after landing on
--      /account).
--
-- Both tables/columns are tagged resource:blog and reuse the EXISTING
-- role_capabilities matrix (editor/admin already have blog:edit) rather than
-- inventing a new resource + seeding new capability rows for one feature.
-- ═════════════════════════════════════════════════════════════════════════════

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. post_comments
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.post_comments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid        NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name text        NOT NULL,
  body        text        NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  moderated_at timestamptz,
  moderated_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS post_comments_post_id_idx ON public.post_comments(post_id) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS post_comments_pending_idx ON public.post_comments(created_at) WHERE status = 'pending';

COMMENT ON TABLE public.post_comments IS 'resource:blog — public blog comments, signed-in-only submission, admin-approved before becoming visible. Moderation (approve/reject/delete) reuses the existing blog:edit / blog:delete capabilities rather than a new resource.';

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

-- Public read: only approved comments, same "public by design" shape as
-- posts_public_read_published in 003.
DROP POLICY IF EXISTS "post_comments_public_read_approved" ON public.post_comments;
CREATE POLICY "post_comments_public_read_approved"
  ON public.post_comments FOR SELECT
  TO anon, authenticated
  USING (status = 'approved');

-- A signed-in commenter can always see their own comment regardless of
-- moderation status, so "your comment is awaiting approval" can be shown back
-- to them.
DROP POLICY IF EXISTS "post_comments_self_read" ON public.post_comments;
CREATE POLICY "post_comments_self_read"
  ON public.post_comments FOR SELECT
  TO authenticated
  USING (author_id = auth.uid());

-- Anyone with blog:view (editor/admin) can see the full moderation queue,
-- including pending/rejected.
DROP POLICY IF EXISTS "post_comments_capability_read_all" ON public.post_comments;
CREATE POLICY "post_comments_capability_read_all"
  ON public.post_comments FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'blog', 'view'));

-- Self-insert only: author_id must be the caller's own uid, enforced by RLS
-- (not by the application trusting a client-supplied value), mirroring
-- site_accounts_self_insert (011 §4). Always lands as 'pending' — status is
-- NOT settable at insert time by the check below.
DROP POLICY IF EXISTS "post_comments_self_insert" ON public.post_comments;
CREATE POLICY "post_comments_self_insert"
  ON public.post_comments FOR INSERT
  TO authenticated
  WITH CHECK (author_id = auth.uid() AND status = 'pending');

-- Moderation (approve/reject) and self-delete-own-comment. Admin writes to
-- this table from the admin UI go through mutate()/perform_action() on the
-- owner connection (bypasses RLS, authorized by the capability check inside
-- perform_action() itself — see admin/lib/db.ts header) — these RLS policies
-- are belt-and-suspenders for any future direct-client write path, matching
-- the posts table's own pattern in 003.
DROP POLICY IF EXISTS "post_comments_capability_update" ON public.post_comments;
CREATE POLICY "post_comments_capability_update"
  ON public.post_comments FOR UPDATE
  TO authenticated
  USING      (public.user_has_capability(auth.uid(), 'blog', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'blog', 'edit'));

DROP POLICY IF EXISTS "post_comments_capability_delete" ON public.post_comments;
CREATE POLICY "post_comments_capability_delete"
  ON public.post_comments FOR DELETE
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'blog', 'delete'));

DROP POLICY IF EXISTS "post_comments_self_delete" ON public.post_comments;
CREATE POLICY "post_comments_self_delete"
  ON public.post_comments FOR DELETE
  TO authenticated
  USING (author_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.post_comments TO authenticated;
GRANT SELECT ON public.post_comments TO anon;
-- UPDATE intentionally NOT granted to `authenticated` at large — only rows
-- passing post_comments_capability_update (blog:edit) may ever be updated,
-- and Postgres still requires the table-level GRANT for that policy to have
-- any effect.
GRANT UPDATE ON public.post_comments TO authenticated;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. site_accounts — add WhatsApp number + opt-in, collected post-sign-in
-- ═════════════════════════════════════════════════════════════════════════════
-- Nullable by design: Google OAuth never supplies a phone number, so every
-- existing and new site_accounts row starts with these unset. The app prompts
-- for them once, after the user already has a session (see
-- src/components/site/WhatsAppOptInPrompt.tsx) — this is a profile-completion
-- step, not part of the OAuth redirect itself.
ALTER TABLE public.site_accounts
  ADD COLUMN IF NOT EXISTS whatsapp_number    text,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_collected_at timestamptz;

-- Existing site_accounts_self_update policy (011 §4) already covers writes to
-- these new columns (USING/WITH CHECK is user_id = auth.uid(), column-agnostic)
-- — no new RLS policy needed.
