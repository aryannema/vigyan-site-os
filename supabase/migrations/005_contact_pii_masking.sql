-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 005: Capability-conditional PII masking for contact_inquiries
--
-- ── The gap this closes ──────────────────────────────────────────────────────
--
-- 003 gates reads of contact_inquiries on a single capability, crm:view, which
-- the default matrix grants to viewer, editor, support_human, both support bots
-- and admin. Every one of those roles therefore saw the same thing: the lead's
-- real email address and real phone number.
--
-- That conflates two different needs:
--   * a role that ACTS on an inquiry (replies to it, calls the customer back,
--     opens a WhatsApp thread) genuinely requires the raw identifiers;
--   * a role that only WATCHES the CRM (a dashboard viewer, a content editor who
--     is explicitly "can see the CRM but not touch it" per 003 §6) requires the
--     lead to be countable and legible, not contactable.
--
-- After this migration the second group sees `j***@example.com` and
-- `+91 XXXXXXXX10` instead.
--
-- ── The rule ─────────────────────────────────────────────────────────────────
--
--   crm:edit OR crm:create  ->  real email / phone_number
--   crm:view only           ->  masked email / phone_number
--   no crm:view             ->  no rows at all (unchanged from 003)
--
-- The rule is stated in CAPABILITIES, not in role names, because that is what
-- the rest of this schema does. Against the DEFAULT matrix seeded in 003 it
-- resolves to:
--
--   unmasked : admin, support_human, support_bot_text, support_bot_voice
--   masked   : editor, viewer
--
-- ⚠ REVIEW NOTE — `editor` lands in the masked group. That is a consequence of
--   the default matrix, where editor holds crm:view and nothing else; 003's own
--   comment describes editor as a role that "can see the CRM but not touch it",
--   so masking it is consistent with that intent rather than a surprise. If a
--   deployment wants editors to see raw contact details, the fix is a matrix
--   change, not a schema change:
--       INSERT INTO role_capabilities (role, resource_key, action)
--       VALUES ('editor','crm','edit') ON CONFLICT DO NOTHING;
--   ...which also, deliberately, gives them the ability to act on the inquiry.
--   "May read the customer's phone number" and "may contact the customer" are
--   the same privilege in practice, and this migration refuses to separate them.
--
-- ── Why a view, and not something else ───────────────────────────────────────
--
-- RLS filters ROWS. The requirement here is per-column and per-caller, so the
-- three obvious mechanisms were considered:
--
--   1. Column privileges (GRANT SELECT (col) ...). Cannot work. Every
--      application user shares ONE Postgres role, `authenticated`; the
--      application identity lives in auth.uid(). A column grant is attached to
--      the Postgres role, so it can only say "no signed-in user may read email"
--      or "every signed-in user may". It cannot express a per-user rule.
--
--   2. Masking in the application layer. Rejected: PostgREST/supabase-js expose
--      the table directly, so any holder of an authenticated JWT could request
--      the raw columns and skip the app's formatter entirely. A masking rule
--      that is only true in one client is not an access control.
--
--   3. A view that the database owner owns, and which therefore reads the base
--      table without RLS applying, plus a tightened SELECT policy on the base
--      table itself. This is what is implemented below.
--
-- (3) is the only one of the three that cannot be walked around, and it keeps
-- the decision expressed as user_has_capability() exactly like every other rule
-- in 003. The base table's SELECT policy is narrowed to the roles that are
-- allowed the raw values, so "query the table instead of the view" is not a
-- bypass — it returns zero rows for anyone the mask applies to.
--
-- Note the view is deliberately NOT `security_invoker = true` (the opposite
-- choice from the `resources` view in 003, which confers nothing and needs to
-- confer nothing). This view MUST confer something: it is the only read path
-- left for crm:view-only roles, so it has to reach a table their own RLS
-- context can no longer see. It re-imposes the row rule itself, in its WHERE
-- clause, and `security_barrier = true` stops a cheap user-supplied qual from
-- being planned underneath that WHERE.
--
-- ── ⚠ ORDERING ──────────────────────────────────────────────────────────────
-- 005 REPLACES a policy created in 003. Re-running 003 on its own restores the
-- broad `contact_inquiries_capability_read` policy and silently re-opens the raw
-- table to viewer/editor. If you re-run 003, re-run 005 after it.
--
-- Safe to re-run on its own: CREATE OR REPLACE / DROP ... IF EXISTS throughout.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. Masking primitives
-- ═════════════════════════════════════════════════════════════════════════════
-- Both are IMMUTABLE, STRICT, and touch no table. They are pure string
-- functions, testable in isolation with a single SELECT, and hold no policy
-- opinion of their own — WHETHER to mask is decided in §2/§3, HOW to mask is
-- decided here. STRICT is what gives "null in -> null out" by construction
-- rather than by a code path that could be edited away.
--
-- Neither function is reversible and neither is a security boundary on its own:
-- they are only ever applied to a value the caller was not allowed to see, so
-- the only property that matters is that the output cannot be widened back into
-- the input.


-- ── 1.1 mask_email ───────────────────────────────────────────────────────────
-- ALGORITHM (exact):
--   1. NULL              -> NULL                         (STRICT)
--   2. blank/whitespace  -> returned unchanged            (nothing to mask)
--   3. no '@' at all     -> first char + '***', or '***' if shorter than 3
--                           chars. Malformed input is masked, never echoed.
--   4. otherwise split on the LAST '@':
--        local part  >= 3 chars -> first char + '***'
--        local part  <= 2 chars -> '***'          (revealing 1 of 2 characters
--                                                  is not a mask)
--        domain                 -> kept verbatim
--   The number of asterisks is FIXED at 3 and does not track the length of the
--   local part, so the output does not leak how long the address was.
--
--   Examples:
--     'john.doe@example.com' -> 'j***@example.com'
--     'JD@example.com'       -> '***@example.com'
--     'a+tag@sub.domain.in'  -> 'a***@sub.domain.in'
--     '@example.com'         -> '***@example.com'
--     'not-an-email'         -> 'n***'
--
-- ⚠ REVIEW NOTE — the DOMAIN is kept in full, which is the conventional form
--   and is what makes a masked lead list still useful ("this one is from a
--   corporate domain"). It is also the weakest point of this mask: a full domain
--   plus an unmasked full_name (see §5) can be enough to guess a corporate
--   address of the form first.last@company.com. If that matters for a
--   deployment, mask the domain's first label too — it is a one-line change
--   here and needs no other edit.
CREATE OR REPLACE FUNCTION public.mask_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  v_in     text := btrim(p_email);
  v_at     integer;
  v_local  text;
  v_domain text;
BEGIN
  IF v_in = '' THEN
    RETURN p_email;
  END IF;

  -- No '@': not an address. Mask it as if it were a bare local part.
  IF strpos(v_in, '@') = 0 THEN
    RETURN CASE WHEN length(v_in) >= 3 THEN left(v_in, 1) || '***' ELSE '***' END;
  END IF;

  -- Split on the LAST '@' — a quoted local part may legally contain one.
  v_at     := length(v_in) - strpos(reverse(v_in), '@') + 1;
  v_local  := left(v_in, v_at - 1);
  v_domain := substr(v_in, v_at + 1);

  RETURN CASE WHEN length(v_local) >= 3 THEN left(v_local, 1) || '***' ELSE '***' END
         || '@' || v_domain;
END;
$$;

COMMENT ON FUNCTION public.mask_email(text) IS
  'Pure, irreversible partial mask for an email address: first character of the local part (only if it is 3+ characters) plus three asterisks, domain kept verbatim. NULL in, NULL out.';


-- ── 1.2 mask_phone ───────────────────────────────────────────────────────────
-- ALGORITHM (exact):
--   1. NULL             -> NULL                          (STRICT)
--   2. blank/whitespace -> returned unchanged
--   3. no digits at all -> the literal 'XXXX'. Junk is never echoed back,
--                          because a "phone number" field can hold anything a
--                          web form was given.
--   4. otherwise, working on the trimmed original string:
--        * every NON-digit character ('+', space, '-', '(', ')') is preserved
--          in place, so the number keeps its recognisable shape;
--        * the leading COUNTRY CODE is revealed, when one is claimed. A country
--          code is only recognised if the string starts with '+', and then:
--            - the 1-3 digits after '+' that are terminated by a non-digit
--              ('+91 98765 43210' -> '91'), or failing that
--            - when the total digit count is 11-13, the leading (count - 10)
--              digits, i.e. assuming a 10-digit national number
--              ('+919876543210' -> '91').
--          A string with no leading '+' claims no country code and gets none
--          revealed. At most 3 digits are ever revealed at the head.
--        * the LAST 2 digits are revealed;
--        * every other digit becomes 'X';
--        * FLOOR: at least 3 digits must remain masked. If revealing the tail
--          would break that, the tail is not revealed; if the head reveal alone
--          would break it, the head is not revealed either. Short strings are
--          therefore masked completely rather than mostly.
--
--   Examples:
--     '+91 98765 43210' -> '+91 XXXXX XXX10'
--     '+919876543210'   -> '+91XXXXXXXX10'
--     '9876543210'      -> 'XXXXXXXX10'
--     '+1 (555) 010-1234' -> '+1 (XXX) XXX-XX34'
--     '12345'           -> 'XXX45'
--     '1234'            -> 'XXXX'
--     'call me'         -> 'XXXX'
--
-- ⚠ REVIEW NOTE — two digits, not four. The brief's illustration
--   ('+91 98XXXXXX10') also revealed the leading two digits of the national
--   number; this implementation does not, because those two digits identify the
--   mobile operator/series and buy a reader nothing. Four trailing digits
--   (the Aadhaar / card-number convention) would be defensible too. Widening is
--   one constant: change v_tail's initial value below from 2 to 4.
CREATE OR REPLACE FUNCTION public.mask_phone(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
DECLARE
  v_in     text    := btrim(p_phone);
  v_digits text;
  v_n      integer;          -- total digits in the input
  v_head   integer := 0;     -- digits revealed at the front (country code)
  v_tail   integer := 2;     -- digits revealed at the end
  v_seen   integer := 0;     -- digits emitted so far, while rebuilding
  v_out    text    := '';
  v_match  text[];
  v_ch     text;
  i        integer;
BEGIN
  IF v_in = '' THEN
    RETURN p_phone;
  END IF;

  v_digits := regexp_replace(v_in, '[^0-9]', '', 'g');
  v_n      := length(v_digits);

  IF v_n = 0 THEN
    RETURN 'XXXX';
  END IF;

  -- Country code, only if one is explicitly claimed with a leading '+'.
  IF left(v_in, 1) = '+' THEN
    v_match := regexp_match(v_in, '^\+([0-9]{1,3})[^0-9]');
    IF v_match IS NOT NULL THEN
      v_head := length(v_match[1]);
    ELSIF v_n BETWEEN 11 AND 13 THEN
      v_head := v_n - 10;                  -- assume a 10-digit national number
    END IF;
  END IF;

  -- Floor: never leave fewer than 3 digits masked.
  IF v_n - v_head - v_tail < 3 THEN
    v_tail := 0;
    IF v_n - v_head < 3 THEN
      v_head := 0;
    END IF;
  END IF;

  -- Rebuild the original string digit by digit, preserving every separator.
  FOR i IN 1 .. length(v_in) LOOP
    v_ch := substr(v_in, i, 1);
    IF v_ch >= '0' AND v_ch <= '9' THEN
      v_seen := v_seen + 1;
      IF v_seen <= v_head OR v_seen > v_n - v_tail THEN
        v_out := v_out || v_ch;
      ELSE
        v_out := v_out || 'X';
      END IF;
    ELSE
      v_out := v_out || v_ch;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.mask_phone(text) IS
  'Pure, irreversible partial mask for a phone number: keeps an explicitly claimed country code and the last 2 digits, replaces every other digit with X, preserves separators. NULL in, NULL out.';

-- These leak nothing and hold no privilege, but the file-wide posture in 003 is
-- "revoke the implicit PUBLIC grant, then re-grant narrowly", and being able to
-- call them directly is useful for testing the mask independently of the view.
REVOKE ALL ON FUNCTION public.mask_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mask_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mask_email(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mask_phone(text) TO authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. crm_pii_unmasked() — the rule, in one place
-- ═════════════════════════════════════════════════════════════════════════════
-- Deliberately a named function rather than an inline OR repeated in the view's
-- target list, its WHERE clause and the base table's policy. Those four uses
-- must agree; a single definition is the only way to guarantee they do, and it
-- gives the rule a name that shows up in \df and in EXPLAIN output.
--
-- Composed of user_has_capability() calls only, so it inherits that function's
-- contract: explicit grants only, never NULL, deny by default. SECURITY INVOKER
-- (the default) is correct — it needs no privilege of its own, because
-- user_has_capability() is already SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.crm_pii_unmasked(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_catalog
AS $$
  SELECT public.user_has_capability(p_user_id, 'crm', 'edit')
      OR public.user_has_capability(p_user_id, 'crm', 'create');
$$;

COMMENT ON FUNCTION public.crm_pii_unmasked(uuid) IS
  'True when the user may see raw customer identifiers in the CRM: holds crm:edit or crm:create, i.e. can actually act on an inquiry. crm:view alone is false. Never returns NULL.';

REVOKE ALL ON FUNCTION public.crm_pii_unmasked(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_pii_unmasked(uuid) TO authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. contact_inquiries_view — the read path for contact inquiries
-- ═════════════════════════════════════════════════════════════════════════════
-- EVERY authenticated read of contact inquiries should go through this view,
-- including reads by roles that would see identical output from the base table.
-- One read path means one place where the rule can be got wrong.
--
-- Owned by the database owner and NOT security_invoker, so RLS on
-- contact_inquiries does not apply to the view's own scan — which is the entire
-- point, since §4 removes crm:view-only roles from that table's SELECT policy.
-- The view re-imposes the row rule itself:
--
--     WHERE user_has_capability(auth.uid(), 'crm', 'view')
--
-- ...so it is exactly as restrictive on ROWS as 003 was, and strictly more
-- restrictive on COLUMNS.
--
-- security_barrier = true: without it the planner may push a user-supplied qual
-- (including a cheap user-defined function) below the WHERE above, letting a
-- caller with no crm:view observe rows through side effects. The masked columns
-- themselves cannot leak this way — an outer qual referencing `email` is
-- rewritten onto the CASE expression, so it sees the mask, not the address —
-- but the row gate needs the barrier.
--
-- `pii_masked` is returned so the UI never has to re-derive the rule (and
-- cannot re-derive it wrongly) to decide whether to render a "masked" badge or
-- to disable a mailto: link.
DROP VIEW IF EXISTS public.contact_inquiries_view;
CREATE VIEW public.contact_inquiries_view
WITH (security_barrier = true)
AS
SELECT
  ci.id,
  ci.full_name,                                  -- see §5: intentionally raw
  CASE WHEN public.crm_pii_unmasked(auth.uid())
       THEN ci.email
       ELSE public.mask_email(ci.email)
  END                                                        AS email,
  CASE WHEN public.crm_pii_unmasked(auth.uid())
       THEN ci.phone_number
       ELSE public.mask_phone(ci.phone_number)
  END                                                        AS phone_number,
  ci.message,                                    -- see §5: intentionally raw
  ci.created_at,
  NOT public.crm_pii_unmasked(auth.uid())                    AS pii_masked
FROM public.contact_inquiries ci
WHERE public.user_has_capability(auth.uid(), 'crm', 'view');

COMMENT ON VIEW public.contact_inquiries_view IS
  'Capability-conditional read path for contact inquiries. Rows require crm:view; email and phone_number are partially masked unless the caller holds crm:edit or crm:create. pii_masked reports which of the two the caller got.';

-- anon is deliberately absent. This view bypasses the base table's RLS, so
-- granting it to anon would publish the entire lead list to the internet — the
-- contact form is insert-only for the public and stays that way.
REVOKE ALL ON public.contact_inquiries_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_inquiries_view TO authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. Close the bypass: narrow the base table's SELECT policy
-- ═════════════════════════════════════════════════════════════════════════════
-- Without this the masking would be decorative — a viewer would simply query
-- contact_inquiries instead of contact_inquiries_view and read the raw columns.
--
-- The replacement policy admits exactly the roles that are entitled to raw
-- identifiers anyway (crm:edit / crm:create), plus crm:delete so that an
-- erasure path is never blocked from seeing what it is erasing. Under the
-- default matrix crm:delete is admin-only and admin already holds crm:edit, so
-- it changes nothing today; it is there so a future matrix that grants delete
-- without edit does not produce a role that can destroy rows it cannot read.
--
-- Effect on a crm:view-only session: zero rows from the base table, no error.
-- Silent emptiness rather than a permission error is the correct RLS shape, and
-- the application is expected to read the view.
--
-- The table-level SELECT GRANT from 003 §9 stays as it is: the grant makes the
-- command reachable, the policy decides who it returns anything to. Revoking
-- the grant instead would also break the roles that must keep raw access.
DROP POLICY IF EXISTS "contact_inquiries_capability_read"     ON public.contact_inquiries;
DROP POLICY IF EXISTS "contact_inquiries_raw_read_actionable" ON public.contact_inquiries;

CREATE POLICY "contact_inquiries_raw_read_actionable"
  ON public.contact_inquiries FOR SELECT
  TO authenticated
  USING (
        public.crm_pii_unmasked(auth.uid())
     OR public.user_has_capability(auth.uid(), 'crm', 'delete')
  );

-- The INSERT (public contact form), UPDATE (crm:edit) and DELETE (crm:delete)
-- policies from 003 §8.5 are untouched and still apply.
--
-- ⚠ Note for anyone auditing UPDATE ... RETURNING / DELETE ... RETURNING: both
--   need the SELECT policy to pass as well as their own. Every role that holds
--   crm:edit or crm:delete passes the policy above, so no write path is broken
--   by this change.


-- ═════════════════════════════════════════════════════════════════════════════
-- 5. Judgment calls left open, on purpose
-- ═════════════════════════════════════════════════════════════════════════════
--
-- full_name IS NOT MASKED. The argument for leaving it raw: it is not a
-- contact channel — knowing a name does not let you reach the person — it is
-- already how the inquiry is identified in every list UI, and masking it would
-- make a masked lead list unusable without protecting the identifiers that
-- actually matter. The argument against, which is real: a full name IS
-- personal data under the DPDP Act and the GDPR, it is directly identifying,
-- and combined with an unmasked domain (see §1.1) it can reconstruct a
-- corporate email address. If this deployment's viewer role is genuinely
-- untrusted rather than merely unprivileged, mask it: the change is one more
-- CASE in the view, and a mask_name() alongside the two above.
--
-- message IS NOT MASKED. It is the inquiry itself — the thing the viewer is
-- there to read — and it has no fixed structure to mask. Worth knowing: a
-- customer who types "call me on 98765 43210" defeats the phone mask entirely,
-- and no column-level rule can prevent that. Scrubbing identifiers out of free
-- text is a detection problem, not an access-control problem, and it is not
-- solved here.
--
-- ⚠ SAME CLASS OF GAP, NOT ADDRESSED HERE — whatsapp_conversations and
--   whatsapp_messages are also tagged `crm` and are also readable on crm:view
--   alone (003 §8.6, §8.7). whatsapp_conversations.phone_number is a raw
--   customer phone number, and message bodies are raw conversation content, so
--   a viewer still reads unmasked customer identifiers there. Fixing that is
--   the same pattern as this file (a masked view + a narrowed SELECT policy)
--   but it is a separate decision — a conversation is arguably not viewable at
--   all without the ability to participate in it — and it was explicitly out of
--   scope for this migration. It should not be left indefinitely.

-- ─────────────────────────────────────────────────────────────────────────────
-- Follow-up 2026-08-10: editor granted crm:edit (full unmasked CRM access),
-- per explicit user decision -- overrides 003's default matrix where editor
-- only had crm:view (masked). This is a plain role_capabilities row, fully
-- re-editable later via the Phase 3 admin capability-checkbox UI -- nothing
-- hardcoded or special about this grant.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES ('editor', 'crm', 'edit', true)
ON CONFLICT (role, resource_key, action) DO UPDATE SET allowed = true;
