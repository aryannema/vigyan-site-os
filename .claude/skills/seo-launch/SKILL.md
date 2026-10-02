---
name: seo-launch
description: Audit a page or the whole yoursite site (or a new site) for indexing readiness — cache headers, sitemap, robots, canonical, JSON-LD, internal links — and check the publish pipeline (Cloudflare purge/warm, IndexNow, GSC, Bing). Use before/after publishing content or launching a site.
---

# seo-launch

Read `docs/SEO_PLAYBOOK.md` first; it holds the automation matrix and checklists. This skill is the
procedure. Report findings; do not post to third-party sites and do not click "Request Indexing".

## Whole-site run

1. `curl -s https://www.example.com/robots.txt` and `/sitemap.xml`: robots allows crawling,
   sitemap lists every published page, every `<loc>` returns 200 (loop with `curl -o /dev/null -w "%{http_code}"`).
2. For each sitemap URL: status 200, `content-type: text/html`, `cache-control` has `s-maxage` and no
   `no-store`, `cf-cache-status` is HIT or MISS (not BYPASS/DYNAMIC on public pages).
3. Per page (`curl -s`): exactly one `<h1>`, `<title>` ≤60, meta description ≤160, `rel="canonical"`,
   JSON-LD parses as JSON, body text is present in the raw HTML.
4. Internal links: extract `href="/..."` from the homepage and blog index; any sitemap URL not linked
   from anywhere is an orphan. Report orphans.
5. Apex redirects to www with a 301.
6. Compare with GSC (Pages report or `urlInspection` via `/admin/analytics/seo`): list URLs "Discovered
   - currently not indexed" and their last crawl date.

## After publishing one page

1. `curl -sI <url>`: 200, cacheable, HIT within a minute of publish (warm step ran).
2. URL is in `/sitemap.xml` and `/llms.txt`.
3. IndexNow accepted (check server log for `[indexnow]`), GSC sitemap resubmitted.
4. Page has at least two inbound internal links; if not, propose where to add them.

## New site

Follow section 5 of the playbook. Needs a human for: GSC/Bing verification, Cloudflare token, Request Indexing.

## Backlink work

Produce drafts only (syndication copy with canonical URL, Reddit/Quora answer outlines, directory
listing text). List where each should go; the human posts them.
