-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 017: UTM-tagged short links (link_shortener + link_clicks).
--
-- Admin-manageable short links (/go/<slug> -> real URL + utm_* params, applied
-- at redirect time, not baked into the stored URL) so a typo'd campaign value
-- can be fixed after a link is already shared, without a new slug. Also
-- callable from the MCP route (see src/app/api/mcp/route.ts's create_short_link
-- tool, added alongside this migration) so n8n/Postiz automation can create
-- links without going through the admin UI.
--
-- link_clicks is a real append-only log, not a counter column on
-- link_shortener, so "clicks over time" / "clicks by referrer" stays queryable
-- later without a schema change -- matches this repo's own action_audit_log
-- philosophy (004_audit_by_construction.sql): record events, derive aggregates
-- by query, don't collapse history into a mutable counter. It carries no RLS
-- policies and no resource: comment, same deny-by-default pattern as
-- payment_gateway_config (011) / ai_provider_config (009) -- reachable only via
-- the service-role redirect route (src/app/go/[slug]/route.ts, supabaseAdmin),
-- never via any session role, admin or otherwise.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.link_shortener (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text        NOT NULL UNIQUE,
  target_url    text        NOT NULL,
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_term      text,
  utm_content   text,
  platform      text,                              -- freeform, pre-filled from a picker in the UI, not FK'd
  -- Reporting classification only -- NOT a payment/ad-spend feature. No Meta
  -- Ads / Google Ads / CPC integration exists or is wired here. Distinguishes
  -- what the target actually is: 'paid' points at something behind the
  -- existing Razorpay paywall (a public.products row), 'lead_magnet' is a
  -- free resource meant to capture a lead, 'free' (default) is everything
  -- else (a blog post, a general page).
  offer_type    text        NOT NULL DEFAULT 'free' CHECK (offer_type IN ('paid','lead_magnet','free')),
  status        text        NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived')),
  created_by    uuid        REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.link_shortener IS 'resource:links';
COMMENT ON COLUMN public.link_shortener.offer_type IS 'Reporting label only (paid/lead_magnet/free) -- no ad-spend or payment flow behind it. ''paid'' means the target is something sold via the existing products/Razorpay flow, not that this table processes payment.';

CREATE INDEX IF NOT EXISTS link_shortener_status_idx ON public.link_shortener (status);
CREATE INDEX IF NOT EXISTS link_shortener_campaign_idx ON public.link_shortener (utm_campaign);

ALTER TABLE public.link_shortener ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "link_shortener_capability_write" ON public.link_shortener;
CREATE POLICY "link_shortener_capability_write"
  ON public.link_shortener FOR ALL
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'links', 'edit'))
  WITH CHECK (public.user_has_capability(auth.uid(), 'links', 'edit'));

DROP POLICY IF EXISTS "link_shortener_capability_read" ON public.link_shortener;
CREATE POLICY "link_shortener_capability_read"
  ON public.link_shortener FOR SELECT
  TO authenticated
  USING (public.user_has_capability(auth.uid(), 'links', 'view'));

-- Deliberately NO anon grant/policy, unlike products: link definitions are
-- never read by an anon/authenticated Supabase client on the public site.
-- The /go/[slug] redirect route reads via supabaseAdmin (service-role,
-- bypasses RLS entirely) -- see src/app/go/[slug]/route.ts.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.link_shortener TO authenticated;

INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES
  ('admin',  'links', 'view',   true),
  ('admin',  'links', 'create', true),
  ('admin',  'links', 'edit',   true),
  ('admin',  'links', 'delete', true),
  ('editor', 'links', 'view',   true),
  ('editor', 'links', 'create', true),
  ('editor', 'links', 'edit',   true)
ON CONFLICT (role, resource_key, action) DO UPDATE SET allowed = true;


CREATE TABLE IF NOT EXISTS public.link_clicks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     uuid        NOT NULL REFERENCES public.link_shortener(id) ON DELETE CASCADE,
  clicked_at  timestamptz NOT NULL DEFAULT now(),
  referrer    text,
  user_agent  text
);
-- No resource: comment -- never queried as an independent capability, only
-- aggregated as part of the "links" resource in the admin UI/Campaigns card.
CREATE INDEX IF NOT EXISTS link_clicks_link_id_idx ON public.link_clicks (link_id, clicked_at DESC);

ALTER TABLE public.link_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.link_clicks FROM PUBLIC, anon, authenticated;
