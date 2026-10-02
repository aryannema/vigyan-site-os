import { GetObjectCommand, PutObjectCommand, S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { getSecret } from '@/lib/app-secrets';

/**
 * Cloudflare R2 — where downloadable files live.
 *
 * R2 speaks the S3 API, so the AWS SDK talks to it unchanged; only the endpoint
 * differs. Chosen over storing files in Postgres because a lead magnet or an
 * app build is a large binary, and a database that is backed up nightly is the
 * wrong place for those.
 *
 * Egress is free on R2, which is the reason it is worth a second service at
 * all: S3 charges roughly $0.09 per GB to send the same bytes out, so a
 * 200 MB build downloaded a thousand times costs about $18 there and nothing
 * here.
 *
 * NOTHING IS EVER PUBLIC. Buyers receive a signed URL that expires in minutes;
 * a permanent public link is the thing this avoids, because one buyer sharing
 * it puts the file beyond recall.
 *
 * SERVER ONLY.
 */

let cached: { client: S3Client; bucket: string } | null = null;

async function r2(): Promise<{ client: S3Client; bucket: string } | null> {
  if (cached) return cached;

  const [accountId, accessKeyId, secretAccessKey, bucket] = await Promise.all([
    getSecret('R2_ACCOUNT_ID'),
    getSecret('R2_ACCESS_KEY_ID'),
    getSecret('R2_SECRET_ACCESS_KEY'),
    getSecret('R2_BUCKET'),
  ]);

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  cached = {
    bucket,
    client: new S3Client({
      // R2 is single-region by design; 'auto' is what Cloudflare documents.
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
  return cached;
}

/** Whether R2 is configured. Lets callers fall back rather than throw. */
export async function r2Configured(): Promise<boolean> {
  return (await r2()) !== null;
}

/**
 * A link to one object, good for a few minutes.
 *
 * Short on purpose. Long enough to click and for a download to start, short
 * enough that a forwarded link is dead before it is useful. The download itself
 * continues even if the URL expires mid-transfer -- expiry is checked when the
 * request is made, not throughout.
 */
export async function signedDownloadUrl(
  key: string,
  opts: { expiresInSeconds?: number; filename?: string } = {},
): Promise<string> {
  const conn = await r2();
  if (!conn) throw new Error('R2 is not configured — set the R2_* secrets at /admin/settings/secrets.');

  return getSignedUrl(
    conn.client,
    new GetObjectCommand({
      Bucket: conn.bucket,
      Key: key,
      // Makes the browser save it under a sensible name rather than the key.
      ResponseContentDisposition: opts.filename
        ? `attachment; filename="${opts.filename.replace(/"/g, '')}"`
        : undefined,
    }),
    { expiresIn: opts.expiresInSeconds ?? 300 },
  );
}

export async function uploadObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const conn = await r2();
  if (!conn) throw new Error('R2 is not configured.');

  await conn.client.send(
    new PutObjectCommand({
      Bucket: conn.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  const conn = await r2();
  if (!conn) throw new Error('R2 is not configured.');
  await conn.client.send(new DeleteObjectCommand({ Bucket: conn.bucket, Key: key }));
}

/**
 * A key that does not leak what it holds.
 *
 * Product slug and filename are fine -- the bucket is private and the URL is
 * signed -- but a version segment keeps replacing a build from overwriting the
 * copy existing buyers are still downloading.
 */
export function objectKey(productSlug: string, version: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${productSlug}/${version}/${safe}`;
}
