/**
 * src/lib/content/legacy.test.ts — the adapter for pre-existing YourSite rows.
 *
 * `blocks.ts` and its tests are ported verbatim from vigyan-site-os; this file
 * covers the site-os-specific glue, whose whole job is to stop the
 * strict schema from silently deleting content that the Notion sync and blog
 * webhook already wrote. Each case below is a shape those writers really
 * produced.
 *
 * Run:  pnpm test
 */

import { describe, expect, it } from 'vitest';

import { safeParseBlocks } from './blocks';
import { normalizeLegacyBlocks } from './legacy';

/** The property the adapter exists to guarantee. */
const survivesValidation = (input: unknown): boolean =>
  safeParseBlocks(normalizeLegacyBlocks(input)).ok;

describe('normalizeLegacyBlocks', () => {
  it('rescues a level-1 heading, which the strict schema rejects outright', () => {
    const legacy = [{ type: 'heading', level: 1, text: 'Intro' }];

    // Precondition: this really is invalid, so the test is not vacuous.
    expect(safeParseBlocks(legacy).ok).toBe(false);

    expect(normalizeLegacyBlocks(legacy)).toEqual([
      { type: 'heading', level: 2, text: 'Intro' },
    ]);
    expect(survivesValidation(legacy)).toBe(true);
  });

  it('clamps an out-of-range heading level from either end', () => {
    expect(normalizeLegacyBlocks([{ type: 'heading', level: 9, text: 'x' }])).toEqual([
      { type: 'heading', level: 6, text: 'x' },
    ]);
    expect(normalizeLegacyBlocks([{ type: 'heading', level: 0, text: 'x' }])).toEqual([
      { type: 'heading', level: 2, text: 'x' },
    ]);
  });

  it('defaults a missing heading level rather than producing NaN', () => {
    expect(normalizeLegacyBlocks([{ type: 'heading', text: 'x' }])).toEqual([
      { type: 'heading', level: 2, text: 'x' },
    ]);
  });

  it('leaves a valid heading level untouched', () => {
    const blocks = [{ type: 'heading', level: 3, text: 'x' }];
    expect(normalizeLegacyBlocks(blocks)).toEqual(blocks);
  });

  it('supplies the empty alt that a decorative image is missing', () => {
    const legacy = [{ type: 'image', url: '/a.png' }];

    expect(safeParseBlocks(legacy).ok).toBe(false);
    expect(normalizeLegacyBlocks(legacy)).toEqual([
      { type: 'image', url: '/a.png', alt: '' },
    ]);
    expect(survivesValidation(legacy)).toBe(true);
  });

  it('never overwrites real alt text', () => {
    const blocks = [{ type: 'image', url: '/a.png', alt: 'A chart' }];
    expect(normalizeLegacyBlocks(blocks)).toEqual(blocks);
  });

  it('turns a jsonb null language into an absent one', () => {
    const legacy = [{ type: 'code', text: 'x = 1', language: null }];

    expect(safeParseBlocks(legacy).ok).toBe(false);
    expect(survivesValidation(legacy)).toBe(true);
  });

  it('passes canonical blocks through unchanged', () => {
    const blocks = [
      { type: 'paragraph', text: 'Hello **world**' },
      { type: 'list', items: ['a', 'b'], ordered: true },
      { type: 'quote', text: 'Quoted', attribution: 'Someone' },
    ];
    expect(normalizeLegacyBlocks(blocks)).toEqual(blocks);
    expect(survivesValidation(blocks)).toBe(true);
  });

  it('does not resurrect blocks that are broken beyond repair', () => {
    // An image with no url has no single correct fix, so it must still fail
    // validation (and be dropped by the renderer) rather than be invented.
    expect(survivesValidation([{ type: 'image', alt: 'x' }])).toBe(false);
  });

  it('returns an empty array for a NULL/non-array column', () => {
    expect(normalizeLegacyBlocks(null)).toEqual([]);
    expect(normalizeLegacyBlocks(undefined)).toEqual([]);
    expect(normalizeLegacyBlocks({ type: 'paragraph' })).toEqual([]);
  });

  it('drops non-object entries instead of passing them to the validator', () => {
    expect(normalizeLegacyBlocks(['just a string', null, 42])).toEqual([]);
  });
});
