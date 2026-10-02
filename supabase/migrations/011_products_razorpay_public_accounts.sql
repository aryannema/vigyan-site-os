-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011: admin-manageable products, Razorpay config, unified CRM view,
-- and a fully separate public site-account tier.
--
-- Four independent features, bundled into one migration because they share no
-- code path with each other but were all requested together:
--
--   1. public.products         -- paid items, currently hardcoded in
--                                  src/config/site.ts, made admin CRUD-able.
--   2. public.payment_gateway_config -- Razorpay key ID / key secret / webhook
--                                  secret, admin-settable (same deny-by-default,
--                                  owner-connection-only pattern as
--                                  ai_provider_config in 009 -- zero RLS
--                                  policies, unreachable via any session role).
--   3. public.crm_inquiries_view -- a single read surface unioning
--                                  contact_inquiries (the general contact/
--                                  blueprint-request form) with a lightweight
--                                  whatsapp_conversations summary, so the CRM
--                                  admin page can show "everything that came
--                                  in", not only WhatsApp.
--   4. public.site_accounts    -- registered PUBLIC visitors (checkout/order
--                                  history use case). Deliberately NOT part of
--                                  user_roles/role_capabilities/admin_users --
--                                  a site_accounts row grants NOTHING in the
--                                  admin console. Two completely separate
--                                  systems: admin access is allow-list-gated
--                                  (unchanged, see 002_admin_auth.sql +
--                                  auth/callback/route.ts), public accounts are
--                                  open self-registration with zero admin
--                                  capability by construction -- there is no
--                                  role name in this table for "viewer" to
--                                  accidentally collide with the admin RBAC
--                                  "viewer" role, which DOES have CRM
--                                  visibility. Confirmed with the operator
--                                  2026-08-12: "no other user than admin
--                                  configured should be able to open admin
--                                  interface" / "so CRM etc should not be
--                                  visible" -- this table's existence changes
--                                  nothing about who can reach /admin.
-- ─────────────────────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════════════════════
-- 1. products -- paid items (blueprints, templates), admin CRUD
-- ═════════════════════════════════════════════════════════════════════════════
COMMENT ON TABLE public.role_capabilities IS 'role_capabilities -- unchanged, referenced here only for context.';

CREATE TABLE IF NOT EXISTS public.products (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE,
  title         text        NOT NULL,
  description   text,
  category      text,
  price_paise   integer     NOT NULL DEFAULT 0,   -- 0 is a real, valid price (free/lead-magnet item)
  currency      text        NOT NULL DEFAULT 'INR',
  status        text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  external_link text,                              -- e.g. a GitHub repo for a free template
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.products IS 'resource:products';
COMMENT ON COLUMN public.products.price_paise IS 'Price in the smallest currency unit (paise for INR), matching Razorpay''s own convention. 0 is valid -- a free item, not "unset".';

CREATE INDEX IF NOT EXISTS products_status_idx ON public.products (status);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "products_public_read_active" ON public.products;
CREATE POLICY "products_public_read_active"
  ON public.products FOR SELECT
  TO anon, authenticated
  USING (status = 'active');

DROP POLICY IF EXISTS "products_capability_write" ON public.products;
CREATE POLICY "products_capability_write"
  ON public.products FOR ALL
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'products', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'products', 'edit'));

DROP POLICY IF EXISTS "products_capability_read_all" ON public.products;
CREATE POLICY "products_capability_read_all"
  ON public.products FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'products', 'view'));

GRANT SELECT ON public.products TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;

INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES
  ('admin', 'products', 'view', true),
  ('admin', 'products', 'create', true),
  ('admin', 'products', 'edit', true),
  ('admin', 'products', 'delete', true),
  ('editor', 'products', 'view', true),
  ('editor', 'products', 'edit', true)
ON CONFLICT (role, resource_key, action) DO UPDATE SET allowed = true;


-- ═════════════════════════════════════════════════════════════════════════════
-- 2. payment_gateway_config -- Razorpay keys, same deny-by-default pattern as
--    009's ai_provider_config: RLS enabled, ZERO policies, reachable only via
--    the owner-role server connection (DATABASE_URL / admin/lib/db.ts mutate()).
-- ═════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.payment_gateway_config (
  gateway         text        PRIMARY KEY DEFAULT 'razorpay',
  key_id          text,
  key_secret      text,
  webhook_secret  text,
  is_live         boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES auth.users(id)
);
COMMENT ON TABLE public.payment_gateway_config IS 'resource:payments -- deliberately zero RLS policies, same unreachable-via-session-role pattern as ai_provider_config (009). Only the owner-role server connection (DATABASE_URL) can read/write it.';

ALTER TABLE public.payment_gateway_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_gateway_config FROM PUBLIC, anon, authenticated;

INSERT INTO public.payment_gateway_config (gateway) VALUES ('razorpay')
ON CONFLICT (gateway) DO NOTHING;


-- ═════════════════════════════════════════════════════════════════════════════
-- 3. crm_inquiries_view -- everything that came in through a form, unified
-- ═════════════════════════════════════════════════════════════════════════════
-- contact_inquiries already covers BOTH the general contact form and the
-- blueprint-request form (BlueprintRequestForm posts to the same /api/contact
-- endpoint as of tonight's rewiring) -- so this is not a second data source,
-- it is contact_inquiries_view (005/010) exposed under a name that matches
-- what the admin CRM page will actually query, plus a `source` label so the
-- UI can distinguish "general enquiry" from "blueprint request" at a glance.
DROP VIEW IF EXISTS public.crm_inquiries_view;
CREATE VIEW public.crm_inquiries_view AS
SELECT
  id,
  full_name,
  first_name,
  last_name,
  email,
  phone_number,
  whatsapp_opt_in,
  message,
  CASE WHEN message ILIKE 'Blueprint request:%' THEN 'blueprint_request' ELSE 'contact_form' END AS source,
  created_at,
  pii_masked
FROM public.contact_inquiries_view;

COMMENT ON VIEW public.crm_inquiries_view IS 'Unified CRM read surface for the admin /admin/crm page -- wraps contact_inquiries_view (already capability-gated + PII-masked by 005/010) and labels rows by source (contact_form vs blueprint_request) so both are visible in one place, not just WhatsApp.';

REVOKE ALL ON public.crm_inquiries_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.crm_inquiries_view TO authenticated, service_role;


-- ═════════════════════════════════════════════════════════════════════════════
-- 4. site_accounts -- public self-registration, ZERO admin capability
-- ═════════════════════════════════════════════════════════════════════════════
-- Deliberately NOT in user_roles / role_capabilities / admin_users. A row here
-- grants nothing beyond "this person can see their own order history and
-- profile" -- middleware.ts and every /admin/* route continue to gate purely
-- on admin_users allow-list membership (002_admin_auth.sql), which this table
-- does not touch and cannot influence. See migration header for why this is
-- a hard separation, not a shared role name.
CREATE TABLE IF NOT EXISTS public.site_accounts (
  user_id     uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  full_name   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.site_accounts IS 'Public self-registered site visitors (checkout/order-history use case). Grants ZERO admin console access -- deliberately outside user_roles/role_capabilities/admin_users. Never treat a site_accounts row as equivalent to the admin RBAC "viewer" role, which has real CRM visibility.';

ALTER TABLE public.site_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "site_accounts_self_read" ON public.site_accounts;
CREATE POLICY "site_accounts_self_read"
  ON public.site_accounts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "site_accounts_self_insert" ON public.site_accounts;
CREATE POLICY "site_accounts_self_insert"
  ON public.site_accounts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "site_accounts_self_update" ON public.site_accounts;
CREATE POLICY "site_accounts_self_update"
  ON public.site_accounts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.site_accounts TO authenticated;

-- Let a site_accounts row also read its own entitlements/orders (user_entitlements
-- already has a self-read policy per 001's header note -- confirm it exists,
-- re-declare defensively so this migration is self-contained).
DROP POLICY IF EXISTS "user_entitlements_self_read" ON public.user_entitlements;
CREATE POLICY "user_entitlements_self_read"
  ON public.user_entitlements FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.user_entitlements TO authenticated;
