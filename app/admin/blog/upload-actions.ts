'use server';

/**
 * Local file upload for the editor's Image tool — goes to Supabase Storage
 * (bucket `post-images`, public, 10MB limit, image mime types only). Uses the
 * Storage REST API directly via `fetch` with the service-role key — no
 * `@supabase/supabase-js` client, consistent with the rest of this app (raw
 * `pg` for the database, raw REST for Gemini, raw REST here).
 *
 * Auth: this is a Server Action, so it only runs for a request that already
 * passed middleware's session check for /admin/*. It does not itself verify
 * a capability — image upload is treated as part of "can edit a post," which
 * every path that reaches this form already required.
 */

const BUCKET = 'post-images';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.');
  return url;
}

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured.');
  return key;
}

function safeFileName(originalName: string): string {
  const ext = (originalName.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const random = crypto.randomUUID();
  return `${random}.${ext}`;
}

export async function uploadPostImage(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'No file provided.' };

  if (file.size === 0) return { ok: false, error: 'That file is empty.' };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `File is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 10MB.` };
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: `File type "${file.type || 'unknown'}" is not allowed. Use PNG, JPEG, WebP, GIF, or SVG.` };
  }

  const path = safeFileName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const response = await fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceRoleKey()}`,
        'Content-Type': file.type,
        'x-upsert': 'false',
      },
      body: bytes,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, error: `Upload failed (${response.status}): ${body.slice(0, 200)}` };
    }

    return { ok: true, url: `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${path}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Upload failed.' };
  }
}
