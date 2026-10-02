---
name: publish-and-verify
description: Publishing content or deploying site-os — what caches exist, what refreshes them, and how to prove a change is actually live. Use when publishing a post or product, launching a page, deploying, or when someone says a change "isn't showing".
---

# Publishing, caching and proving it landed

## The three caches, and what clears each

```
1. Next ISR cache   on the origin disk     cleared by revalidateFor()
2. Cloudflare edge  ~300 cities            cleared by a PURGE, not by revalidate
3. Browser          per visitor            cleared by a new content hash
```

**They do not know about each other.** `revalidatePath` refreshes the origin and
nothing else. That is the single most common misunderstanding here.

## Publishing content — no rebuild, ever

A new post, product, job or copy edit is **data**, not code. The route
`/products/[slug]` is a wildcard compiled once at deploy; it already serves
every product that will ever exist.

```
admin saves → row in Postgres
            → revalidateFor({kind, slug})   origin marked stale + Cloudflare purged
            → next request regenerates that ONE page
```

Never run `pnpm build` to publish content. A rebuild is only needed when the
**template** changes — moving a button, adding a field, changing a layout.

## Adding a new content type

Three registries, each keyed by type. Adding one is an entry, never a migration:

```
lib/content-revalidation.ts   which paths a change invalidates
lib/structured-data.ts        the schema.org JSON-LD for it
lib/fulfilment.ts             how a purchase is delivered
```

All three are exhaustive `Record`s, so a new kind is a **compile error** until
its entry exists. That is deliberate — it is what stops the next content type
shipping with no structured data, which is exactly how blog posts ended up
with none.

## Cache windows

```
60s     /products/[slug], /templates   price and offer dates
300s    /blog, /blog/[slug], /careers  published content
3600s   /, /about, /services, /contact marketing copy
86400s  /privacy /terms /refund-policy legal text
```

The layout is a **CEILING, not a default**: Next takes the LOWEST revalidate
across matched segments, so a page can never be cached longer than its layout
allows. Setting the layout low silently caps every page beneath it.

These are worst cases. `revalidateFor()` pushes changes immediately; the window
only catches a write path that forgot to call it.

## Two traps that cost real time

**A dynamic route without `generateStaticParams` emits `no-store`**, however
short its `revalidate`. Next cannot know the slugs, so it gives up and renders
per request. This left all ten blog posts uncrawled by Google. Any
`[slug]` route that should be cached needs it.

**Route segment config is INERT in a `'use client'` file.** `export const
dynamic = 'force-dynamic'` there looks right and does nothing. Use a segment
`layout.tsx` instead.

## Cloudflare only caches HTML because of a Cache Rule

Cloudflare does NOT cache HTML by default (it is extension-based: js/css/images).
Without a rule every page shows `cf-cache-status: DYNAMIC` whatever `s-maxage` says.
Since 2026-09-30 the zone has one rule, "Cache public HTML (respect origin)":

```
match   host is www.example.com or example.com
        and path does NOT start with /api/ /admin /account /go/ /login /auth
            /complete-profile /data-deletion/request /_next/image
action  Eligible for cache
        Edge TTL: use cache-control if present, bypass if not   (origin stays in control)
        Cache key: Ignore query string   (Free plan cannot exclude only utm_*)
```

Consequences: a route is cached at the edge only if the origin sends `s-maxage`
(so `no-store`/`private`/`Set-Cookie` responses are never cached); a NEW public
route is cached automatically, a new private route must be added to the exclusion
list. Query strings are ignored, so a public page must never vary its HTML on
`?param` — use a path segment instead (this is why drafts live at `/preview`).
Attribution does not depend on utm_*: `/go/<slug>` sets the `vb_attr` cookie.

## Deploying

A deploy replaces the container, so the previous build's JavaScript chunks are
**gone**. Cached HTML still references them by hash, and a visitor served that
HTML gets a 404 on the chunk and a page with no JavaScript.

`src/instrumentation.ts` purges Cloudflare on boot to close this. It requires
`CLOUDFLARE_CACHE_PURGE_TOKEN` and `CLOUDFLARE_ZONE_ID` **in the environment**
(not `app_secrets` — instrumentation is compiled for the edge runtime too and
cannot import the crypto-dependent secrets module). Without them it logs a
warning and the stale-chunk window is live.

## Proving it — never trust the diff

Read the build output and the live headers. Both have lied in ways that
reasoning would not have caught.

```bash
pnpm build          # ○ static  ● static per slug  ƒ per request
                    # the last two columns are revalidate and expire

curl -sI https://www.example.com/blog/<slug> \
  | grep -iE 'cache-control|cf-cache-status'
# want: s-maxage=N, stale-while-revalidate  ·  cf-cache-status: HIT
# no-store or DYNAMIC means it is NOT cached
```

**Confirm the server you measured is the one you built.** A stale process
holding the port produced a completely wrong reading once — check the log for
`EADDRINUSE` before believing any measurement.

## Proving a content change propagated

```
1. edit the row directly in Postgres      → page should NOT change (proves it is cached)
2. go through the app's write path        → page changes at once (proves revalidation)
```

If step 1 changes the page, nothing is cached. If step 2 does not, the write
path is not calling `revalidateFor()`.

## When someone says "it isn't showing"

In this order:

1. `cf-cache-status` — `HIT` means the edge is serving an old copy. Purge:
   the purge server action `purgeCloudflareCache()` (no UI button yet) or wait out the window.
2. Did the write path call `revalidateFor()`? A row edited straight in the
   database does not, by design.
3. Is it actually published? Drafts render only at `/products/<slug>/preview` (never read searchParams on a cached page: it throws DYNAMIC_SERVER_USAGE and 500s).
4. Only then suspect the code.

## Search engines

```
sitemap lastmod   real row timestamps, refreshed by revalidateFor
IndexNow          Bing + Yandex, automatic on publish
Google            NO push API for ordinary pages. Sitemap + the manual
                  Request Indexing button are the only levers.
```

Do not build a "tell Google" automation. It does not exist, and the Indexing
API is restricted to `JobPosting` and `BroadcastEvent` — using it for ordinary
pages risks the property.
