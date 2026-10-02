'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSection, previewSection, rollbackSection } from '../actions';

interface HistoryEntry {
  id: string;
  created_at: string;
  changed_by: string;
  content_data: unknown;
}

interface SectionEditorProps {
  sectionId: string;
  currentContent: unknown;
  schema: unknown;
  history: HistoryEntry[];
}

export default function SectionEditor({ sectionId, currentContent, schema, history }: SectionEditorProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [jsonValue, setJsonValue] = useState(JSON.stringify(currentContent, null, 2));
  const [parseError, setParseError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [feedbackType, setFeedbackType] = useState<'success' | 'error' | 'info'>('info');
  const [showHistory, setShowHistory] = useState(false);

  const parsedJson = () => {
    try {
      return { ok: true, value: JSON.parse(jsonValue) };
    } catch {
      return { ok: false, value: null };
    }
  };

  const handleJsonChange = (val: string) => {
    setJsonValue(val);
    try {
      JSON.parse(val);
      setParseError('');
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  const handlePreview = () => {
    const { ok, value } = parsedJson();
    if (!ok) return;
    setFeedback('');
    startTransition(async () => {
      try {
        await previewSection(sectionId, value);
        setFeedback('Preview passed — payload is valid.');
        setFeedbackType('info');
      } catch (err: unknown) {
        setFeedback(err instanceof Error ? err.message : 'An error occurred');
        setFeedbackType('error');
      }
    });
  };

  const handleSave = () => {
    const { ok, value } = parsedJson();
    if (!ok) return;
    setFeedback('');
    startTransition(async () => {
      try {
        await updateSection(sectionId, value);
        setFeedback('Saved successfully. Page will reflect changes on next load.');
        setFeedbackType('success');
        router.refresh();
      } catch (err: unknown) {
        setFeedback(err instanceof Error ? err.message : 'An error occurred');
        setFeedbackType('error');
      }
    });
  };

  const handleRollback = (versionId: string) => {
    if (!confirm('Restore this version? Current content will be archived.')) return;
    startTransition(async () => {
      try {
        await rollbackSection(sectionId, versionId);
        setFeedback('Rolled back successfully.');
        setFeedbackType('success');
        router.refresh();
      } catch (err: unknown) {
        setFeedback(err instanceof Error ? err.message : 'An error occurred');
        setFeedbackType('error');
      }
    });
  };

  const feedbackClass = {
    success: 'bg-brand-bytes/10 border-brand-bytes/20 text-green-ink',
    error: 'bg-red-500/10 border-red-500/20 text-red-400',
    info: 'bg-brand-primary/10 border-brand-primary/20 text-saffron-ink',
  }[feedbackType];

  return (
    <div className="space-y-5">
      {/* JSON Editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Content JSON</label>
          {parseError && (
            <span className="text-[10px] text-red-400 font-mono">{parseError}</span>
          )}
        </div>
        <textarea
          value={jsonValue}
          onChange={(e) => handleJsonChange(e.target.value)}
          rows={18}
          spellCheck={false}
          className="w-full bg-sand dark:bg-sand border border-hairline dark:border-hairline rounded-xl p-4 text-sm font-mono text-ink dark:text-slate-200 focus:border-brand-primary outline-none resize-y leading-relaxed"
        />
      </div>

      {feedback && (
        <div className={`p-3 rounded-lg border text-xs font-medium ${feedbackClass}`}>
          {feedback}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handlePreview}
          disabled={isPending || !!parseError}
          className="px-5 py-2.5 rounded-xl bg-sand dark:bg-surface border border-hairline dark:border-hairline text-sm font-bold text-body dark:text-faint hover:bg-well dark:hover:bg-surface transition disabled:opacity-40"
        >
          {isPending ? '…' : 'Validate'}
        </button>
        <button
          onClick={handleSave}
          disabled={isPending || !!parseError}
          className="px-5 py-2.5 rounded-xl bg-brand-primary text-slate-950 text-sm font-bold hover:brightness-110 transition disabled:opacity-40 shadow-lg shadow-brand-primary/20"
        >
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="ml-auto px-5 py-2.5 rounded-xl bg-sand dark:bg-surface border border-hairline dark:border-hairline text-xs font-bold text-muted dark:text-faint hover:bg-well dark:hover:bg-surface transition"
        >
          {showHistory ? 'Hide History' : `History (${history.length})`}
        </button>
      </div>

      {/* Version History */}
      {showHistory && (
        <div className="rounded-2xl bg-surface dark:bg-surface border border-hairline dark:border-hairline overflow-hidden">
          <div className="px-5 py-3 border-b border-hairline dark:border-hairline">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Version History</p>
          </div>
          {history.length === 0 ? (
            <p className="px-5 py-4 text-xs text-muted">No history yet. Save to create the first version.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {history.map((entry) => (
                <div key={entry.id} className="flex items-center justify-between px-5 py-3.5 hover:bg-sand dark:hover:bg-surface transition">
                  <div>
                    <p className="text-xs text-ink dark:text-white font-medium">
                      {new Date(entry.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                    <p className="text-[10px] text-muted mt-0.5">by {entry.changed_by}</p>
                  </div>
                  <button
                    onClick={() => handleRollback(entry.id)}
                    disabled={isPending}
                    className="text-xs font-bold text-saffron-ink hover:underline disabled:opacity-40"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Schema Reference */}
      <details className="group">
        <summary className="text-[10px] font-bold uppercase tracking-widest text-body cursor-pointer hover:text-faint transition list-none flex items-center gap-2">
          <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
          Schema Reference
        </summary>
        <pre className="mt-3 p-4 rounded-xl bg-sand dark:bg-sand border border-hairline dark:border-hairline text-[11px] font-mono text-body dark:text-faint overflow-x-auto">
          {JSON.stringify(schema, null, 2)}
        </pre>
      </details>
    </div>
  );
}
