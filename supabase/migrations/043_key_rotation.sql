-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 043: key versioning, rotation and its audit.
--
-- WHY NOT pgcrypto, since it was asked:
--
--   pgcrypto does the encryption inside Postgres, which sounds like an
--   improvement but moves the key in the wrong direction. The key has to be
--   passed as a QUERY PARAMETER on every encrypt and decrypt, so it travels
--   app -> network -> database on every operation, and lands in whatever
--   observes queries. This database has pg_stat_statements loaded and
--   log_statement = ddl; parameters are normally excluded, but an error path
--   can log a statement with its parameters, and anyone with database access
--   sees keys flowing past that would otherwise never leave the app process.
--
--   Encrypting in the application keeps the key in one process's memory. It
--   also keeps working if the database is replicated, dumped or restored
--   elsewhere, because ciphertext is just bytes.
--
--   pgcrypto also does not answer the actual question -- who holds the key and
--   how it is rotated. That is what this migration is for.
--
-- WHAT THIS ADDS:
--
--   A version on every ciphertext, a registry of which versions exist, and an
--   audit of every rotation. Without versioning, rotating a key means every
--   existing row becomes undecryptable the instant the key changes — so in
--   practice nobody rotates, which is worse than a scheduled rotation.
--
--   Ciphertext is stored as "v<N>:<base64>". Anything without a prefix is
--   treated as v1, which is what already exists today, so nothing has to be
--   rewritten for this to land.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.encryption_keys (
  version       integer PRIMARY KEY CHECK (version > 0),

  -- SHA-256 of the key, NOT the key. Enough to confirm the env holds the key
  -- this version was encrypted with, without the database ever knowing it.
  -- The whole point is that a dump of this table is useless.
  key_fingerprint text NOT NULL,

  purpose       text NOT NULL DEFAULT 'config'
                     CHECK (purpose IN ('config', 'account_deletion')),

  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text,
  -- Set when a rotation away from this version completes. A retired key must
  -- stay in the environment until every row has moved off it.
  retired_at    timestamptz,
  notes         text
);

COMMENT ON TABLE public.encryption_keys IS
  'Which encryption key versions exist. Holds a FINGERPRINT, never a key — a dump of this table reveals nothing.';
COMMENT ON COLUMN public.encryption_keys.retired_at IS
  'Set only after every ciphertext has been re-encrypted away from this version. Removing the key from the environment before this is set makes those rows unreadable for ever.';

ALTER TABLE public.encryption_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.encryption_keys FROM anon, authenticated;

-- ── The rotation record ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.key_rotations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_version   integer REFERENCES public.encryption_keys(version),
  to_version     integer NOT NULL REFERENCES public.encryption_keys(version),
  purpose        text NOT NULL DEFAULT 'config',

  started_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  -- 'failed' is a real outcome and is kept: a rotation that stopped halfway
  -- leaves rows on two versions, and hiding that is how a key gets removed
  -- from the environment while rows still depend on it.
  status         text NOT NULL DEFAULT 'running'
                      CHECK (status IN ('running', 'completed', 'failed')),

  rows_total     integer NOT NULL DEFAULT 0,
  rows_rotated   integer NOT NULL DEFAULT 0,
  -- Which tables and columns were touched, so a partial rotation can be
  -- resumed or reasoned about rather than guessed at.
  targets        jsonb,
  error          text,

  actor          text NOT NULL
);

COMMENT ON TABLE public.key_rotations IS
  'Every key rotation: who ran it, when, from which version to which, how many rows moved, and whether it finished.';

CREATE INDEX IF NOT EXISTS key_rotations_recent_idx
  ON public.key_rotations (started_at DESC);

ALTER TABLE public.key_rotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.key_rotations FROM anon, authenticated;

/**
 * How many ciphertexts sit on each version.
 *
 * Answers the one question that matters before removing a key from the
 * environment: is anything still encrypted with it? Reads the version prefix
 * rather than decrypting, so it needs no key at all.
 */
CREATE OR REPLACE FUNCTION public.ciphertext_version_counts()
RETURNS TABLE (source text, version integer, row_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT 'app_secrets.value_enc',
         COALESCE(NULLIF(substring(value_enc from '^v([0-9]+):'), '')::integer, 1),
         count(*)
    FROM public.app_secrets GROUP BY 2
  UNION ALL
  SELECT 'company_accounts.account_number_enc',
         COALESCE(NULLIF(substring(account_number_enc from '^v([0-9]+):'), '')::integer, 1),
         count(*)
    FROM public.company_accounts GROUP BY 2
  UNION ALL
  SELECT 'company_private.account_number_enc',
         COALESCE(NULLIF(substring(account_number_enc from '^v([0-9]+):'), '')::integer, 1),
         count(*)
    FROM public.company_private WHERE account_number_enc IS NOT NULL GROUP BY 2;
$$;

-- Register what is already in use. Everything encrypted before today is v1.
INSERT INTO public.encryption_keys (version, key_fingerprint, purpose, created_by, notes)
VALUES (1, 'pending-first-verification', 'config', 'migration-043',
        'The key in CONFIG_ENCRYPTION_KEY as of 2026-09-17. The fingerprint is recorded on first use by the application, which is the only place the key exists.')
ON CONFLICT (version) DO NOTHING;
