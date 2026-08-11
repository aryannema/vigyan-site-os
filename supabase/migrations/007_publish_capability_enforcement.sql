-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 007: `publish` becomes a real capability, and content writes become
--                audited by construction
--
-- ── The finding this closes ──────────────────────────────────────────────────
--
-- 003 §8.3 acknowledged that RLS cannot gate a single column and delegated
-- `publish` to "surfaces that change status". But 003 §9 also grants
-- `authenticated` a direct UPDATE on public.posts and public.job_openings, and
-- the UPDATE policies ask only for blog:edit / careers:edit. So anything that
-- reaches the tables without going through an application surface —
-- supabase-js, PostgREST, psql, a future admin screen that forgets — could flip
-- `status` to 'published' / 'open' with blog:publish / careers:publish
-- explicitly REVOKED, and leave no audit row behind.
--
-- `publish` is one of the five checkboxes in the admin capability grid. An
-- operator who unticks it has been told they revoked something. Until this
-- migration, they had not.
--
-- ── Why a BEFORE trigger and not WITH CHECK ──────────────────────────────────
--
-- The rule is "may this row ENTER the publicly-visible state?", which needs
-- both the old and the new row. A policy cannot express that:
--
--   * USING sees only the OLD row, so it cannot know what status is being
--     written;
--   * WITH CHECK sees only the NEW row, so it cannot tell a draft being
--     published (must require `publish`) from an already-published post having
--     its title corrected (must NOT require `publish` — that is a plain edit);
--   * and a WITH CHECK failure RAISES. Everywhere else in this schema a write
--     the caller may not perform is silently not performed — 005 §4 calls
--     silent emptiness "the correct RLS shape". A raise here would also be a
--     disclosure difference between "no publish grant" and "no such row".
--
-- A BEFORE trigger returning NULL reproduces the RLS shape exactly: the row is
-- not written, RETURNING yields nothing, no error is raised, and — unlike a
-- policy — it applies to every writer of the table rather than to one command
-- of one role. The capability decision itself is still
-- public.user_has_capability(), the same primitive every policy uses.
--
-- The capability-CHECKED, capability-DENIED-with-a-message path is unchanged:
-- an application surface still calls perform_action(actor,'blog','publish',...),
-- which raises insufficient_privilege with a readable reason. This trigger is
-- the floor underneath it, not a replacement for it.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. The publish gate
-- ═════════════════════════════════════════════════════════════════════════════
-- Parameterised through TG_ARGV so one function serves both tables and any
-- future one that has a `status` column with a publicly-readable value:
--   TG_ARGV[0] = resource key ('blog', 'careers')
--   TG_ARGV[1] = the status value that makes a row publicly readable
--                ('published' for posts, 'open' for job_openings) — the same
--                value 003's anon SELECT policy compares against.
--
-- SECURITY DEFINER so the check runs with the owner's rights (it reads
-- user_has_capability(), itself SECURITY DEFINER) regardless of who is writing.
--
-- auth.uid() IS NULL means a trusted server-side context: the service role, or
-- a direct backend connection. 004 §2 already makes that distinction for
-- perform_action() and this follows it, so the admin UI and the MCP route keep
-- working exactly as before — their capability check happens in
-- perform_action(), with an identity, and produces an audit row.
CREATE OR REPLACE FUNCTION public.publish_capability_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_resource      text := TG_ARGV[0];
  v_public_status text := TG_ARGV[1];
  v_uid           uuid := auth.uid();
BEGIN
  -- Trusted server-side context (service role / direct backend connection).
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Not a write into the publicly-visible state: ordinary edit territory.
  IF NEW.status IS DISTINCT FROM v_public_status THEN
    RETURN NEW;
  END IF;

  -- Already public before this statement: editing a live row is `edit`, not
  -- `publish`. Without this, a publisher would have to hold `publish` forever
  -- just to fix a typo in a post that is already out.
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM v_public_status THEN
    RETURN NEW;
  END IF;

  IF public.user_has_capability(v_uid, v_resource, 'publish') THEN
    RETURN NEW;
  END IF;

  -- Refused. Silently, exactly as RLS refuses a row the caller may not write.
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.publish_capability_guard() IS
  'BEFORE INSERT/UPDATE trigger: refuses (silently, RLS-style) any write that moves a row INTO the publicly-visible status named in TG_ARGV[1] unless the caller holds <TG_ARGV[0]>:publish. A NULL auth.uid() is a trusted server context and passes.';

DROP TRIGGER IF EXISTS posts_publish_capability_guard        ON public.posts;
DROP TRIGGER IF EXISTS job_openings_publish_capability_guard ON public.job_openings;

CREATE TRIGGER posts_publish_capability_guard
  BEFORE INSERT OR UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.publish_capability_guard('blog', 'published');

CREATE TRIGGER job_openings_publish_capability_guard
  BEFORE INSERT OR UPDATE ON public.job_openings
  FOR EACH ROW EXECUTE FUNCTION public.publish_capability_guard('careers', 'open');


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. Audit by construction for the two publishable tables
-- ═════════════════════════════════════════════════════════════════════════════
-- 004's header states the ambition ("authorization and audit are the SAME
-- operation") and its own ⚠ADOPTION STATUS admits the mechanism only covers
-- write paths that remember to call perform_action(). A direct UPDATE through
-- the grants in 003 §9 is exactly such a forgotten path, and the finding above
-- is precisely that: the status flip left "no publish grant and no audit row".
--
-- The publish grant is now enforced above. This trigger closes the other half:
-- EVERY change to posts / job_openings lands in action_audit_log, whoever made
-- it and however it reached the table.
--
--   actor  the acting identity when there is one (auth.uid()), otherwise
--          'system:<database role>' — the honest answer for a service-role or
--          psql write, and visibly not a user id.
--   action derived from the transition, so 'publish' shows up as 'publish'
--          rather than as another 'edit'.
--
-- ⚠ A write that DOES route through perform_action() (the admin UI, the MCP
--   route) now produces TWO rows: the actor's claim, with the payload they
--   described, and this one, produced by the database from the row itself.
--   That is deliberate — the second is the one that cannot be shaped by the
--   caller — and they are told apart by `actor`: perform_action() records a
--   resolved user id plus the raw claim in `actor_claim` (008), while these
--   rows carry no claim at all.
CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_resource      text := TG_ARGV[0];
  v_public_status text := TG_ARGV[1];
  v_uid           uuid := auth.uid();
  v_action        text;
  v_before        jsonb;
  v_after         jsonb;
  v_target        text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_before := NULL;
    v_after  := to_jsonb(NEW);
    v_target := (to_jsonb(NEW) ->> 'id');
    v_action := CASE WHEN NEW.status IS NOT DISTINCT FROM v_public_status
                     THEN 'publish' ELSE 'create' END;
  ELSIF TG_OP = 'UPDATE' THEN
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
    v_target := (to_jsonb(NEW) ->> 'id');
    v_action := CASE WHEN NEW.status IS DISTINCT FROM OLD.status
                      AND (NEW.status IS NOT DISTINCT FROM v_public_status
                           OR OLD.status IS NOT DISTINCT FROM v_public_status)
                     THEN 'publish' ELSE 'edit' END;
  ELSE
    v_before := to_jsonb(OLD);
    v_after  := NULL;
    v_target := (to_jsonb(OLD) ->> 'id');
    v_action := 'delete';
  END IF;

  INSERT INTO public.action_audit_log
    (actor, resource_key, action, target_id, before_data, after_data)
  VALUES
    (COALESCE(v_uid::text, 'system:' || current_user),
     v_resource, v_action, v_target, v_before, v_after);

  RETURN NULL;  -- AFTER trigger: the return value is ignored
END;
$$;

COMMENT ON FUNCTION public.audit_row_change() IS
  'AFTER INSERT/UPDATE/DELETE trigger: writes an action_audit_log row describing the change, derived from the row itself rather than from anything the caller asserted. TG_ARGV[0] is the resource key, TG_ARGV[1] the publicly-visible status value used to classify a change as `publish`.';

DROP TRIGGER IF EXISTS posts_audit_row_change        ON public.posts;
DROP TRIGGER IF EXISTS job_openings_audit_row_change ON public.job_openings;

CREATE TRIGGER posts_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('blog', 'published');

CREATE TRIGGER job_openings_audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.job_openings
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('careers', 'open');

-- Extending either mechanism to another table is two lines: tag the resource
-- key and the publicly-visible status value in a CREATE TRIGGER. site_content
-- and contact_inquiries are deliberately NOT covered here — neither has a
-- publish concept, and widening the audit trigger to the CRM is a separate
-- decision about volume and PII in before/after payloads.

-- No new grants: both functions are SECURITY DEFINER and owned by the database
-- owner, so they insert into action_audit_log (which grants INSERT to nobody —
-- 004 §1) without any role gaining the ability to write it directly.
