'use client';

import { useState, useTransition } from 'react';
import { saveKb } from './actions';

export function KbEditor({ initial, warnBytes, filePath }: { initial: string; warnBytes: number; filePath: string }) {
  const [content, setContent] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const dirty = content !== initial;
  const bytes = new TextEncoder().encode(content).length;
  const empty = content.trim().length === 0;
  // Advisory only -- the KB is meant to grow, so size never blocks a save.
  // Emptiness does, because an empty KB fails silently rather than loudly.
  const large = bytes > warnBytes;
  const tokens = Math.ceil(bytes / 4);

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveKb(content);
      if (result.error) { setError(result.error); return; }
      setSavedAt(result.savedAt ?? new Date().toISOString());
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-muted">
          <span className="font-mono">{filePath}</span>
          {' · '}
          <span>{(bytes / 1024).toFixed(1)} KB</span>
          {' · '}
          <span>~{tokens.toLocaleString('en-IN')} tokens per message</span>
        </div>
        <div className="flex items-center gap-3">
          {savedAt && !dirty && <span className="text-xs text-muted">Saved — live within 30s</span>}
          <button
            type="button"
            onClick={save}
            disabled={isPending || !dirty || empty}
            className="rounded-lg bg-saffron-500 px-4 py-2 text-xs font-bold text-[#1c1814] transition hover:brightness-[1.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive">
          {error}
        </p>
      )}

      {empty && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive">
          Empty. The assistant would carry on replying to customers with nothing to go on — saving is blocked.
        </p>
      )}

      {large && !empty && (
        <p className="rounded-lg border border-hairline bg-sand px-3 py-2 text-xs text-body">
          This is sent with <strong>every</strong> message the assistant answers, so ~{tokens.toLocaleString('en-IN')} tokens
          is the per-reply cost. Still fine to save — worth trimming if it keeps growing.
        </p>
      )}

      <textarea
        value={content}
        onChange={(e) => { setContent(e.target.value); setSavedAt(null); }}
        spellCheck={false}
        rows={30}
        className="w-full rounded-xl border border-hairline-strong bg-sand p-4 font-mono text-[13px] leading-relaxed text-ink outline-none focus:border-saffron-500/60"
      />
    </div>
  );
}
