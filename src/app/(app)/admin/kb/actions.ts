'use server';

/**
 * KB write path. Same mutate()/perform_action() audit pattern as every other
 * admin write, with one ordering difference that matters.
 *
 * mutate() runs its callback BEFORE perform_action(), and perform_action is
 * what authorizes -- it raises insufficient_privilege on denial. For a database
 * write that is harmless: the transaction rolls back. A FILE write does not roll
 * back. So the file must not be touched until mutate() has returned, which is
 * why the write happens after the await rather than inside the callback.
 */

import { mutate } from '../lib/db';
import { readKb, writeKb, KB_SANITY_MAX_BYTES } from '@/lib/kb';
import { createHash } from 'crypto';

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export async function saveKb(content: string): Promise<{ error?: string; savedAt?: string }> {
  if (typeof content !== 'string') return { error: 'Invalid content.' };

  const bytes = Buffer.byteLength(content, 'utf-8');

  // THE check that matters. An empty KB raises no error anywhere: the webhook
  // still runs, the AI is still called, the customer still gets a reply -- the
  // assistant has simply lost everything it knows and starts inventing answers.
  // There is nothing to alert on, so it has to be refused at the door.
  if (!content.trim()) {
    return { error: 'The knowledge base cannot be empty — the assistant would keep replying, just with nothing to go on.' };
  }

  // Not an editorial limit; the KB is meant to grow. This only catches a wrong
  // file being pasted, which would otherwise go straight to customers.
  if (bytes > KB_SANITY_MAX_BYTES) {
    return { error: `${(bytes / 1024 / 1024).toFixed(1)} MB is far beyond a knowledge base — check you pasted the right thing.` };
  }

  const before = readKb();
  if (before === content) return { savedAt: new Date().toISOString() };

  try {
    // Authorize + audit FIRST. Throws on denial, before anything is written.
    // Content hashes rather than content: the audit log should record that the
    // KB changed and by whom, not carry two copies of the document.
    await mutate(async () => ({
      result: undefined,
      audit: {
        resourceKey: 'settings',
        action: 'edit' as const,
        targetId: 'kb.md',
        before: { bytes: Buffer.byteLength(before, 'utf-8'), sha256: sha(before) },
        after: { bytes, sha256: sha(content) },
      },
    }));
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Not permitted.' };
  }

  try {
    writeKb(content);
  } catch (error) {
    return { error: `Authorized, but the file could not be written: ${error instanceof Error ? error.message : 'unknown'}` };
  }

  return { savedAt: new Date().toISOString() };
}
