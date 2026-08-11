import { PageHeader } from '../components/PageHeader';
import { listProviderConfigs } from '../blog/ai-actions';
import { ProviderConfigForm } from './ProviderConfigForm';

export const dynamic = 'force-dynamic';

const CAPABILITIES = [
  { key: 'text' as const, label: 'Text (writing assist, titles, keywords)' },
  { key: 'image' as const, label: 'Image generation' },
  { key: 'video' as const, label: 'Video generation' },
];

export default async function AiSettingsPage() {
  const configs = await listProviderConfigs();
  const byCapability = new Map(configs.map((c) => [c.capability, c]));

  return (
    <>
      <PageHeader
        title="AI settings"
        description={
          'Which provider powers each AI capability, and its API key. Keys are stored in ' +
          'a dedicated, admin/service-role-only table (ai_provider_config) -- never readable ' +
          'through the capability system or a browser session, only by this server-side code.'
        }
      />

      <div className="flex flex-col gap-6 max-w-2xl">
        {CAPABILITIES.map(({ key, label }) => (
          <ProviderConfigForm
            key={key}
            capability={key}
            label={label}
            existing={byCapability.get(key) ?? null}
          />
        ))}
      </div>

      <section className="mt-10 max-w-2xl border-t border-border pt-6">
        <h2 className="text-sm font-semibold">Custom webhook contract</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          For operators running their own model (e.g. a local GPU-hosted vLLM/Qwen endpoint,
          reachable via a Tailscale Funnel or similar public tunnel). Your webhook receives a
          POST with <code className="rounded bg-muted px-1">{'{ "prompt": string }'}</code> and
          an optional <code className="rounded bg-muted px-1">Authorization: Bearer &lt;key&gt;</code>{' '}
          header (if a key is set below), and must respond with:
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
          <li>
            <strong className="text-foreground">Text:</strong>{' '}
            <code className="rounded bg-muted px-1">{'{ "text": string }'}</code>
          </li>
          <li>
            <strong className="text-foreground">Image:</strong>{' '}
            <code className="rounded bg-muted px-1">
              {'{ "mimeType": string, "data": string }'}
            </code>{' '}
            — <code className="rounded bg-muted px-1">data</code> is base64-encoded image bytes.
          </li>
        </ul>
      </section>
    </>
  );
}
