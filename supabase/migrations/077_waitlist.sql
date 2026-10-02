-- ═════════════════════════════════════════════════════════════════════════════
-- 077_waitlist.sql — waitlist signups for pre-launch products
--
-- WHY A SEPARATE TABLE rather than a row in contact_inquiries:
--
--   A contact enquiry is a conversation to have; a waitlist signup is a list to
--   mail when something ships. They have different lifecycles, different
--   retention arguments, and — the practical one — different queries. Mixing
--   them means every "who is waiting for Voice" question carries a
--   message-is-not-null filter and hopes nobody forgets it.
--
--   Consent differs too. Someone asking a question has not agreed to be
--   emailed about a launch; someone joining a waitlist has, and only for the
--   product they joined. That distinction has to survive in the schema, or it
--   will not survive in practice.
--
-- The privacy model is copied deliberately from contact_inquiries
-- (005_contact_pii_masking): reads go through a capability-gated view with
-- security_barrier, email is masked unless the caller holds crm:edit, and the
-- view reports pii_masked so the UI never re-derives the rule.
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1. Table ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.waitlist_signups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which list. Constrained rather than free text: a typo here silently
  -- creates a third product nobody is watching, and the launch email misses
  -- everyone in it.
  product     text        NOT NULL
              CHECK (product IN ('voice', 'sample_product')),

  email       text        NOT NULL,
  full_name   text,

  -- Optional. "What would you use it for" earns its place: it is the only
  -- field that tells you whether the list is the audience you think it is.
  note        text,

  -- Where the signup came from, for attribution. Not a tracking id — just the
  -- page or campaign, so "did the blog post work" is answerable.
  source      text,

  created_at  timestamptz NOT NULL DEFAULT now(),

  -- One signup per person per product. A second submission is almost always a
  -- double-click or an unsure returning visitor, not a second intent — and a
  -- duplicate row means someone gets the launch email twice.
  CONSTRAINT waitlist_signups_email_product_key UNIQUE (email, product)
);

CREATE INDEX IF NOT EXISTS waitlist_signups_product_created_idx
  ON public.waitlist_signups (product, created_at DESC);

COMMENT ON TABLE public.waitlist_signups IS
  'Pre-launch interest per product. Separate from contact_inquiries because the consent is different: joining a list is agreement to be emailed about THAT product, which asking a question is not.';


-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- The base table is reachable only by the owner connection and by the view
-- below. anon and authenticated get nothing directly; the API route inserts
-- through the service role, and every read goes through the view.
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS waitlist_signups_no_direct_read ON public.waitlist_signups;
CREATE POLICY waitlist_signups_no_direct_read
  ON public.waitlist_signups
  FOR SELECT
  TO authenticated
  -- Deliberately false. Reading happens through waitlist_signups_view, which
  -- applies the capability check AND the masking. One read path means one place
  -- where the rule can be got wrong.
  USING (false);


-- ── 3. The read path ─────────────────────────────────────────────────────────
-- Owned by the database owner and NOT security_invoker, so the policy above
-- does not apply to the view's own scan — the view re-imposes the row rule
-- itself, exactly as contact_inquiries_view does.
--
-- security_barrier = true for the same reason it is set there: without it the
-- planner may push a caller-supplied qual below the capability check, letting
-- someone with no crm:view learn which rows exist through side effects.
DROP VIEW IF EXISTS public.waitlist_signups_view;
CREATE VIEW public.waitlist_signups_view
WITH (security_barrier = true)
AS
SELECT
  w.id,
  w.product,
  CASE WHEN public.crm_pii_unmasked(auth.uid())
       THEN w.email
       ELSE public.mask_email(w.email)
  END                                              AS email,
  w.full_name,
  w.note,
  w.source,
  w.created_at,
  NOT public.crm_pii_unmasked(auth.uid())          AS pii_masked
FROM public.waitlist_signups w
WHERE public.user_has_capability(auth.uid(), 'crm', 'view');

COMMENT ON VIEW public.waitlist_signups_view IS
  'Capability-gated read path for waitlist signups. Rows require crm:view; email is masked unless the caller holds crm:edit or crm:create. pii_masked reports which the caller got.';

-- anon is deliberately absent: this view bypasses the base table's RLS.
REVOKE ALL ON public.waitlist_signups_view FROM PUBLIC;
GRANT SELECT ON public.waitlist_signups_view TO authenticated, service_role;


-- ── 4. Capabilities ──────────────────────────────────────────────────────────
-- Reuses the `crm` resource rather than inventing a `waitlist` one. A waitlist
-- signup IS customer data, and anyone trusted with the CRM is trusted with it —
-- a separate resource would mean every existing role needs a new grant before
-- the feature works, which is how a permission model acquires a hole ("just
-- give them admin for now").
--
-- Required reference data, so this is an UPSERT that converges. Re-running must
-- reach the intended state, not skip it. (Contrast migration 076, which is a
-- default and must NOT overwrite operator edits.)
INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
SELECT g.role, 'crm', a.action, true
FROM (VALUES
  ('admin',        ARRAY['view','create','edit','delete']),
  ('editor',       ARRAY['view']),
  ('support_human',ARRAY['view'])
) AS g(role, actions)
CROSS JOIN LATERAL unnest(g.actions) AS a(action)
ON CONFLICT (role, resource_key, action)
DO UPDATE SET allowed = EXCLUDED.allowed;


-- ── 5. Self-verification ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  n int;
BEGIN
  IF to_regclass('public.waitlist_signups') IS NULL THEN
    RAISE EXCEPTION '077: waitlist_signups was not created';
  END IF;

  IF to_regclass('public.waitlist_signups_view') IS NULL THEN
    RAISE EXCEPTION '077: waitlist_signups_view was not created';
  END IF;

  -- The masking must actually be wired, not merely present in the file.
  SELECT count(*) INTO n
    FROM pg_views
   WHERE schemaname = 'public'
     AND viewname   = 'waitlist_signups_view'
     AND definition ILIKE '%mask_email%'
     AND definition ILIKE '%user_has_capability%';

  IF n <> 1 THEN
    RAISE EXCEPTION '077: waitlist_signups_view exists but does not apply mask_email and user_has_capability';
  END IF;

  -- And the product constraint, because a typo'd product is a silently lost list.
  BEGIN
    INSERT INTO public.waitlist_signups (product, email)
    VALUES ('not_a_product', 'verify@example.com');
    RAISE EXCEPTION '077: product CHECK constraint is not enforcing';
  EXCEPTION
    WHEN check_violation THEN NULL;  -- expected
  END;
END
$verify$;
