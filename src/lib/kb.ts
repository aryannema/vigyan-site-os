import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

/**
 * The WhatsApp/AI knowledge base file.
 *
 * It is a FILE on a mounted volume, never a database row -- the same file backs
 * both this app's webhook and the gpu-box funnel, and feeds the local-GPU
 * path and the Gemini fallback alike. Putting it in this app's Postgres would
 * make one consumer the owner of a shared asset. See docs/OPS.md 13.
 *
 * SERVER ONLY. Never import from a client component.
 */

/** Mounted volume in production; the git-bundled copy in local dev. */
const MOUNTED = '/app/kb-data/kb.md';
const BUNDLED = () => path.join(process.cwd(), 'data', 'kb.md');

/**
 * Size policy.
 *
 * The KB is expected to GROW -- that is the point of it -- so size is reported,
 * not rationed. There is no editorial limit here, only two guards:
 *
 *   KB_WARN_BYTES   advisory. Past this the editor shows the estimated token
 *                   cost, because the KB is injected into EVERY AI prompt: a
 *                   bigger KB is paid for on every single customer message, and
 *                   eventually competes with the local model's context window.
 *                   It does NOT block saving. The operator decides.
 *
 *   KB_SANITY_MAX   an accident guard, not a policy. Nothing legitimate reaches
 *                   2 MB of prose; a value this large means a wrong file was
 *                   pasted, and silently accepting it would put that content in
 *                   front of customers.
 *
 * The check that actually matters is EMPTY, enforced in the save action. An
 * empty KB throws no error anywhere -- the assistant simply loses everything it
 * knows and starts answering badly, with nothing to alert on.
 */
export const KB_WARN_BYTES = 64 * 1024;
export const KB_SANITY_MAX_BYTES = 2 * 1024 * 1024;

/** Rough token estimate (~4 chars/token) for the cost shown in the editor. */
export function estimateTokens(content: string): number {
  return Math.ceil(Buffer.byteLength(content, 'utf-8') / 4);
}

export function kbPath(): string {
  if (existsSync(MOUNTED)) return MOUNTED;
  const bundled = BUNDLED();
  if (existsSync(bundled)) return bundled;
  // Neither exists yet: prefer the mount if its directory is there, so a first
  // write in production lands on the volume rather than inside the container.
  return existsSync(path.dirname(MOUNTED)) ? MOUNTED : bundled;
}

export function readKb(): string {
  try {
    return readFileSync(kbPath(), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Write via temp file + atomic rename.
 *
 * Two reasons, both real here: the webhook re-reads this file every 30s, so a
 * plain truncate-and-write exposes a window where a reader gets a half-written
 * KB; and the sync to gpu-box watches for writes, so a partial file could
 * be copied onward before it is complete. rename(2) within a filesystem is
 * atomic -- a reader sees either the whole old file or the whole new one.
 */
export function writeKb(content: string): void {
  const target = kbPath();
  const dir = path.dirname(target);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const tmp = `${target}.tmp`;
  try {
    writeFileSync(tmp, content, 'utf-8');
    renameSync(tmp, target);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
    throw err;
  }
}
