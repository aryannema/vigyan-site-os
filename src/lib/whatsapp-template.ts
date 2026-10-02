import { getSecret } from '@/lib/app-secrets';
/**
 * SERVER ONLY. Business-initiated WhatsApp sends must use an approved template;
 * a code must use an AUTHENTICATION template. Meta's copy-code button repeats
 * the code as the button's URL parameter.
 */

const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v25.0';

export type TemplateSendResult = { ok: true; id: string } | { ok: false; error: string };

export async function sendAuthCodeTemplate(opts: {
  to: string;
  code: string;
  template: string;
  language: string;
}): Promise<TemplateSendResult> {
  const token = await getSecret('WHATSAPP_TOKEN');
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: 'WhatsApp sending is not configured' };

  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: opts.to,
        type: 'template',
        template: {
          name: opts.template,
          language: { code: opts.language },
          components: [
            { type: 'body', parameters: [{ type: 'text', text: opts.code }] },
            { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: opts.code }] },
          ],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => ({}));
    const id = data?.messages?.[0]?.id;
    if (id) return { ok: true, id };
    const error = data?.error?.error_user_msg || data?.error?.message || `HTTP ${res.status}`;
    console.error('[whatsapp-template] send rejected:', error);
    return { ok: false, error };
  } catch (err) {
    console.error('[whatsapp-template] send failed:', err);
    return { ok: false, error: 'Could not reach WhatsApp' };
  }
}
