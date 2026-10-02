import { describe, expect, it } from 'vitest';

import { CAMPAIGN_PLATFORMS, campaignLinkSlug } from './campaign-platforms';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('campaignLinkSlug', () => {
  it('joins campaign and platform', () => {
    expect(campaignLinkSlug('calc-launch', 'quora')).toBe('calc-launch-quora');
  });

  it('never exceeds 80 chars and keeps the platform suffix', () => {
    const slug = campaignLinkSlug('a'.repeat(120), 'hackernews');
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-hackernews')).toBe(true);
  });

  it('does not leave a double hyphen when truncating on a hyphen', () => {
    const slug = campaignLinkSlug(`${'a'.repeat(68)}-bbbb`, 'linkedin');
    expect(slug).toMatch(SLUG);
  });

  it('produces a valid, unique slug for every platform', () => {
    const slugs = CAMPAIGN_PLATFORMS.map((p) => campaignLinkSlug('spring-sale', p.key));
    for (const s of slugs) expect(s).toMatch(SLUG);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
