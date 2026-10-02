import { ciphertextVersion, currentKeyVersion, keyFingerprint, rotateCiphertext } from '@/lib/app-secrets';
import { query } from '@/app/(app)/admin/lib/db';

/**
 * Key rotation, and the record of it.
 *
 * Answers the question that makes encryption-at-rest maintainable rather than
 * theatre: who holds the key, and how does it change?
 *
 * The answer here is that a key is a VERSION. Ciphertext carries its version,
 * the environment can hold several at once, and rotation walks every encrypted
 * value from an old version to the current one — recording who ran it, when,
 * how many rows moved, and whether it finished.
 *
 * Without that, rotating means every existing row becomes undecryptable the
 * instant the key changes, so nobody rotates and the key lives for ever. A key
 * that is never rotated is the actual risk, not the algorithm.
 *
 * SERVER ONLY.
 */

/** Every column holding versioned ciphertext. Add a row when adding a column. */
const TARGETS = [
  { table: 'app_secrets', idColumn: 'key', column: 'value_enc' },
  { table: 'company_accounts', idColumn: 'id', column: 'account_number_enc' },
  { table: 'company_private', idColumn: 'id', column: 'account_number_enc' },
] as const;

export interface VersionCount {
  source: string;
  version: number;
  row_count: number;
}

/**
 * How many ciphertexts sit on each key version.
 *
 * The check to run before removing an old key from the environment. If anything
 * still shows against that version, removing the key makes those rows
 * permanently unreadable — there is no recovery, so this is not a formality.
 */
export async function versionCounts(): Promise<VersionCount[]> {
  return query<VersionCount>('SELECT * FROM public.ciphertext_version_counts() ORDER BY source, version');
}

export interface RotationResult {
  rotationId: string;
  fromVersions: number[];
  toVersion: number;
  rowsTotal: number;
  rowsRotated: number;
  status: 'completed' | 'failed';
  error?: string;
}

/**
 * Re-encrypts everything onto the current key version.
 *
 * Deliberately NOT one big transaction. A rotation over many rows held in a
 * single transaction takes a long lock and, if it fails near the end, rolls
 * back work that had succeeded. Instead each row is its own update, and the
 * rotation record tracks progress — a failure part-way leaves a truthful count
 * rather than an all-or-nothing that hides how far it got.
 *
 * Safe to re-run. A value already on the current version is skipped, so a
 * second run finishes the remainder rather than starting over.
 */
export async function rotateKeys(actor: string): Promise<RotationResult> {
  const toVersion = currentKeyVersion();

  // Register the version before using it, so the fingerprint proves which key
  // the environment actually holds. A mismatch here means the wrong key is
  // configured, which is far better caught now than after re-encrypting.
  await query(
    `INSERT INTO public.encryption_keys (version, key_fingerprint, created_by)
          VALUES ($1, $2, $3)
     ON CONFLICT (version) DO UPDATE SET key_fingerprint = EXCLUDED.key_fingerprint
      WHERE public.encryption_keys.key_fingerprint = 'pending-first-verification'`,
    [toVersion, keyFingerprint(toVersion), actor],
  );

  const before = await versionCounts();
  const fromVersions = [...new Set(before.map((c) => c.version))].filter((v) => v !== toVersion);
  const rowsTotal = before
    .filter((c) => c.version !== toVersion)
    .reduce((n, c) => n + Number(c.row_count), 0);

  const [{ id: rotationId }] = await query<{ id: string }>(
    `INSERT INTO public.key_rotations (from_version, to_version, rows_total, targets, actor)
          VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [fromVersions[0] ?? null, toVersion, rowsTotal, JSON.stringify(TARGETS), actor],
  );

  let rowsRotated = 0;
  try {
    for (const t of TARGETS) {
      const rows = await query<Record<string, string>>(
        `SELECT ${t.idColumn} AS id, ${t.column} AS ct FROM public.${t.table} WHERE ${t.column} IS NOT NULL`,
      );
      for (const row of rows) {
        if (ciphertextVersion(row.ct) === toVersion) continue;
        const { value, changed } = rotateCiphertext(row.ct);
        if (!changed) continue;
        await query(
          `UPDATE public.${t.table} SET ${t.column} = $1 WHERE ${t.idColumn} = $2`,
          [value, row.id],
        );
        rowsRotated += 1;
        // Progress is written as it happens, so an interrupted rotation leaves
        // a true count rather than zero.
        await query('UPDATE public.key_rotations SET rows_rotated = $1 WHERE id = $2', [rowsRotated, rotationId]);
      }
    }

    await query(
      `UPDATE public.key_rotations SET status='completed', completed_at=now(), rows_rotated=$1 WHERE id=$2`,
      [rowsRotated, rotationId],
    );

    // Retire the old versions only once nothing is left on them.
    const after = await versionCounts();
    const stillInUse = new Set(after.map((c) => c.version));
    for (const v of fromVersions) {
      if (!stillInUse.has(v)) {
        await query(
          'UPDATE public.encryption_keys SET retired_at = now() WHERE version = $1 AND retired_at IS NULL',
          [v],
        );
      }
    }

    return { rotationId, fromVersions, toVersion, rowsTotal, rowsRotated, status: 'completed' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(
      `UPDATE public.key_rotations SET status='failed', completed_at=now(), rows_rotated=$1, error=$2 WHERE id=$3`,
      [rowsRotated, message, rotationId],
    );
    // Rethrow rather than returning quietly: a half-finished rotation needs
    // attention, and the caller must not treat it as done.
    throw new Error(
      `Rotation stopped after ${rowsRotated} of ${rowsTotal} rows: ${message}. ` +
        `Keep every old key in the environment — the remaining rows still need them.`,
    );
  }
}

export interface RotationRecord {
  id: string;
  from_version: number | null;
  to_version: number;
  started_at: string;
  completed_at: string | null;
  status: string;
  rows_total: number;
  rows_rotated: number;
  actor: string;
  error: string | null;
}

export async function rotationHistory(limit = 20): Promise<RotationRecord[]> {
  return query<RotationRecord>(
    `SELECT id, from_version, to_version, started_at, completed_at, status,
            rows_total, rows_rotated, actor, error
       FROM public.key_rotations ORDER BY started_at DESC LIMIT $1`,
    [limit],
  );
}
