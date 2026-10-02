import { createHash } from 'crypto';

import { getSecret } from '@/lib/app-secrets';
import type { FulfilmentConfig, FulfilmentKind } from '@/lib/fulfilment';
import { signedDownloadUrl } from '@/lib/r2';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * Hands a paid item to the buyer who paid for it.
 *
 * The rule every branch here follows: the buyer never receives a URL that
 * works without us. Either we stream the bytes ourselves, or we hand back a
 * link that expires in minutes. A permanent public URL is the thing we are
 * avoiding -- one buyer shares it and the material is gone, with no way to
 * know it happened.
 *
 * SERVER ONLY.
 */

export interface DeliveryResult {
  kind: 'bytes' | 'redirect' | 'page' | 'manual';
  bytes?: Buffer;
  filename?: string;
  contentType?: string;
  /** Short-lived; never store or email this. */
  url?: string;
  /** For 'manual': what the buyer should be told. */
  message?: string;
}

/**
 * A GitHub release asset from a PRIVATE repository.
 *
 * A public repo's release asset is a public URL -- fine for a free download,
 * useless as a paid one. A private repo's asset cannot be fetched without a
 * token, so the flow is: we check the buyer paid, then WE authenticate to
 * GitHub, and GitHub hands back a signed URL that expires in minutes. The
 * buyer follows that. Our token never leaves the server, and the link they
 * receive is dead shortly after.
 */
async function githubReleaseAsset(
  config: FulfilmentConfig,
): Promise<DeliveryResult> {
  const token = await getSecret('GITHUB_RELEASE_TOKEN');
  if (!token) {
    throw new Error('GITHUB_RELEASE_TOKEN is not configured — cannot fetch the release.');
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  const relRes = await fetch(
    `https://api.github.com/repos/${config.repo}/releases/tags/${config.tag}`,
    { headers },
  );
  if (!relRes.ok) {
    throw new Error(`GitHub release ${config.repo}@${config.tag} not found (${relRes.status}).`);
  }

  const release = await relRes.json();
  const assets: { id: number; name: string }[] = release.assets ?? [];
  // A named asset when one is configured, otherwise the only one. Guessing
  // between several would hand somebody the wrong build.
  const asset = config.asset
    ? assets.find((a) => a.name === config.asset)
    : assets.length === 1
      ? assets[0]
      : undefined;

  if (!asset) {
    throw new Error(
      config.asset
        ? `Release asset "${config.asset}" is not in ${config.tag}.`
        : `Release ${config.tag} has ${assets.length} assets — name which one in the product's settings.`,
    );
  }

  // octet-stream makes GitHub answer with a redirect to a signed, short-lived
  // URL rather than the asset's JSON metadata.
  const dlRes = await fetch(
    `https://api.github.com/repos/${config.repo}/releases/assets/${asset.id}`,
    { headers: { ...headers, Accept: 'application/octet-stream' }, redirect: 'manual' },
  );

  const signed = dlRes.headers.get('location');
  if (!signed) {
    throw new Error('GitHub did not return a download link for that asset.');
  }

  return { kind: 'redirect', url: signed, filename: asset.name };
}

/** A file we host ourselves (product_assets, migration 035). */
async function hostedFile(productId: string): Promise<DeliveryResult> {
  const { data } = await supabaseAdmin
    .from('product_assets')
    .select('filename, content_type, bytes, sha256')
    .eq('product_id', productId)
    .order('position')
    .limit(1)
    .maybeSingle();

  if (!data) throw new Error('No file has been attached to this product yet.');

  const bytes = Buffer.from(data.bytes as unknown as string, 'base64');
  // Stored checksum verified before serving: a corrupted or altered file must
  // not be handed over as genuine.
  if (createHash('sha256').update(bytes).digest('hex') !== data.sha256) {
    throw new Error('That file failed its integrity check and was not served.');
  }

  return {
    kind: 'bytes',
    bytes,
    filename: data.filename,
    contentType: data.content_type,
  };
}

export async function deliver(
  kind: FulfilmentKind,
  config: FulfilmentConfig,
  productId: string,
): Promise<DeliveryResult> {
  switch (kind) {
    case 'hosted_file':
      return hostedFile(productId);
    case 'r2_file': {
      // Signed and short-lived. The bucket is private, so this URL is the only
      // way in and it stops working within minutes.
      const filename = config.key!.split('/').pop();
      return {
        kind: 'redirect',
        url: await signedDownloadUrl(config.key!, { filename }),
        filename,
      };
    }
    case 'github_release':
      return githubReleaseAsset(config);
    case 'notion_page':
      return { kind: 'page', url: `/library/${config.notion_page_id}` };
    case 'private_page':
      return { kind: 'page', url: config.path! };
    case 'external_url':
      // Not a gate -- the destination decides who may open it. Offered only
      // for material that may circulate.
      return { kind: 'redirect', url: config.url! };
    case 'short_link':
      return { kind: 'redirect', url: `/go/${config.slug}` };
    case 'physical':
      return {
        kind: 'manual',
        message: 'This ships to your billing address. We will confirm dispatch by email.',
      };
    case 'service':
      return { kind: 'manual', message: 'We will be in touch to arrange a time.' };
    default:
      return { kind: 'manual', message: 'We will follow up by email.' };
  }
}
