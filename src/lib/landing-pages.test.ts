import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }));

import { landingPageInputSchema, landingPagePath } from './landing-pages';

const valid = {
  title: 'Voice agents for clinics',
  slug: 'voice-agents-clinics',
  subtitle: '',
  body_blocks: [{ type: 'paragraph', text: 'Hello' }],
  seo_title: '',
  seo_description: '',
  og_image_url: '',
  product_id: null,
  cta_label: '',
  cta_url: '',
  status: 'draft',
};

describe('landingPageInputSchema', () => {
  it('accepts a minimal valid page', () => {
    expect(landingPageInputSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects reserved and malformed slugs', () => {
    expect(landingPageInputSchema.safeParse({ ...valid, slug: 'Bad Slug' }).success).toBe(false);
    expect(landingPageInputSchema.safeParse({ ...valid, slug: 'preview' }).success).toBe(false);
  });

  it('rejects unsafe CTA urls', () => {
    expect(landingPageInputSchema.safeParse({ ...valid, cta_url: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('rejects raw html blocks', () => {
    const r = landingPageInputSchema.safeParse({ ...valid, body_blocks: [{ type: 'html', html: '<script>x</script>' }] });
    expect(r.success).toBe(false);
  });

  it('builds the public path', () => {
    expect(landingPagePath('abc')).toBe('/services/abc');
  });
});
