import { beforeEach, describe, expect, it, vi } from 'vitest';

const result: Record<string, { data: unknown[] | null }> = {};
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        limit: async () => {
          if (result[table] === undefined) throw new Error('db down');
          return result[table];
        },
      };
      return chain;
    },
  },
}));

beforeEach(() => {
  vi.resetModules();
  for (const k of Object.keys(result)) delete result[k];
});

describe('sitePagesContext', () => {
  it('lists published landing pages and active products with links', async () => {
    result.landing_pages = { data: [{ slug: 'ai-audit', title: 'AI Audit', subtitle: 'Find waste', seo_description: null }] };
    result.products = { data: [{ slug: 'sample-app', title: 'Sample App', description: 'Voice transcription' }] };
    const { sitePagesContext } = await import('./site-pages-context');
    const text = await sitePagesContext();
    expect(text).toContain('- AI Audit — Find waste (https://www.example.com/services/ai-audit)');
    expect(text).toContain('- Product: Sample App — Voice transcription (https://www.example.com/products/sample-app)');
  });

  it('returns empty instead of throwing when the database is unreachable', async () => {
    const { sitePagesContext } = await import('./site-pages-context');
    await expect(sitePagesContext()).resolves.toBe('');
  });
});
