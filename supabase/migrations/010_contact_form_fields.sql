-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 010: first/last name split + WhatsApp opt-in on contact_inquiries
--
-- The public lead form is being rebuilt to collect First Name / Last Name
-- separately (rather than one free-text "full name" field) and an explicit
-- WhatsApp opt-in checkbox, since replying to an inquiry over WhatsApp is a
-- real outbound message via the Business API and needs real consent, not an
-- assumption from "they typed a phone number".
--
-- first_name/last_name are ADDED alongside the existing full_name column
-- rather than replacing it -- full_name stays the single source the CRM UI
-- and 005's masking view already read, computed server-side in the contact
-- API route as `${first_name} ${last_name}`.trim(). Nothing downstream that
-- reads full_name needs to change.
--
-- whatsapp_opt_in follows 005's existing judgment call on full_name: it is
-- not a contact channel by itself (it is a consent flag, not an identifier),
-- so it is not masked -- added to contact_inquiries_view unmasked, same as
-- full_name and message.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.contact_inquiries
  ADD COLUMN IF NOT EXISTS first_name      text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_name       text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.contact_inquiries.first_name IS
  'Collected separately from the form; full_name (kept for backward compat with existing CRM UI/views) is derived server-side as first_name || '' '' || last_name.';
COMMENT ON COLUMN public.contact_inquiries.whatsapp_opt_in IS
  'Explicit consent to be contacted via WhatsApp Business API, checked at submission. Not PII, not masked by 005''s view -- a consent flag, not an identifier.';

-- Re-create 005's view to expose the two new unmasked columns. Same shape,
-- same WHERE/security_barrier, just two more SELECT items.
DROP VIEW IF EXISTS public.contact_inquiries_view;
CREATE VIEW public.contact_inquiries_view
WITH (security_barrier = true)
AS
SELECT
  ci.id,
  ci.full_name,
  ci.first_name,
  ci.last_name,
  CASE WHEN public.crm_pii_unmasked(auth.uid())
       THEN ci.email
       ELSE public.mask_email(ci.email)
  END                                                        AS email,
  CASE WHEN public.crm_pii_unmasked(auth.uid())
       THEN ci.phone_number
       ELSE public.mask_phone(ci.phone_number)
  END                                                        AS phone_number,
  ci.whatsapp_opt_in,
  ci.message,
  ci.created_at,
  NOT public.crm_pii_unmasked(auth.uid())                    AS pii_masked
FROM public.contact_inquiries ci
WHERE public.user_has_capability(auth.uid(), 'crm', 'view');

COMMENT ON VIEW public.contact_inquiries_view IS
  'Capability-conditional read path for contact inquiries. Rows require crm:view; email and phone_number are partially masked unless the caller holds crm:edit or crm:create. pii_masked reports which of the two the caller got. first_name/last_name/whatsapp_opt_in added 2026-08-11, unmasked (see migration header).';

REVOKE ALL ON public.contact_inquiries_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.contact_inquiries_view TO authenticated, service_role;
