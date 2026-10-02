import { PageHeader } from '../components/PageHeader';
import { listProviderConfigs } from '../blog/ai-actions';
import { ProviderConfigForm } from './ProviderConfigForm';

export const dynamic = 'force-dynamic';

const CAPABILITIES = [
  { key: 'text' as const, label: 'Text (writing assist, titles, keywords)' },
  { key: 'image' as const, label: 'Image generation' },
  { key: 'video' as const, label: 'Video generation' },
  { key: 'whatsapp_chat' as const, label: 'WhatsApp bot (cloud fallback reply)' },
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
          'a dedicated, service-role-only table (ai_provider_config) — never readable ' +
          'through the capability system or a browser session, only by this server-side code.'
        }
      />

      <div className="flex max-w-2xl flex-col gap-6">
        {CAPABILITIES.map(({ key, label }) => (
          <ProviderConfigForm
            key={key}
            capability={key}
            label={label}
            existing={byCapability.get(key) ?? null}
          />
        ))}
      </div>

      <section className="mt-10 max-w-2xl border-t border-hairline pt-6">
        <h2 className="text-sm font-semibold text-ink">Custom webhook contract</h2>
        <p className="mt-1 text-xs text-muted">
          For running your own model — e.g. the YourSite node&apos;s local vLLM/Qwen
          endpoint, reachable via a Tailscale Funnel. Your webhook receives a POST with{' '}
          <code className="rounded bg-sand px-1">{'{ "prompt": string }'}</code> and an
          optional <code className="rounded bg-sand px-1">Authorization: Bearer &lt;key&gt;</code>{' '}
          header (if a key is set above), and must respond with:
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-xs text-muted">
          <li>
            <strong className="text-ink">Text:</strong>{' '}
            <code className="rounded bg-sand px-1">{'{ "text": string }'}</code>
          </li>
          <li>
            <strong className="text-ink">Image:</strong>{' '}
            <code className="rounded bg-sand px-1">
              {'{ "mimeType": string, "data": string }'}
            </code>{' '}
            — <code className="rounded bg-sand px-1">data</code> is base64-encoded image bytes.
          </li>
        </ul>
      </section>
    </>
  );
}
