import { readKb, kbPath, KB_WARN_BYTES } from '@/lib/kb';
import { KbEditor } from './KbEditor';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Knowledge Base' };

/**
 * The knowledge base the WhatsApp assistant answers from.
 *
 * Edits land on the mounted FILE, not a table, because the same file is read by
 * the gpu-box funnel as well as this app. The webhook re-reads it on a 30s
 * TTL, so a save is live within half a minute with no restart or redeploy.
 */
export default async function KbPage() {
  const content = readKb();

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-8">
      <header className="space-y-2">
        <h2 className="text-2xl font-bold text-ink">Knowledge Base</h2>
        <p className="text-sm text-body">
          What the WhatsApp assistant knows. Written in Markdown. Every answer it gives is grounded in
          this text, so the way something is phrased here is the way it will be said to a customer.
        </p>
        <p className="text-xs text-muted">
          Saved to the shared file on disk — <strong>not</strong> the database, because the same file is
          read by the AI machine as well as this site. Live within 30 seconds; no deploy, no restart.
        </p>
      </header>

      <KbEditor initial={content} warnBytes={KB_WARN_BYTES} filePath={kbPath()} />
    </div>
  );
}
