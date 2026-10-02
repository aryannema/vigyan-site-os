import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendAuthCodeTemplate } from './whatsapp-template';

vi.mock('@/lib/app-secrets', () => ({
  getSecret: async (name: string) => process.env[name] || null,
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sendAuthCodeTemplate', () => {
  it('sends the code in the body and the copy-code button', async () => {
    vi.stubEnv('WHATSAPP_TOKEN', 't');
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] })));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendAuthCodeTemplate({ to: '919800000000', code: '042817', template: 'vb_otp', language: 'en' });

    expect(result).toEqual({ ok: true, id: 'wamid.1' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/123/messages');
    const payload = JSON.parse(init.body);
    expect(payload.type).toBe('template');
    expect(payload.template.name).toBe('vb_otp');
    expect(payload.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '042817' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '042817' }] },
    ]);
  });

  it('returns Meta’s rejection reason', async () => {
    vi.stubEnv('WHATSAPP_TOKEN', 't');
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '123');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Template name does not exist' } }), { status: 404 })),
    );
    const result = await sendAuthCodeTemplate({ to: '1', code: '1', template: 'x', language: 'en' });
    expect(result).toEqual({ ok: false, error: 'Template name does not exist' });
  });

  it('refuses when credentials are missing', async () => {
    vi.stubEnv('WHATSAPP_TOKEN', '');
    const result = await sendAuthCodeTemplate({ to: '1', code: '1', template: 'x', language: 'en' });
    expect(result.ok).toBe(false);
  });
});
