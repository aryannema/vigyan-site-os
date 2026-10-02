import { siteConfig } from '@/config/site';
import { getConfigString } from '@/lib/app-config';

/** Digits only, no '+', with a bare 10-digit Indian number promoted to 91xxxxxxxxxx. */
export function normalizeDisplayNumber(raw: string): string {
  const digits = (raw || '').replace(/[^\d]/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

/**
 * The live WABA number every visitor-facing WhatsApp entry point derives from
 * (floating FAB, home CTAs, contact row, footer, tap-to-verify,
 * tap-to-confirm-deletion).
 *
 * DB-backed via public.app_config (migration 028) so changing the WABA number
 * is an edit at /admin/settings, not a code deploy plus an env-var change on
 * one specific host. `siteConfig.links.contact.whatsapp` is now only the
 * fallback for a DB read failure.
 *
 * Why this exists: the 2026-09 WABA migration updated the sending credentials
 * in Coolify but missed this number where it was hardcoded, so outbound sends
 * used the new WABA while every inbound wa.me link pointed at the old, banned
 * one. One source, one place to change.
 *
 * SERVER ONLY (reads the DB). Client components take the resolved string as a
 * prop from their server parent.
 */
export async function getWhatsAppNumber(): Promise<string> {
  const configured = await getConfigString(
    'whatsapp_display_number',
    siteConfig.links.contact.whatsapp || '',
  );
  return normalizeDisplayNumber(configured);
}

/** Pretty form for display in copy, e.g. "+919000000001". */
export function formatWhatsAppNumber(digits: string): string {
  const d = normalizeDisplayNumber(digits);
  if (d.length === 12 && d.startsWith('91')) {
    return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  }
  return d ? `+${d}` : '';
}
