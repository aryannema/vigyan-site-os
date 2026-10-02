/**
 * Minimal direct Resend API sender for transactional emails OUTSIDE GoTrue's
 * own auth flow (signup confirmation, password reset already go through
 * GoTrue's SMTP config directly — see docs/OPS.md §11). This is for emails
 * this app itself needs to originate, starting with the account-deletion
 * confirmation link (api/account-deletion/request).
 *
 * SERVER ONLY — RESEND_API_KEY must never reach the browser.
 */

import { getSecret } from '@/lib/app-secrets';

const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS || 'YourSite <noreply@mail.example.com>';

export interface EmailAttachment {
  filename: string;
  /** Raw bytes; base64-encoded here rather than by every caller. */
  content: Buffer;
}

export async function sendTransactionalEmail(
  to: string,
  subject: string,
  html: string,
  attachments?: EmailAttachment[],
): Promise<{ success: boolean; error?: string }> {
  // Read through app_secrets, falling back to env (src/lib/app-secrets.ts), so
  // the key can be rotated from the admin panel without a redeploy.
  const RESEND_API_KEY = await getSecret('RESEND_API_KEY');
  if (!RESEND_API_KEY) {
    console.error('[resend-email] RESEND_API_KEY not configured');
    return { success: false, error: 'Email is not configured.' };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });
    if (!res.ok) {
      console.error('[resend-email] send failed:', res.status, await res.text().catch(() => ''));
      return { success: false, error: 'Could not send email.' };
    }
    return { success: true };
  } catch (err) {
    console.error('[resend-email] send threw:', err);
    return { success: false, error: 'Could not send email.' };
  }
}
