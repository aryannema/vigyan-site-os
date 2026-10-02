# Content format

How rich text is stored and rendered in this template. If you are adopting
`vigyan-site-os` and want to write content — by hand, from an admin UI, or from
an LLM through an MCP tool — this is the document to read.

Everything described here lives in `lib/content/`. Nothing in it is required by
the database: `types/schema.ts` types `posts.content_blocks` as a loose
`ContentBlock { type: string; ... }` and `site_content.content_data` as plain
JSON, on purpose. This directory is the **reference narrowing** of those loose
types. Replace it wholesale if your deployment wants a different block set.

---

## 1. The one-paragraph version

Content is an **array of typed JSON blocks**. Block structure is *never*
Markdown. Inside a block, prose fields may use a **four-construct inline
Markdown subset** — `**bold**`, `_italic_`, `` `code` ``, `[text](url)` — and
nothing else. Anything outside that subset renders as plain text.

```json
[
  { "type": "heading", "text": "Getting started", "level": 2 },
  { "type": "paragraph", "text": "Run `pnpm dev`, then read the **[docs](/docs)**." }
]
```

## 2. Why it is split that way

Two things need to agree on one canonical format:

- **LLM / MCP writers.** Models are fluent in Markdown and fight any bespoke
  inline representation (a `{ "marks": [...] }` array gets malformed constantly).
  They are, however, perfectly happy to emit JSON *structure*.
- **A future WYSIWYG editor.** An editor needs stable, addressable block
  boundaries — a block id to attach a drag handle to, a schema to validate a
  paste against. A single Markdown string gives it none of that.

Typed blocks satisfy the editor; an inline Markdown string inside each block
satisfies the model. And restricting the inline subset to four constructs keeps
rendering safe: there is no raw HTML, no MDX/JSX, and therefore no way for
generated content to execute anything. See §6.

The alternative — storing whole posts as one Markdown document — was rejected
because block-level structure then only exists as a parse result, so nothing can
validate it, address it, or render an image block with a real `<figure>`.

---

## 3. Block reference

Defined in [`blocks.ts`](./blocks.ts) as a discriminated union on `type`, with a
matching zod schema. **Unknown keys are rejected** — `{"type":"image","src":...}`
is an error, not a silently-ignored typo.

| `type` | Required | Optional | Inline-formatted fields |
| --- | --- | --- | --- |
| `paragraph` | `text` | — | `text` |
| `heading` | `text` | `level` (2–6, default 2) | `text` |
| `list` | `items` (≥1) | `ordered` (default false) | every item |
| `quote` | `text` | `attribution` | `text`, `attribution` |
| `image` | `url`, `alt` | `caption` | `caption` only |
| `code` | `text` | `language`, `filename` | **none — verbatim** |

Three rules worth stating explicitly:

- **`heading.level` starts at 2.** The page or post title owns the single `<h1>`.
  `level: 1` is a validation error, not a warning.
- **`image.alt` is required and is not Markdown.** It lands in an HTML attribute,
  where markup is meaningless. `""` is allowed and is the correct value for a
  decorative image; *omitting* it is always a bug, so the schema rejects that.
- **`code.text` is never Markdown-parsed.** Code samples are full of backticks,
  asterisks and underscores that must survive untouched.

The machine-readable form of the last column is exported as
`INLINE_FORMATTED_FIELDS`, so an editor or MCP tool description can read it
rather than re-deriving it.

### URLs

`image.url` and every `[text](url)` href must satisfy `isSafeUrl()`:

- **Allowed:** `http:`, `https:`, `mailto:`, `tel:`, and relative forms —
  `/about`, `./x`, `../x`, `plain/path`, `#anchor`, `?q=1`.
- **Rejected:** `javascript:`, `data:`, `vbscript:`, `file:`, any other scheme,
  protocol-relative `//host`, anything containing a control character, and `""`.

The same predicate runs at write time (block validation) and at read time
(`urlTransform` in the renderer), so the two can never drift apart.

---

## 4. The inline subset

**This is the complete list. There is nothing else.**

| Write | Renders | Notes |
| --- | --- | --- |
| `**bold**` | `<strong>` | |
| `_italic_` or `*italic*` | `<em>` | |
| `` `code` `` | `<code>` | |
| `[text](url)` | `<a href>` | url must pass `isSafeUrl`; absolute `http(s)` links get `target="_blank" rel="noopener noreferrer"` |

Everything else **degrades to plain text**. It does not throw, it does not
render, and (since it becomes a text node) it is not silently deleted either:

| Write | You get |
| --- | --- |
| `# Heading` | the text `Heading` — no `<h1>` |
| `- one`<br>`- two` | the lines as text — no `<ul>` |
| `> quoted` | the text `quoted` — no `<blockquote>` |
| `---` | nothing — no `<hr>` |
| `![alt](url)` | nothing — use an `image` block |
| `<b>x</b>` | the literal characters `<b>x</b>`, escaped |
| `<script>alert(1)</script>` | the literal characters, escaped |
| `[x](javascript:alert(1))` | the text `x`, with no `href` at all |
| `~~strike~~`, tables, footnotes | literal text (no `remark-gfm`) |

To use a block-level construct, **use a block** — that is the whole design.

### Escaping

Standard CommonMark backslash escaping works: `\*not italic\*`, `` \` ``,
`\[not a link\]`. To show a literal `<`, just type it — raw HTML is rendered as
escaped text (see §6), so nothing is lost.

---

## 5. Worked examples

Every HTML fragment below is the **actual** output of
`renderToStaticMarkup(<BlockRenderer blocks={…} />)`, with `class` attributes
and React's own `<link rel="preload">` resource hints removed for readability.

### Example 1 — the common case

```json
[
  { "type": "heading", "text": "Why blocks, not Markdown", "level": 2 },
  {
    "type": "paragraph",
    "text": "Structure is **JSON**; only _inline_ formatting is Markdown. Run `pnpm dev`, then read the [format spec](/docs/format)."
  },
  {
    "type": "list",
    "items": ["Bold with `**`", "Links with `[text](url)`"]
  }
]
```

renders as

```html
<div>
  <h2>Why blocks, not Markdown</h2>
  <p>Structure is <strong>JSON</strong>; only <em>inline</em> formatting is Markdown.
     Run <code>pnpm dev</code>, then read the <a href="/docs/format">format spec</a>.</p>
  <ul>
    <li>Bold with <code>**</code></li>
    <li>Links with <code>[text](url)</code></li>
  </ul>
</div>
```

Note the second list item: inside a code span, `[text](url)` is *not* a link.

### Example 2 — quote, image, code

```json
[
  {
    "type": "quote",
    "text": "Make it **work**, then make it fast.",
    "attribution": "folklore"
  },
  {
    "type": "image",
    "url": "/media/pipeline.png",
    "alt": "Content pipeline",
    "caption": "Figure _1_: MCP writer to renderer."
  },
  {
    "type": "code",
    "language": "ts",
    "filename": "app/blog/[slug]/page.tsx",
    "text": "const blocks = parseBlocks(input);\nif (a < b) render(blocks);"
  }
]
```

renders as

```html
<div>
  <blockquote>
    <p>Make it <strong>work</strong>, then make it fast.</p>
    <footer><span aria-hidden="true">— </span><cite>folklore</cite></footer>
  </blockquote>
  <figure>
    <img src="/media/pipeline.png" alt="Content pipeline"/>
    <figcaption>Figure <em>1</em>: MCP writer to renderer.</figcaption>
  </figure>
  <div>
    <div>app/blog/[slug]/page.tsx</div>
    <pre><code>const blocks = parseBlocks(input);
if (a &lt; b) render(blocks);</code></pre>
  </div>
</div>
```

The `<` in the code sample is escaped by React; the sample itself is untouched.

### Example 3 — hostile and malformed input

Everything an LLM might emit by accident, and everything an attacker might emit
on purpose, in one document:

```json
[
  { "type": "paragraph", "text": "Hi <script>alert(1)</script> and <b>raw</b>." },
  { "type": "paragraph", "text": "# Not a heading" },
  { "type": "paragraph", "text": "A [trap](javascript:alert(1)) here." },
  { "type": "paragraph", "text": "- not a list\n- really" },
  { "type": "paragraph", "text": "<img src=x onerror=\"alert(1)\">" }
]
```

renders as

```html
<div>
  <p>Hi &lt;script&gt;alert(1)&lt;/script&gt; and &lt;b&gt;raw&lt;/b&gt;.</p>
  <p>Not a heading</p>
  <p>A trap here.</p>
  <p>not a list
really</p>
  <p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</p>
</div>
```

No element is created for any of it. The `javascript:` link keeps its label and
loses its `href` entirely, so the reader still sees the author's words but has
nothing to click.

---

## 6. Security model

`FormattedText.tsx` is the **only** place inline Markdown is parsed, and it is
the security boundary. Five things hold it up:

1. **Element allow-list.** `allowedElements={['strong','em','code','a']}` with
   `unwrapDisallowed`. Anything else is replaced by its own children — which is
   what makes unsupported syntax degrade to text rather than error or vanish.
2. **No raw HTML as HTML.** `rehype-raw` is absent and `skipHtml` is set. A
   local mdast→hast handler turns raw HTML nodes into **text** nodes, so React
   escapes them: `<script>` is displayed, not executed, and — unlike the library
   default, which drops the node — the author's characters are not lost.
3. **No plugins.** `remarkPlugins={[]}`, `rehypePlugins={[]}`. The plugin list
   is the attack surface; an empty one is the only one that stays safe as
   dependencies move. (This is also why there are no tables or task lists.)
4. **URL allow-list.** `urlTransform` runs `isSafeUrl` on every href, dropping
   the attribute rather than the text.
5. **No `dangerouslySetInnerHTML` anywhere in `lib/content/`.** Everything else
   is React's own escaping, which handles attribute contexts (`alt`, `title`)
   correctly and for free.

What this does *not* protect against, by design: an author with `blog:edit`
writing a link to a phishing site. Content authorship is governed by the
capability system (`003_role_expansion.sql`), not by the renderer.

`content.test.tsx` asserts all of the above against real rendered output,
including a fully hostile document. Note the assertion style there: because
hostile HTML degrades to *visible escaped text*, the word `onerror` is expected
to appear in the output. The test asserts that no **element** carrying an event
handler exists — matching on the un-escaped `<` — which is the property that
actually matters.

---

## 7. Using it

```tsx
import { BlockRenderer } from '@/lib/content/renderer';

export default async function PostPage({ params }) {
  const post = await getPost(params.slug);
  return <BlockRenderer blocks={post.content_blocks} />;
}
```

`BlockRenderer` takes the loose `ContentBlock[]` straight off the row. Invalid
blocks are **dropped** with a dev-mode warning rather than failing the render — a
typo in block 5 of a published post should cost block 5, not the article.

Write paths should be strict instead:

```ts
import { parseBlocks, safeParseBlocks } from '@/lib/content/blocks';

const blocks = parseBlocks(toolArguments.content_blocks); // throws on bad input

const result = safeParseBlocks(formJson);                 // or collect problems
if (!result.ok) return { errors: result.errors };         // ["[1].text: ..."]
```

Other exports worth knowing:

| Export | Use |
| --- | --- |
| `isBlock`, `isBlockOfType`, `isBlockArray` | type guards |
| `narrowBlocks(blocks, onInvalid?)` | lenient read-path narrowing |
| `isSafeUrl(url)` | validate a URL with the renderer's own rule |
| `blocksToPlainText(blocks)` | SEO descriptions, excerpts, search indexes |
| `stripInlineMarkdown(text)` | one field's plain-text projection |
| `BlockView` | render a single block |

Customising the output without forking:

```tsx
<BlockRenderer
  blocks={post.content_blocks}
  classNames={{ paragraph: 'text-lg leading-8' }}
  components={{ image: MyNextImageBlock }}
/>
```

Everything renders on the server — no `'use client'`, no JavaScript shipped for
the read path.

### Tests

```sh
pnpm vitest run lib/content        # this module only
pnpm test                          # the whole suite
```

`content.test.tsx` covers the format and the security contract;
`serialization.test.tsx` covers sections and the Tiptap round trip. Both assert
against real rendered HTML rather than mocks — the point of the exercise is what
actually reaches the browser.

---

## 8. Section content (`site_content`)

`posts.content_blocks` is always a block array. `site_content.content_data` is a
free-form JSON object per section, and this template does not dictate its shape.
[`sections.ts`](./sections.ts) provides the reference vocabulary — small typed
section shapes (`text`, `heading`, `richText`, `list`, `cta`, `image`, `style`)
with zod schemas and a registry — so a deployment declares its sections in one
place and both the admin UI and MCP tools read that declaration.

A `richText` section is `{ "blocks": [ ... ] }` — the exact same block array,
same renderer, same inline subset. That is the point of keeping the two systems
on one format.

---

## 9. WYSIWYG / Tiptap

[`tiptap.ts`](./tiptap.ts) sketches the serialisation contract between this
format and Tiptap's ProseMirror JSON, so a human editor and an MCP writer stay
on one canonical representation: blocks map to ProseMirror nodes, and the inline
subset maps to ProseMirror marks (`bold`, `italic`, `code`, `link`). Round-trip
tests live alongside the rest. Read the header comment there for what is
deliberately lossy.
