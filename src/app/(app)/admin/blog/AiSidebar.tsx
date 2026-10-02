'use client';

/**
 * The "things we care about" sidebar: live SEO tips (computed client-side,
 * instant, no AI/network call) plus AI-assisted writing (via the server actions
 * in ai-actions.ts, whose provider is admin-configurable at /admin/ai-settings)
 * — title suggestions, keyword suggestions, and a whole-draft rewrite. This is
 * the admin-only "post creator" AI: it never touches anything public-facing,
 * only suggests content the operator explicitly applies.
 *
 * Ported from vigyan-site-os; wired to this repo's UI primitives and tokens.
 */

import { useEffect, useState, useTransition } from 'react';
import { AlertCircle, CheckCircle2, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Block } from '@/lib/content/blocks';

import { getWritingStyle, improveText, setWritingStyle, suggestKeywords, suggestTitles } from './ai-actions';

function blocksToPlainText(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
        case 'heading':
        case 'quote':
        case 'code':
          return block.text;
        case 'list':
          return block.items.join('\n');
        case 'image':
          return block.caption ?? '';
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n\n');
}

function SeoCheck({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <li className="flex items-start gap-1.5 text-xs">
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${ok ? 'text-green-ink' : 'text-saffron-ink'}`} aria-hidden="true" />
      <span className="text-muted">{label}</span>
    </li>
  );
}

export function AiSidebar({
  title,
  seoDescription,
  blocks,
  onApplyTitle,
  onReplaceBody,
}: {
  title: string;
  seoDescription: string;
  blocks: Block[];
  onApplyTitle: (title: string) => void;
  onReplaceBody: (blocks: Block[]) => void;
}) {
  const [titles, setTitles] = useState<string[] | null>(null);
  const [keywords, setKeywords] = useState<string[] | null>(null);
  const [improved, setImproved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pendingAction, setPendingAction] = useState<'titles' | 'keywords' | 'improve' | null>(null);

  const [styleOpen, setStyleOpen] = useState(false);
  const [style, setStyle] = useState('');
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleSaved, setStyleSaved] = useState(false);

  // Floating panel, not a fixed layout column — a permanent sidebar column
  // was eating into the actual writing area. Closed by default so it never
  // costs any space unless you actually open it.
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    getWritingStyle()
      .then((text) => {
        setStyle(text);
        setStyleLoaded(true);
      })
      // A missing DATABASE_URL (or any read failure) must not leave the panel
      // permanently disabled — the SEO tips below need no database at all.
      .catch(() => setStyleLoaded(true));
  }, []);

  const plainText = blocksToPlainText(blocks);
  const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;

  function run(action: 'titles' | 'keywords' | 'improve') {
    setError(null);
    setPendingAction(action);
    startTransition(async () => {
      if (action === 'titles') {
        const result = await suggestTitles(plainText);
        if (result.ok) setTitles(result.titles);
        else setError(result.error);
      } else if (action === 'keywords') {
        const result = await suggestKeywords(title, plainText);
        if (result.ok) setKeywords(result.keywords);
        else setError(result.error);
      } else {
        const result = await improveText(plainText);
        if (result.ok) setImproved(result.text);
        else setError(result.error);
      }
    });
  }

  if (!panelOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setPanelOpen(true)}
        className="fixed bottom-6 right-6 z-40 shadow-warm-md"
      >
        <Sparkles className="mr-1.5 h-4 w-4" />
        AI &amp; SEO
      </Button>
    );
  }

  return (
    <aside className="fixed bottom-6 right-6 z-40 flex max-h-[80vh] w-[calc(100vw-3rem)] flex-col gap-5 overflow-y-auto rounded-card border border-hairline bg-surface p-4 shadow-warm-lg sm:w-96">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
          AI &amp; SEO assist
        </span>
        <button
          type="button"
          onClick={() => setPanelOpen(false)}
          aria-label="Close"
          className="rounded p-1 text-muted transition hover:bg-sand hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setStyleOpen((v) => !v)}
          className="flex w-full items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-faint"
        >
          <span>Writing style {style.trim() && !styleOpen ? '(set)' : ''}</span>
          <span>{styleOpen ? '▲' : '▼'}</span>
        </button>
        {styleOpen && (
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-xs text-muted">
              Describe your own voice/tone once — every AI suggestion below uses this, so
              output doesn&apos;t read as generic AI-generated text. e.g. &quot;Direct, short
              sentences, no corporate buzzwords, occasional dry humor, first person.&quot;
            </p>
            {styleLoaded ? (
              <Textarea
                rows={4}
                className="text-xs"
                value={style}
                onChange={(e) => {
                  setStyle(e.currentTarget.value);
                  setStyleSaved(false);
                }}
                placeholder="Not set — AI output will read as generic."
              />
            ) : (
              <div className="h-[88px] animate-pulse rounded-md border border-hairline bg-sand" aria-hidden="true" />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={styleSaving}
                onClick={() => {
                  setStyleSaving(true);
                  setWritingStyle(style).then((result) => {
                    setStyleSaving(false);
                    if (result.ok) {
                      setStyleSaved(true);
                    } else {
                      setError(result.error);
                    }
                  });
                }}
              >
                {styleSaving ? 'Saving…' : 'Save style'}
              </Button>
              {styleSaved && <span className="text-xs text-green-ink">Saved</span>}
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
          SEO tips
        </h3>
        <ul className="flex flex-col gap-1">
          <SeoCheck ok={title.length >= 30 && title.length <= 60} label={`Title length: ${title.length} chars (aim for 30–60)`} />
          <SeoCheck
            ok={seoDescription.length >= 100 && seoDescription.length <= 170}
            label={`Meta description: ${seoDescription.length} chars (aim for 100–170)`}
          />
          <SeoCheck ok={wordCount >= 300} label={`Body length: ${wordCount} words (aim for 300+)`} />
        </ul>
      </div>

      <div>
        <h3 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
          AI assist
        </h3>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run('titles')}
          >
            {pending && pendingAction === 'titles' ? 'Thinking…' : 'Suggest titles'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run('keywords')}
          >
            {pending && pendingAction === 'keywords' ? 'Thinking…' : 'Suggest keywords'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => run('improve')}
          >
            {pending && pendingAction === 'improve' ? 'Thinking…' : 'Improve writing'}
          </Button>
        </div>

        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        {titles && titles.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {titles.map((t) => (
              <li key={t}>
                <button
                  type="button"
                  onClick={() => {
                    onApplyTitle(t);
                    setTitles(null);
                  }}
                  className="w-full rounded border border-hairline px-2 py-1 text-left text-xs text-ink transition hover:bg-sand"
                >
                  {t}
                </button>
              </li>
            ))}
          </ul>
        )}

        {keywords && keywords.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {keywords.map((k) => (
              <span
                key={k}
                className="rounded-full border border-hairline bg-sand px-2 py-0.5 text-xs text-muted"
              >
                {k}
              </span>
            ))}
          </div>
        )}

        {improved && (
          <div className="mt-3 flex flex-col gap-2">
            <p className="text-xs text-muted">
              Rewritten draft — review before applying, this replaces the whole body:
            </p>
            <div className="max-h-40 overflow-y-auto rounded border border-hairline bg-sand p-2 text-xs text-ink">
              {improved}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const newBlocks: Block[] = improved
                    .split(/\n{2,}/)
                    .map((chunk) => chunk.trim())
                    .filter(Boolean)
                    .map((text) => ({ type: 'paragraph', text }));
                  onReplaceBody(newBlocks);
                  setImproved(null);
                }}
              >
                Apply
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setImproved(null)}>
                Discard
              </Button>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
