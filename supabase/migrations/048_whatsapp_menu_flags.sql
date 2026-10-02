-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 048: per-row toggles for the WhatsApp menu.
--
-- The menu is assembled from live data, so it must also respect what the
-- operator has actually turned on -- a row offering something that is disabled
-- or unbuilt is a dead end the customer discovers by tapping it.
--
-- Product rows need no flag: they already come from products WHERE status =
-- 'active', so publishing IS the toggle.
--
-- STOP IS DELIBERATELY NOT FLAGGABLE. An opt-out that an operator can switch
-- off is not an opt-out. Meta expects it, DPDP expects it, and ignoring it is
-- what earns blocks and reports -- which is what actually collapses a number's
-- quality rating. It is hardcoded as always-present in accountRows().
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.feature_flags (key, enabled) VALUES
  ('wa_menu_ask',    true),   -- free-form questions answered from the KB
  ('wa_menu_verify', true),   -- number verification
  ('wa_menu_human',  true),   -- escalate to a person
  ('wa_menu_delete', true)    -- start a data-deletion request
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.feature_flags IS
  'Site-wide runtime toggles, editable at /admin/settings with no deploy. wa_menu_* control which rows appear in the WhatsApp interactive menu. There is deliberately no wa_menu_stop: the opt-out row is always present, because an opt-out an operator can disable is not an opt-out.';
