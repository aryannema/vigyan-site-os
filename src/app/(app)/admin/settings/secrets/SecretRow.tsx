'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';

import { Input } from '@/components/ui/input';

import { SubmitButton } from '../../components/SubmitButton';
import type { FormState } from '../../lib/form';

export interface SecretStatus {
  key: string;
  source: 'database' | 'env' | 'unset';
  updatedAt: string | null;
  description: string;
  selfGenerated: boolean;
  issuer: string | null;
  /** Pre-generated suggestion for keys we define ourselves. Never yet stored. */
  suggestion: string | null;
}

const SOURCE_LABEL: Record<SecretStatus['source'], { text: string; tone: string }> = {
  database: { text: 'Managed here', tone: 'border-green-600/30 bg-green-600/10 text-green-700' },
  env: { text: 'Still in env', tone: 'border-amber-600/30 bg-amber-600/10 text-amber-700' },
  unset: { text: 'Not set anywhere', tone: 'border-red-600/30 bg-red-600/10 text-red-600' },
};

export function SecretRow({
  secret,
  saveAction,
  regenerateAction,
  clearAction,
  revealAction,
}: {
  secret: SecretStatus;
  saveAction: (state: FormState, formData: FormData) => Promise<FormState>;
  regenerateAction: (state: FormState, formData: FormData) => Promise<FormState>;
  clearAction: (state: FormState, formData: FormData) => Promise<FormState>;
  revealAction: (key: string) => Promise<{ value?: string; error?: string }>;
}) {
  const [saveState, save] = useActionState(saveAction, {} as FormState);
  const [regenState, regen] = useActionState(regenerateAction, {} as FormState);
  const [clearState, clear] = useActionState(clearAction, {} as FormState);
  const [open, setOpen] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealing, startReveal] = useTransition();

  // A revealed credential does not stay on screen.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 30000);
    return () => clearTimeout(t);
  }, [revealed]);

  const toggleReveal = () => {
    if (revealed) return setRevealed(null);
    setRevealError(null);
    startReveal(async () => {
      const r = await revealAction(secret.key);
      if (r.value) setRevealed(r.value);
      else setRevealError(r.error ?? 'Could not reveal the secret.');
    });
  };

  const copyRevealed = async () => {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const badge = SOURCE_LABEL[secret.source];
  const state = saveState.error || saveState.success ? saveState
    : regenState.error || regenState.success ? regenState
    : clearState;

  return (
    <div className="rounded-card border border-hairline bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <code className="font-mono text-sm font-semibold text-ink">{secret.key}</code>
          <p className="mt-1 text-xs text-muted">{secret.description}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badge.tone}`}>
          {badge.text}
        </span>
      </div>

      {/* The value is never rendered. This screen answers "is it set, and when
          did it change" -- the question an operator actually has -- without
          putting a live credential on a screen or in a response body. */}
      <div className="mt-3 flex items-center gap-2">
        <p
          className={`min-w-0 flex-1 font-mono text-sm ${revealed ? 'break-all text-ink' : 'tracking-widest text-faint'}`}
        >
          {secret.source === 'unset' ? '—' : revealed ?? '••••••••••••••••'}
        </p>
        {secret.source !== 'unset' && (
          <>
            {revealed && (
              <button
                type="button"
                onClick={copyRevealed}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-sand hover:text-ink"
                aria-label={`Copy ${secret.key}`}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button
              type="button"
              onClick={toggleReveal}
              disabled={revealing}
              className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-sand hover:text-ink disabled:opacity-60"
              aria-label={revealed ? `Hide ${secret.key}` : `Show ${secret.key}`}
              title={revealed ? 'Hide' : 'Show (logged in the audit trail, hides after 30s)'}
            >
              {revealed ? <EyeOff className="h-3.5 w-3.5" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}
              {revealing ? '…' : revealed ? 'Hide' : 'Show'}
            </button>
          </>
        )}
      </div>
      {revealError && <p className="mt-1 text-xs font-semibold text-red-600">{revealError}</p>}

      {secret.source === 'env' && (
        <p className="mt-2 text-xs text-amber-700">
          Currently read from an environment variable. Saving a value here takes over,
          and the env var can then be deleted from Coolify.
        </p>
      )}
      {secret.updatedAt && (
        <p className="mt-1 text-xs text-faint">Last changed {new Date(secret.updatedAt).toLocaleString()}</p>
      )}

      {state?.error && <p className="mt-3 text-xs font-semibold text-red-600">{state.error}</p>}
      {state?.success && <p className="mt-3 text-xs font-semibold text-green-700">{state.success}</p>}

      {/* Shown once, immediately after generation. Not persisted anywhere in the
          UI: a refresh loses it, which is the intended behaviour. */}
      {state?.revealed && (
        <div className="mt-2 rounded-ui-md border border-amber-600/30 bg-amber-600/10 p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-amber-700">
            Copy now — not shown again
          </p>
          <code className="block break-all font-mono text-xs text-ink">{state.revealed}</code>
        </div>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 text-xs font-semibold text-saffron-ink underline-offset-2 hover:underline"
        >
          {secret.source === 'unset' ? 'Set value' : 'Replace value'}
        </button>
      ) : (
        <form action={save} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="key" value={secret.key} />
          <div className="min-w-[240px] flex-1">
            <Input
              name="value"
              // Third-party credentials are masked: they are being pasted from
              // elsewhere and must not linger on screen. Self-generated ones are
              // shown, because this is the only moment they can be copied --
              // WHATSAPP_VERIFY_TOKEN in particular has to be typed into Meta's
              // webhook config as the identical string.
              type={secret.selfGenerated || showInput ? 'text' : 'password'}
              autoComplete="off"
              defaultValue={secret.suggestion ?? ''}
              spellCheck={false}
              className={secret.selfGenerated ? 'font-mono text-xs' : undefined}
              placeholder={secret.issuer ? `Paste from ${secret.issuer}` : 'New value'}
              aria-label={`New value for ${secret.key}`}
            />
          </div>
          {!secret.selfGenerated && (
            <button
              type="button"
              onClick={() => setShowInput((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-md border border-hairline text-muted hover:bg-sand hover:text-ink"
              aria-label={showInput ? 'Hide typed value' : 'Show typed value'}
              title={showInput ? 'Hide' : 'Show what you typed'}
            >
              {showInput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
          <SubmitButton>Save</SubmitButton>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-10 px-3 text-xs font-semibold text-muted hover:text-ink"
          >
            Cancel
          </button>
        </form>
      )}

      {open && secret.selfGenerated && (
        <p className="mt-2 text-xs text-amber-700">
          A fresh value is suggested above — edit it or keep it.{' '}
          <strong>Copy it before saving</strong>: once stored it is encrypted and never
          shown again.
          {secret.key === 'WHATSAPP_VERIFY_TOKEN' &&
            ' The identical string must also be entered in Meta → App → WhatsApp → Configuration → Verify token.'}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-4">
        {secret.selfGenerated && (
          <form action={regen}>
            <input type="hidden" name="key" value={secret.key} />
            <SubmitButton variant="ghost">Generate new</SubmitButton>
          </form>
        )}
        {secret.source === 'database' && (
          <form action={clear}>
            <input type="hidden" name="key" value={secret.key} />
            <SubmitButton variant="ghost">Clear</SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
