---
name: seo-optimize
description: Use when auditing or improving example.com's SEO/indexing — Google Search Console issues (404s, sitemap, "discovered not indexed"), on-page checks (title/meta/canonical/OG/H1/internal links), or wiring search-engine notification (IndexNow/GSC/Bing/Yandex). Also use when the operator pastes GSC findings and asks to fix + validate.
---

# SEO audit & indexing pipeline — site-os

Built from the 2026-09-08 session that fixed a legacy `/home` 404, corrected the
footer/JSON-LD legal entity, audited the 9 marketing pages GSC flagged as
"Discovered - currently not indexed", and wired IndexNow. See
`docs/OPS.md` §9 for the full incident record and current on-page findings —
this file is the repeatable *process*, that doc is the *state*.

## 1. On-page audit process (per URL)

Don't guess from rendered HTML alone — cross-check against the source, since
this app mixes pages that set their own `metadata` export with pages that
silently inherit the parent layout's default (a real bug class here, see §3).

For each URL:
1. `curl -s -D headers.txt -o page.html -w "%{http_code}\n" <url>` — confirm
   200, not a redirect/error.
2. Confirm it's actually server-rendered, not a client-only shell: grep the
   raw HTML for real body text before assuming `curl` is only seeing an empty
   `<div id="__next">`. In this app every marketing page is an `async`
   Server Component (no `"use client"`), so this should always pass — if it
   doesn't, that's a bug, not expected behavior.
3. Extract and check:
   - `<title>` — present, unique, under ~60 chars, includes page topic + brand.
   - `<meta name="description">` — present, unique, under ~160 chars,
     page-specific (not the homepage's generic description).
   - Exactly one `<h1>`; H2/H3 nest without skipping levels.
   - `<link rel="canonical">` — **now emitted** on blog posts (per-post, via
     `generateMetadata`) and on the four pages using `pageMetadata()`, always
     ABSOLUTE, which is what fixes the apex/www and tracking-parameter
     duplicates GSC flags separately. Re-check coverage each audit: pages still
     on a static `metadata` export may emit a relative canonical or none.
   - `og:title`/`og:description`/`og:image` — present but currently
     **static site-wide**, defined once via `metadata.openGraph` in
     `src/app/layout.tsx` (separate from that same file's
     `organizationJsonLd` block, which is JSON-LD, not OG tags). No page
     currently overrides it.
   - Image `alt` text on meaningful images. The two global icon images
     (header logo `alt=""`, footer badge `alt="YourSite"`) are correct as
     shipped — decorative icon next to visible brand text is the right
     pattern, don't flag it.
4. Internal linking — grep, don't assume:
   `grep -rn "[\"'\`]/<path>[\"'\`/]" src/ --include="*.tsx" --include="*.ts"`
   A page reachable only via `src/app/sitemap.ts` and nowhere else
   (no header nav, no footer, no CTA) is an orphan — Google deprioritizes
   crawling pages with zero internal PageRank flow even after discovering
   them via the sitemap. As of 2026-09-08: `/privacy`, `/terms`,
   `/data-deletion`, `/voice` are orphans; `/services` is well-linked
   (header nav + `CTASection` + homepage).
5. Word count / thin-content check — strip `<script>`/`<style>`/tags from the
   `<body>`, count words. Distinguish a genuine WIP stub (e.g. `/voice`'s
   "coming soon" copy) from a page that's thin only because of *live DB
   state* (e.g. `/careers` renders "No open roles right now" when
   `job_openings` has zero `status='open'` rows — the code isn't broken,
   the data is empty).

## 1.5 Where metadata now lives (changed 2026-09-28)

Per-page metadata is no longer only a `.tsx` constant. `src/lib/page-seo.ts`
exposes `pageMetadata(path, fallback)`, which reads
`site_content['page_seo'][path]` and falls back to the hardcoded value.

Why it matters for this process: **SEO copy is tuned against GSC data.** A
title with impressions but no clicks needs rewording; a description Google keeps
replacing needs shortening. Hardcoded, each iteration is a deploy — so in
practice it never happens. Editable, the loop closes.

```ts
export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata('/privacy', {
    title: 'Privacy Policy',
    description: 'How … collects, uses, and protects your data.',
  });
}
```

Three properties to preserve when extending this to more pages:

- **No extra query.** `pageMetadata` goes through `getSectionContent`, which
  uses `loadAllContent` — already fetching every `site_content` row once per
  request. The SEO row rides along.
- **The fallback is mandatory.** An empty table or unreachable DB must never
  strip a title; a crawl landing during an outage would record the blank
  version, outliving the outage.
- **`noindex` is per-page and DB-driven**, so a stub like `/voice` can be kept
  out of the index and flipped when it ships, without a deploy.

Applied so far: `/privacy`, `/terms`, `/data-deletion`, `/voice`. Blog posts use
their own `generateMetadata` (per-post, from the row). Everything else still
uses a static export — migrate as you touch them.

## 2. Known bug class: missing per-page `metadata` export

`src/app/(marketing)/about/page.tsx`, `blog/page.tsx`, `contact/page.tsx`,
`services/page.tsx` have **no `export const metadata`**. Both
`src/app/layout.tsx` and `src/app/(marketing)/layout.tsx` independently
define `title: { default: siteConfig.name, template: '%s | ${siteConfig.name}' }`.
With no page override, the child layout's default gets fed through the
template again, producing the literal rendered title `"YourSite | YourSite"`
plus the homepage's generic description — a real duplicate-title/description
bug across 4 live URLs, not just an SEO nicety. Fix pattern (see
`careers/page.tsx` for a correct example already in the codebase):

```ts
export const metadata: Metadata = {
  title: 'Page Topic',                    // becomes "Page Topic | YourSite"
  description: 'Specific, <160-char description of THIS page.',
};
```

Before declaring this fixed, re-run the audit in §1 against the live URL —
`grep` the source is necessary but not sufficient; Next.js's title-template
double-application only shows up in the rendered `<title>`.

## 3. Search-engine notification: what's automated vs. manual

| Engine | Programmatic push for new/updated URLs | Auth needed | Status in this repo |
|---|---|---|---|
| Bing | IndexNow (`api.indexnow.org/indexnow`) | none — key file hosted at `public/<key>.txt` | **Wired** — `src/lib/indexnow.ts`, called from `onBlogPostPublished()` (blog-publish-hooks.ts, covers cron/admin-UI/MCP publish paths) and from `create_job`/`update_job` in `src/app/api/mcp/route.ts` |
| Yandex | Same IndexNow call (Yandex also consumes `api.indexnow.org`) | none | Covered by the same wiring above |
| Google | **No general-purpose push API.** The Indexing API exists but Google restricts it to `JobPosting`/`BroadcastEvent` structured data only — using it for ordinary pages isn't supported and risks the account getting flagged. Real levers: (a) GSC's manual "Request Indexing" button, one URL at a time, or (b) `searchanalytics.query` / `urlInspection.index.inspect` via the Search Console API for read-side reporting and live status checks. | Service account (not interactive OAuth — see below) | **Read side wired 2026-09-08** — `/admin/analytics/seo` (clicks/impressions/CTR/position, top queries/pages, per-URL live indexing check). Reuses the GA4 service account; still needs the one-time Search Console access grant, see `docs/OPS.md` §9.3. (a) stays human-only regardless. |

**Extending IndexNow to other content types**: call
`pingIndexNow(['/path-1', '/path-2'])` from `src/lib/indexnow.ts` right after
any DB write that makes a URL live/updated. It's fire-and-forget and never
throws, matching the existing `onBlogPostPublished()` convention — safe to
call inline without awaiting inside a response path.

**If/when GSC API automation is wanted** (sitemap resubmission,
`urlInspection.index.inspect` status checks): use a **Service Account**, not
interactive OAuth — this runs headlessly forever with no repeated login.
One-time setup (needs the operator, not automatable from here):
1. Create a Google Cloud project, enable the Search Console API.
2. Create a Service Account, download its JSON key.
3. In Search Console → Settings → Users and permissions → Add user → paste
   the service account's `...@...iam.gserviceaccount.com` email, Owner or
   Full access.
4. Store the JSON key as a Coolify env var (never commit it), load it
   server-side with `google-auth-library` + `googleapis`.

**Bing Webmaster API** additionally supports `SubmitUrl`/`SubmitUrlBatch`
(a real "please crawl this now" for individual URLs, unlike Google) plus
sitemap submission — auth is a flat API key from the Bing Webmaster Tools
dashboard (Settings → API access), no OAuth flow. Worth wiring only if
IndexNow's coverage (Bing already consumes it) turns out insufficient.

## 4. Validation habits from this session

- After any redirect/config change, the Coolify deploy is not instant —
  poll (`until curl ... | grep -q ...; do sleep 5; done` via a background
  Bash task or Monitor) rather than assuming a push immediately reflects.
- Always confirm the *live* rendered output, not just the source diff —
  Next.js metadata resolution (title templates especially) can produce
  surprises that only show up in actual HTML.
- Check `gh api repos/your-org/site-os/hooks/<id>/deliveries` to
  confirm the GitHub→Coolify webhook actually fired (200) before waiting on
  a deploy that never started.

## 5. What only the operator can do

Everything below needs a human with account access. None of it is automatable
from here, and each blocks a piece of automation that is already written.

### 5.1 Grant the service account WRITE access in Search Console

The reporting client uses `webmasters.readonly`. `resubmitSitemap()` in
`src/lib/search-ping.ts` needs read-write, and fails with a 403 that reads like
an auth bug rather than a missing grant.

1. Google Cloud Console → APIs & Services → Library → enable **Google Search
   Console API** and **Web Search Indexing API**
2. Search Console → Settings → Users and permissions → Add user
3. Paste the service account's `…@….iam.gserviceaccount.com`
4. Permission: **Owner** — not Full. Owner is required for programmatic
   indexing and URL inspection.

Until this is done: sitemap resubmission and URL inspection both fail.

### 5.2 Request indexing by hand, once

For ordinary pages there is **no API**. The Indexing API is restricted to
`JobPosting` and `BroadcastEvent`; using it elsewhere is unsupported and risks
the account. Google has also stated `llms.txt` has no effect on Search, either
way.

So after any fix that changes what a crawler sees — a title, a canonical, a new
sitemap — take the three or four most valuable URLs into **GSC → URL Inspection
→ Request Indexing**. It is the fastest confirmation that a fix worked, and it
is human-only by design.

### 5.3 Decide the internal links

A page reachable only from `sitemap.ts` is an orphan, and a sitemap entry is a
suggestion, not a crawl. `/privacy`, `/terms`, `/data-deletion` and `/voice`
have no inbound links.

This is an editorial decision, not a technical one: where should each page be
linked from, and does it deserve a link at all? A footer link for the legal
pages is usually right. `/voice` is currently `noindex` because it is a stub.

### 5.4 Bing Webmaster API key (optional)

IndexNow already covers Bing and needs no auth. A Bing Webmaster key adds
`SubmitUrl`/`SubmitUrlBatch` and sitemap submission. Settings → API access, flat
key, no OAuth. Only worth it if IndexNow coverage proves insufficient.

### 5.5 Verify a deploy actually happened

Coolify deploys are not instant, and a push that never triggered a build looks
identical to a fix that did not work.

```bash
gh api repos/<owner>/<repo>/hooks/<id>/deliveries      # did the webhook fire 200?
until curl -s https://<domain>/sitemap.xml | grep -q '<loc>.*blog/'; do sleep 5; done
```

## 6. Automation status

| lever | who | status |
|---|---|---|
| Sitemap includes posts/products/jobs | code | done, hourly revalidate |
| Sitemap refreshed on publish | code | done, `revalidatePath('/sitemap.xml')` |
| Per-post metadata + canonical | code | done |
| Page metadata editable from DB | code | done, `page_seo` |
| IndexNow ping (Bing, Yandex) | code | done for blog + jobs; products wired |
| Sitemap resubmission to GSC | code | written, **blocked on 5.1** |
| JobPosting indexing ping | code | written, **blocked on 5.1** |
| Request Indexing for ordinary pages | **human** | no API exists |
| Internal linking | **human** | editorial |
