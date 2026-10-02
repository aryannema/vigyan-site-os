import { describe, expect, it } from 'vitest';
import { markdownToBlocks } from './markdown';
import { parseYouTubeId } from './video';

describe('parseYouTubeId', () => {
  it('reads common forms and rejects others', () => {
    for (const u of ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ']) {
      expect(parseYouTubeId(u)).toBe('dQw4w9WgXcQ');
    }
    expect(parseYouTubeId('https://evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('javascript:alert(1)')).toBeNull();
    expect(parseYouTubeId('https://www.youtube.com/watch?v=short')).toBeNull();
  });
});

describe('markdownToBlocks', () => {
  it('converts a typical article', () => {
    const r = markdownToBlocks(`---
title: Ignored by body
description: A summary
---
# Real Title

Intro with **bold** and [a link](/x).

## Steps

- one
- two

1. first
2. second

> Quote text
> — Someone

![Diagram](https://example.com/a.png "A caption")

https://youtu.be/dQw4w9WgXcQ

\`\`\`ts title="a.ts"
const x = 1;
\`\`\`
`);
    expect(r.meta.description).toBe('A summary');
    expect(r.meta.title).toBe('Ignored by body');
    expect(r.blocks.map((b) => b.type)).toEqual(['paragraph', 'heading', 'list', 'list', 'quote', 'image', 'video', 'code']);
    expect(r.blocks[3]).toMatchObject({ ordered: true });
    expect(r.blocks[4]).toMatchObject({ attribution: 'Someone' });
    expect(r.blocks[5]).toMatchObject({ caption: 'A caption' });
    expect(r.blocks[7]).toMatchObject({ language: 'ts', filename: 'a.ts' });
  });

  it('uses a lone leading # as the title', () => {
    const r = markdownToBlocks('# Hello\n\ntext');
    expect(r.meta.title).toBe('Hello');
    expect(r.blocks).toHaveLength(1);
  });

  it('reads MDX media tags and never keeps import/export or unknown tags', () => {
    const r = markdownToBlocks(`import X from './x'

<Video url="https://youtu.be/dQw4w9WgXcQ" title="Demo" caption="Watch" />

<Image src="/a.png" alt="A" />

<script>alert(1)</script>
`);
    expect(r.blocks.map((b) => b.type)).toEqual(['video', 'image']);
    expect(r.blocks[0]).toMatchObject({ title: 'Demo', caption: 'Watch' });
    expect(r.warnings.join(' ')).toMatch(/MDX statement/);
  });

  it('skips unsafe media urls instead of importing them', () => {
    const r = markdownToBlocks('![x](javascript:alert(1))\n\n<Video url="https://evil.example/v" title="t" />');
    expect(r.blocks).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
