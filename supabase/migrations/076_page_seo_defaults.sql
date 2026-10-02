-- ═════════════════════════════════════════════════════════════════════════════
-- 076_page_seo_defaults.sql
--
-- Seeds the `page_seo` section so the admin CMS has something to edit rather
-- than an empty box, and so the shape is documented by example.
--
-- TIER: defaults (not schema, not required reference data).
--
--   These rows are what a fresh deployment WANTS, not what the code NEEDS. Every
--   page passes a hardcoded fallback to pageMetadata(), so the site renders
--   correct titles with this table empty — which is exactly the state it has
--   been in until now.
--
--   Therefore ON CONFLICT DO NOTHING, never DO UPDATE. Re-running this migration
--   must not overwrite copy an operator has tuned against Search Console data.
--   That is the whole distinction between a default and required reference data:
--   one converges on the repository's opinion, the other must not.
--
-- No DDL. site_content already exists (001_base_schema.sql) and needs no change:
-- content_data is jsonb, so a new section is a row, not a column.
-- ═════════════════════════════════════════════════════════════════════════════

INSERT INTO public.site_content (section_id, content_data)
VALUES (
  'page_seo',
  jsonb_build_object(
    '/privacy', jsonb_build_object(
      'title', 'Privacy Policy',
      'description',
        'How YourSite Solutions Private Limited collects, uses, and protects your data.'
    ),
    '/terms', jsonb_build_object(
      'title', 'Terms of Service',
      'description',
        'The terms governing use of YourSite Solutions Private Limited''s website and services.'
    ),
    '/data-deletion', jsonb_build_object(
      'title', 'Data Deletion',
      'description',
        'How to request deletion of your data held by YourSite Solutions Private Limited.'
    ),
    -- noindex while the page is a stub. A "coming soon" page that ranks is worse
    -- than one that does not: it spends crawl budget and teaches a visitor the
    -- site has nothing for them. Flipping this to false when the bot ships is an
    -- edit in the admin UI, not a deploy — which is the point of the table.
    '/voice', jsonb_build_object(
      'title', 'Voice Bot',
      'description',
        'Talk to the YourSite voice assistant. Coming soon.',
      'noindex', true
    )
  )
)
ON CONFLICT (section_id) DO NOTHING;


-- ── Self-verification ────────────────────────────────────────────────────────
-- Fails the migration loudly rather than leaving a half-applied state that only
-- surfaces later as a page with the wrong title.
DO $verify$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.site_content
   WHERE section_id = 'page_seo';

  IF n <> 1 THEN
    RAISE EXCEPTION 'page_seo section missing after 076 (found % rows)', n;
  END IF;

  IF NOT (
    SELECT content_data ? '/privacy'
       AND content_data ? '/terms'
       AND content_data ? '/data-deletion'
       AND content_data ? '/voice'
      FROM public.site_content
     WHERE section_id = 'page_seo'
  ) THEN
    -- Reached when the row already existed with different keys, which is fine:
    -- DO NOTHING preserved an operator's edits. Report it rather than fail.
    RAISE NOTICE 'page_seo exists but does not carry all four default keys — '
                 'an operator has edited it. Leaving as-is (DO NOTHING).';
  END IF;
END
$verify$;
