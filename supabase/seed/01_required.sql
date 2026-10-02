-- ─────────────────────────────────────────────────────────────────────────────
-- seed/01_required.sql — rows the system cannot function without (DML only).
-- Convention: docs/PUBLIC_TEMPLATE.md. migrations/ is DDL only; rows live here.
-- Idempotent — safe to re-run. Apply AFTER the migrations.
--
-- Started with the capabilities for landing_pages and nav (migration 078).
-- The older role_capabilities rows are still inside migrations 003/005/011/017/
-- 020/042/077 and are to be consolidated into this file (see PUBLIC_TEMPLATE.md).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES
  ('admin',  'landing_pages', 'view',   true),
  ('admin',  'landing_pages', 'create', true),
  ('admin',  'landing_pages', 'edit',   true),
  ('admin',  'landing_pages', 'delete', true),
  ('editor', 'landing_pages', 'view',   true),
  ('editor', 'landing_pages', 'create', true),
  ('editor', 'landing_pages', 'edit',   true)
ON CONFLICT (role, resource_key, action) DO UPDATE SET allowed = true;

INSERT INTO public.role_capabilities (role, resource_key, action, allowed)
VALUES
  ('admin',  'nav', 'view',   true),
  ('admin',  'nav', 'create', true),
  ('admin',  'nav', 'edit',   true),
  ('admin',  'nav', 'delete', true),
  ('editor', 'nav', 'view',   true)
ON CONFLICT (role, resource_key, action) DO UPDATE SET allowed = true;
