# SEO playbook — example.com

What is automated, what is manual, and how to check a page or a whole site. The
agent-runnable version is `.claude/skills/seo-launch/SKILL.md`.

## 1. Publish pipeline (automatic)

Every admin/MCP/cron change calls `revalidateFor()` (`src/lib/content-revalidation.ts`):

1. Next cache refresh for the affected paths (`revalidatePath`).
2. Cloudflare purge of those URLs (nav/flag changes: purge everything).
3. Warm fetch of each URL, `/sitemap.xml` and `/llms.txt`, so the edge holds the fresh render.
4. IndexNow ping (Bing, Yandex) and GSC sitemap resubmit.

Kinds that ping engines: blog_post, product, job, section, landing_page. Nav and flag changes purge
and revalidate but do not ping (no new URL).

Requires `CLOUDFLARE_CACHE_PURGE_TOKEN` and `CLOUDFLARE_ZONE_ID` in `app_secrets`. Without them the
purge is a silent no-op and only the short revalidate window applies. Verify: publish, then
`curl -sI <url> | grep cf-cache-status` should not show a stale HIT.

## 2. Automation matrix

| Channel | Automated | Manual |
|---|---|---|
| Sitemap | Generated from DB, revalidated on publish | none |
| Bing / Yandex | IndexNow per URL | one-time site verification in Bing Webmaster |
| Google sitemap | Resubmitted via Search Console API | none |
| Google per-URL | none — Indexing API is JobPosting-only | "Request Indexing" in GSC, key URLs only |
| Cloudflare | Purge + warm on publish | one Cache Rule ignoring `utm_*` (open TODO) |
| Backlinks | Drafts and syndication copy can be prepared | Posting to Reddit, Quora, HN, directories |

Do not automate posting to Reddit/Quora/HN: their rules prohibit it and accounts get banned.

## 3. Internal links

An internal link is a link from one of your own pages to another. It is how Google finds a page and
how authority flows to it. A page nothing links to is an orphan.

Where they come from in this system:
- Header menu (`/admin/nav`, two levels): target a route, URL, landing page or product.
- Footer.
- Links inside post/landing-page bodies (Markdown or blocks).
- Blog index and homepage recent-posts list (automatic for posts).

Rule: every new post or landing page gets at least two links from existing pages the same day, one of
them from a high-traffic page (homepage, blog index, or the menu).

## 4. Per-page checklist

- One `<h1>`, unique `<title>` (≤60 chars) and description (≤160), canonical URL.
- Server-rendered HTML with the body text present in `curl` output.
- JSON-LD that matches visible content: Article, Product, Service; VideoObject once added.
- Descriptive image `alt`; YouTube embeds via `youtube-nocookie.com`.
- 200 status, listed in sitemap, not `noindex`.
- `Cache-Control` with `s-maxage`; never `no-store` on public pages.

## 5. New-site launch order

1. Deploy; verify 200s, robots.txt, sitemap, canonical host (apex 301 to www).
2. Verify the property in GSC and Bing Webmaster; submit sitemap in both.
3. Cloudflare: cache rules, purge token and zone id in `app_secrets`.
4. Publish content; link it internally; run the publish pipeline.
5. GSC "Request Indexing" on the homepage and 3–5 key URLs.
6. Start backlinks (section 6). Recheck GSC Crawl stats after a week.

## 6. Backlinks

Value order: relevant, editorial, followed links > directories > profile links.

- Syndicate posts to Medium, Dev.to, Hashnode, LinkedIn Articles with `canonical` pointing at your post.
- Reddit (r/n8n, r/LocalLLaMA, r/SaaS, r/indiehackers, r/smallbusiness): contribute first, link rarely.
- Quora answers (nofollow, but traffic and brand search).
- Hacker News "Show HN" for real products or writeups.
- Product Hunt, BetaList, AlternativeTo, G2/Capterra, Crunchbase, Clutch listings.
- India: YourStory, Inc42, Analytics India Magazine contributed pieces.
- GitHub READMEs and open-source repos that link the site; YouTube descriptions; podcast guest spots.

Track each link: date, URL, anchor, followed or not. Campaign links use `/go/<slug>` (UTM per
platform; `/admin/links/campaign`), one link per platform pointing at the same landing page.

## 7. Known gaps

- Sitemap stamps `now` as `lastmod` on static routes; use real dates.
- Landing pages are fixed at `/services/<slug>` until the path-prefix work (migration 079) lands.
- No VideoObject JSON-LD yet.
