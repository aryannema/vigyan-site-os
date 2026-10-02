-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 045: sample_product_live feature flag.
--
-- Sample Product is not built yet, but the site already sells it: a top-level
-- nav item, two footer links, the hero's secondary CTA, the homepage product
-- card, and a /sample-product page with a pricing anchor. Every one of those is
-- a promise the product cannot currently keep.
--
-- Seeded FALSE deliberately. isFeatureEnabled() also fails closed, so a DB
-- read failure hides it rather than advertising an unbuilt product -- the same
-- reasoning as whatsapp_live (migration 020).
--
-- Flip it at /admin/settings when the product actually ships. No deploy.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.feature_flags (key, enabled)
VALUES ('sample_product_live', false)
ON CONFLICT (key) DO NOTHING;
