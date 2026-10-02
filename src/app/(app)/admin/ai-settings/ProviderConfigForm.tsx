'use client';

import { useState, useTransition } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

import {
  setProviderConfig,
  type AiCapability,
  type AiProviderConfigPublic,
  type AiProviderKind,
} from '../blog/ai-actions';

const PROVIDERS: { value: AiProviderKind; label: string }[] = [
  { value: 'gemini', label: 'Gemini (Google)' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom_webhook', label: 'Custom webhook (your own model/GPU)' },
];

export function ProviderConfigForm({
  capability,
  label,
  existing,
}: {
  capability: AiCapability;
  label: string;
  existing: AiProviderConfigPublic | null;
}) {
  const [provider, setProvider] = useState<AiProviderKind>(existing?.provider ?? 'gemini');
  const [model, setModel] = useState(existing?.model ?? '');
  const [webhookUrl, setWebhookUrl] = useState(existing?.webhook_url ?? '');
  const [apiKey, setApiKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [localAiEnabled, setLocalAiEnabled] = useState(existing?.localAiEnabled ?? true);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function submit() {
    setStatus(null);
    startTransition(async () => {
      const result = await setProviderConfig({
        capability,
        provider,
        model,
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
        webhookUrl: provider === 'custom_webhook' ? webhookUrl.trim() : undefined,
        localAiEnabled: capability === 'whatsapp_chat' ? localAiEnabled : undefined,
      });
      if (result.ok) {
        setStatus({ ok: true, message: 'Saved.' });
        setApiKey('');
      } else {
        setStatus({ ok: false, message: result.error });
      }
    });
  }

  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">{label}</h3>
      {existing?.hasKey ? (
        <p className="mt-1 text-xs text-green-ink">
          Key configured
          {provider === existing.provider ? '' : ' (for the previously selected provider)'}.
        </p>
      ) : (
        <p className="mt-1 text-xs text-saffron-ink">
          ⚠ No key configured{capability === 'whatsapp_chat' ? ' here' : ''} — add one below.
          {capability === 'whatsapp_chat' &&
            ' The WhatsApp bot falls back to the GEMINI_API_KEY environment variable if this is left unset, so it may still be working — this just means an admin has to change Coolify to rotate the key instead of using this form.'}
        </p>
      )}

      <div className="mt-3 flex flex-col gap-3">
        {capability === 'whatsapp_chat' && (
          <label className="flex items-start gap-2.5 rounded-md border border-hairline bg-sand p-3 text-sm">
            <Checkbox
              checked={localAiEnabled}
              onChange={(e) => setLocalAiEnabled(e.currentTarget.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-ink">Try local AI (vLLM) first</span>
              <span className="block text-xs text-muted">
                When on, every message tries the local backend before falling back to the
                provider below. When off, every reply comes from the provider below directly —
                takes effect within about a minute, no redeploy needed.
              </span>
            </span>
          </label>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${capability}-provider`}>Provider</Label>
          <Select
            id={`${capability}-provider`}
            value={provider}
            onChange={(e) => setProvider(e.currentTarget.value as AiProviderKind)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        {provider !== 'custom_webhook' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${capability}-model`}>Model</Label>
            <Input
              id={`${capability}-model`}
              value={model}
              onChange={(e) => setModel(e.currentTarget.value)}
              placeholder={provider === 'gemini' ? 'e.g. gemini-flash-latest' : 'e.g. openai/gpt-4o-mini'}
            />
          </div>
        )}

        {provider === 'custom_webhook' && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${capability}-webhook`}>Webhook URL</Label>
            <Input
              id={`${capability}-webhook`}
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.currentTarget.value)}
              placeholder="https://your-tailscale-funnel-host/ai/generate"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${capability}-key`}>
            {provider === 'custom_webhook' ? 'Bearer token (optional)' : 'API key'}
          </Label>
          <div className="relative">
            <Input
              id={`${capability}-key`}
              type={keyVisible ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.currentTarget.value)}
              placeholder={existing?.hasKey ? 'Leave blank to keep the current key' : 'Not set'}
              autoComplete="off"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setKeyVisible((v) => !v)}
              aria-label={keyVisible ? 'Hide key' : 'Show key'}
              title={keyVisible ? 'Hide key' : 'Show key'}
              className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted transition hover:text-ink"
            >
              {keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={submit}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {status && (
            <span className={`text-xs ${status.ok ? 'text-green-ink' : 'text-red-600'}`}>
              {status.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
