-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 034: one owner for every table in public.
--
-- public was split between two owners -- 17 tables owned by `postgres`, 12 by
-- `supabase_admin` -- for no reason anyone chose. It is an accident of which
-- role happened to run which migration, and it has a real cost: migration 033
-- failed with "must be owner of table orders" when applied as `postgres`,
-- because ALTER TABLE requires ownership. Which role can run a migration
-- therefore depended on which tables that migration happened to touch.
--
-- Normalised to `postgres`, which is Supabase's convention for the public
-- schema: `supabase_admin` owns the internal schemas (auth, storage, realtime),
-- and application tables belong to `postgres`. It is also already the majority
-- here, so this moves the fewest tables.
--
-- Ownership does not affect RLS, policies, grants or any application behaviour.
-- It decides who may run DDL. Run this as `supabase_admin`, which can reassign
-- what it owns.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
  moved integer := 0;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tableowner <> 'postgres'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO postgres', r.tablename);
    moved := moved + 1;
  END LOOP;

  -- Sequences and views follow their tables, or DDL on them fails the same way.
  FOR r IN
    SELECT sequencename AS name FROM pg_sequences
     WHERE schemaname = 'public' AND sequenceowner <> 'postgres'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO postgres', r.name);
  END LOOP;

  FOR r IN
    SELECT viewname AS name FROM pg_views
     WHERE schemaname = 'public' AND viewowner <> 'postgres'
  LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO postgres', r.name);
  END LOOP;

  RAISE NOTICE 'Reassigned % table(s) to postgres', moved;
END;
$$;

-- Proves the invariant rather than trusting the loop above.
DO $$
DECLARE stragglers text;
BEGIN
  SELECT string_agg(tablename || ' (' || tableowner || ')', ', ')
    INTO stragglers
    FROM pg_tables WHERE schemaname = 'public' AND tableowner <> 'postgres';
  IF stragglers IS NOT NULL THEN
    RAISE EXCEPTION 'public tables still not owned by postgres: %', stragglers;
  END IF;
END;
$$;
