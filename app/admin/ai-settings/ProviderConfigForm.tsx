'use client';

import { useState, useTransition } from 'react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Select } from '../../../components/ui/select';
import { setProviderConfig, type AiCapability, type AiProviderConfigPublic, type AiProviderKind } from '../blog/ai-actions';

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
    <div className="rounded-lg border border-border p-4">
      <h3 className="text-sm font-semibold">{label}</h3>
      {existing?.hasKey && (
        <p className="mt-1 text-xs text-green-600 dark:text-green-500">
          Key configured{provider === existing.provider ? '' : ' (for the previously selected provider)'}.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-3">
        <div>
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
          <div>
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
          <div>
            <Label htmlFor={`${capability}-webhook`}>Webhook URL</Label>
            <Input
              id={`${capability}-webhook`}
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.currentTarget.value)}
              placeholder="https://your-tailscale-funnel-host/ai/generate"
            />
          </div>
        )}

        <div>
          <Label htmlFor={`${capability}-key`}>
            {provider === 'custom_webhook' ? 'Bearer token (optional)' : 'API key'}
          </Label>
          <Input
            id={`${capability}-key`}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.currentTarget.value)}
            placeholder={existing?.hasKey ? 'Leave blank to keep the current key' : 'Not set'}
            autoComplete="off"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={submit}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {status && (
            <span className={`text-xs ${status.ok ? 'text-green-600 dark:text-green-500' : 'text-destructive'}`}>
              {status.message}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
