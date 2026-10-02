'use server';

/**
 * Read/delete access to the `post-images` Supabase Storage bucket for the
 * admin media library. Same Storage REST API + service-role-key pattern as
 * upload-actions.ts, just the list/delete operations instead of upload.
 */

const BUCKET = 'post-images';

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

export interface StorageObject {
  name: string;
  size: number;
  mimetype: string;
  createdAt: string;
  url: string;
}

export async function listMediaObjects(): Promise<StorageObject[]> {
  const response = await fetch(`${supabaseUrl()}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceRoleKey()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ prefix: '', limit: 200, offset: 0, sortBy: { column: 'created_at', order: 'desc' } }),
  });
  if (!response.ok) return [];

  const rows = (await response.json()) as Array<{
    name: string;
    created_at: string;
    metadata?: { size?: number; mimetype?: string };
  }>;

  return rows
    .filter((row) => row.name !== '.emptyFolderPlaceholder')
    .map((row) => ({
      name: row.name,
      size: row.metadata?.size ?? 0,
      mimetype: row.metadata?.mimetype ?? 'application/octet-stream',
      createdAt: row.created_at,
      url: `${supabaseUrl()}/storage/v1/object/public/${BUCKET}/${row.name}`,
    }));
}

export async function deleteMediaObject(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`${supabaseUrl()}/storage/v1/object/${BUCKET}/${name}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${serviceRoleKey()}` },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { ok: false, error: `Delete failed (${response.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Delete failed.' };
  }
}
