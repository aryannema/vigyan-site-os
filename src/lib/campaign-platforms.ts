// One campaign, one short link per platform. `medium` is a property of the
// platform TYPE (a Quora answer and a Reddit comment are both "community"), so
// reports can roll platforms up without anyone typing it.

export type PlatformGroup = 'Social' | 'Communities' | 'Owned & direct';

export interface CampaignPlatform {
  key: string;
  label: string;
  medium: string;
  group: PlatformGroup;
}

export const CAMPAIGN_PLATFORMS: readonly CampaignPlatform[] = [
  { key: 'linkedin', label: 'LinkedIn', medium: 'social', group: 'Social' },
  { key: 'x', label: 'X', medium: 'social', group: 'Social' },
  { key: 'instagram', label: 'Instagram', medium: 'social', group: 'Social' },
  { key: 'facebook', label: 'Facebook', medium: 'social', group: 'Social' },
  { key: 'youtube', label: 'YouTube', medium: 'social', group: 'Social' },
  { key: 'threads', label: 'Threads', medium: 'social', group: 'Social' },
  { key: 'quora', label: 'Quora', medium: 'community', group: 'Communities' },
  { key: 'reddit', label: 'Reddit', medium: 'community', group: 'Communities' },
  { key: 'hackernews', label: 'Hacker News', medium: 'community', group: 'Communities' },
  { key: 'discord', label: 'Discord', medium: 'community', group: 'Communities' },
  { key: 'github', label: 'GitHub', medium: 'community', group: 'Communities' },
  { key: 'whatsapp', label: 'WhatsApp', medium: 'messaging', group: 'Owned & direct' },
  { key: 'telegram', label: 'Telegram', medium: 'messaging', group: 'Owned & direct' },
  { key: 'email', label: 'Email', medium: 'email', group: 'Owned & direct' },
  { key: 'newsletter', label: 'Newsletter', medium: 'email', group: 'Owned & direct' },
  { key: 'blog', label: 'Blog', medium: 'referral', group: 'Owned & direct' },
] as const;

export const PLATFORM_GROUPS: readonly PlatformGroup[] = ['Social', 'Communities', 'Owned & direct'];

export function platformByKey(key: string): CampaignPlatform | undefined {
  return CAMPAIGN_PLATFORMS.find((p) => p.key === key);
}

/** Slug for one platform's link: `<campaign>-<platform>`, at most 80 chars. */
export function campaignLinkSlug(campaignSlug: string, platformKey: string): string {
  const suffix = `-${platformKey}`;
  return `${campaignSlug.slice(0, 80 - suffix.length).replace(/-+$/, '')}${suffix}`;
}
