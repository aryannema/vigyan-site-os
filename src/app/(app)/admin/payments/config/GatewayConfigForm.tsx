'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';

import { setGatewayConfig, type PaymentGatewayConfigPublic } from './actions';

export function GatewayConfigForm({ existing }: { existing: PaymentGatewayConfigPublic }) {
  const [keyId, setKeyId] = useState(existing.key_id ?? '');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [isLive, setIsLive] = useState(existing.is_live);
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);

  function submit() {
    setStatus(null);
    startTransition(async () => {
      const result = await setGatewayConfig({
        keyId: keyId.trim(),
        keySecret: keySecret.trim() ? keySecret.trim() : undefined,
        webhookSecret: webhookSecret.trim() ? webhookSecret.trim() : undefined,
        isLive,
      });
      if (result.ok) {
        setStatus({ ok: true, message: 'Saved.' });
        setKeySecret('');
        setWebhookSecret('');
      } else {
        setStatus({ ok: false, message: result.error });
      }
    });
  }

  return (
    <div className="rounded-card border border-hairline bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">Razorpay</h3>
      <p className="mt-1 text-xs text-muted">
        {existing.hasKeySecret ? 'Key secret configured.' : 'Key secret not set.'}{' '}
        {existing.hasWebhookSecret ? 'Webhook secret configured.' : 'Webhook secret not set.'}
      </p>

      <div className="mt-3 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="razorpay-key-id">Key ID</Label>
          <Input
            id="razorpay-key-id"
            value={keyId}
            onChange={(e) => setKeyId(e.currentTarget.value)}
            placeholder="rzp_live_… or rzp_test_…"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="razorpay-key-secret">Key secret</Label>
          <Input
            id="razorpay-key-secret"
            type="password"
            value={keySecret}
            onChange={(e) => setKeySecret(e.currentTarget.value)}
            placeholder={existing.hasKeySecret ? 'Leave blank to keep the current secret' : 'Not set'}
            autoComplete="off"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="razorpay-webhook-secret">Webhook secret</Label>
          <Input
            id="razorpay-webhook-secret"
            type="password"
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.currentTarget.value)}
            placeholder={existing.hasWebhookSecret ? 'Leave blank to keep the current secret' : 'Not set'}
            autoComplete="off"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <Checkbox checked={isLive} onChange={(e) => setIsLive(e.currentTarget.checked)} />
          Live mode (unchecked = test mode)
        </label>

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={submit}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
          {status && (
            <span className={`text-xs ${status.ok ? 'text-green-ink' : 'text-red-600'}`}>{status.message}</span>
          )}
        </div>
      </div>
    </div>
  );
}
