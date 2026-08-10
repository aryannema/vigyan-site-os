-- ─────────────────────────────────────────────────────────────────────────────
-- Local dev seed data — NOT applied to production. Safe to re-run.
--
-- Formalizes the ad-hoc identities the Phase 2 MCP agent created directly in
-- the database while verifying capability checks end-to-end (see BLOCKERS.md
-- #6). Until GoTrue is wired up (a later phase), this is the only way to have
-- a capability-holding identity to develop and test against locally.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-4111-8111-111111111111', 'mcp-service@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'crm-viewer@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('11111111-1111-4111-8111-111111111111', 'admin'),
  ('22222222-2222-4222-8222-222222222222', 'viewer')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO public.contact_inquiries (full_name, email, phone_number, message) VALUES
  ('Sample Person', 'sample.person@example.test', '+919876500001', 'Sample inquiry for local dev/testing.'),
  ('Second Person', 'sp@example.test', NULL, 'Second sample inquiry, no phone number, to test NULL masking.')
ON CONFLICT DO NOTHING;
