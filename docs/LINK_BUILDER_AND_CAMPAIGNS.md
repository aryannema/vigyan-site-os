# Link Builder, Campaigns, and the Country/Live Analytics widgets

Written 2026-09-01, after building and verifying all of it live against production. Covers the
UTM link builder (`/admin/links`), its MCP wiring for n8n/Postiz automation, the campaign
engagement funnel on `/admin/analytics`, and the country map / live-visitor widgets added to
that same page. Read this before touching any of it, or before wiring a new automation
(n8n, Postiz) into the publish pipeline.

---

## 1. Why this exists

Posting a plain link to Facebook, Instagram, or LinkedIn tells you almost nothing about whether
it worked. Two separate problems:

- **Attribution gets stripped or misattributed.** Instagram has no clickable links in captions
  at all (only bio/stories), and its in-app browser frequently drops the referrer entirely, which
  is why Instagram traffic tends to show up as "Direct" in GA4 rather than as its own source.
  Facebook and LinkedIn are better-behaved — their link wrappers generally preserve a tagged URL
  correctly.
- **Social links are not SEO backlinks.** Every major social platform marks outbound links
  `rel="nofollow"`, which tells Google explicitly not to pass ranking credit through them. Posting
  to social does not move search rankings directly — it drives visibility, which can *lead to* a
  real backlink from someone else's site (the kind that actually matters for SEO), but the post
  itself isn't one.

Given that, the actually useful thing to build was a way to know, per post and per platform,
whether a share worked at all — clicks, whether those clicks became real sessions, and whether
people engaged once there. That's what this system measures.

---

## 2. How to create a short link

**In the browser:** `/admin/links` → "+ New Link". Fill in the target URL, campaign, source/medium,
platform, and offer type (see §4). The slug auto-suggests from the campaign name but is editable.
Save gets you a `/go/<slug>` URL with a one-click Copy button.

**Via MCP** (for n8n/Postiz automation, or any script): the same JSON-RPC tool-call surface this
repo already uses for blog/careers automation (`/api/mcp`, `MCP_SECRET_KEY` bearer auth + a
required `X-Caller-Label` header — see `yoursite-studio/docs/mcp-publishing-ops.md` for the
full auth explanation, unchanged here).

```bash
curl -X POST "https://www.example.com/api/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_SECRET_KEY" \
  -H "X-Caller-Label: n8n" \
  --data '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "create_short_link",
      "arguments": {
        "slug": "linkedin-cost-audit-launch",
        "target_url": "https://www.example.com/blog/private-ai-cloud-what-broke",
        "utm_source": "linkedin",
        "utm_medium": "social",
        "utm_campaign": "blog-private-ai-cloud-what-broke",
        "platform": "linkedin",
        "offer_type": "free"
      }
    }
  }'
```

Before creating a link for a piece of content that might already have one, call `list_short_links`
with `target_url` set — this is how n8n finds the existing campaign name to reuse (§3) instead of
inventing a new one:

```bash
curl -X POST "https://www.example.com/api/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $MCP_SECRET_KEY" \
  -H "X-Caller-Label: n8n" \
  --data '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": { "name": "list_short_links", "arguments": { "target_url": "https://www.example.com/blog/private-ai-cloud-what-broke" } }
  }'
```

Both tools are also listed in `tools/list` alongside every other MCP tool this repo exposes.

**Editing a link's UTM values later** does not need a new slug — `/go/<slug>` appends `utm_*`
params at redirect time from the stored columns, not from a baked-in URL. Fix a typo'd campaign
in `/admin/links` and every already-shared copy of that link picks up the correction immediately.

---

## 3. The `utm_campaign` convention — what actually makes the Campaigns card useful

One campaign name, shared across every platform-specific link for the same piece of content. When
a blog post publishes, `onBlogPostPublished()` (`src/lib/blog-publish-hooks.ts`) automatically
creates a base short link for it with `utm_campaign = blog-<slug>`. When n8n later creates
platform-specific links for that same post — one for the LinkedIn share, one for Facebook, one for
Instagram — each gets its own `utm_source`/`utm_medium`, but should reuse that same campaign name
(found via `list_short_links` as shown above).

**Worked example:** a post publishes → base link `blog-private-ai-cloud-what-broke` is created
automatically. n8n later creates `linkedin-cost-audit-launch` (source: linkedin) and a second link
for Facebook, both with `utm_campaign: "blog-private-ai-cloud-what-broke"`. Every click on any of
those three links, plus every GA4 session that arrives tagged with that campaign name, rolls up
into **one row** on the Campaigns card — not three unrelated rows. That's the entire point of the
convention: without it, the same post's traffic fragments across platforms and never gives you a
real picture of "did this post do anything."

---

## 4. `offer_type` — what `paid` / `lead_magnet` / `free` actually mean

This is a **reporting label only**. There is no ad-spend integration, no Meta Ads / Google Ads
API, no payment flow behind this field — it exists purely so the admin can see, at a glance,
which campaigns are driving toward something sold (via the existing Products/Razorpay checkout
flow) versus building audience for free.

- `paid` — the target is a `products` row behind the existing Razorpay checkout flow.
- `lead_magnet` — a free resource (a free-tier template, a guide) meant to capture a lead.
- `free` (default) — everything else: a blog post, a general page.

If a future session wants to build a real ad-spend/boosting flow (e.g. "spend ₹X to promote this
post"), that is new scope requiring a real ads-platform integration — nothing here provides it.

---

## 5. Where the data lands, and how to query it directly

Two tables (migration `017_utm_link_shortener.sql`):

- **`public.link_shortener`** — one row per short link (slug, target_url, utm_* columns,
  platform, offer_type, status). Capability-gated (`resource:links`), same audited write path
  as every other admin CRUD feature when written from `/admin/links`.
- **`public.link_clicks`** — append-only click log (link_id, clicked_at, referrer, user_agent).
  Deliberately zero RLS policies, unreachable via any session role — only the public `/go/[slug]`
  redirect route writes it, via `supabaseAdmin` (service role).

**Two separate write paths land in the same table**, deliberately:
- `/admin/links` (a human, in the browser) → `mutate()`/`perform_action()` → `action_audit_log`.
- `create_short_link` (MCP, an agent) → `supabaseAdmin` directly → `mcp_audit_log`.

Both audit tables are unioned in the existing `admin_unified_audit_log` view, so "who created this
link" is answerable regardless of which path made it.

**Real example queries:**

```sql
-- Clicks by campaign, last 7 days
SELECT l.utm_campaign, COUNT(c.id) AS clicks
FROM public.link_shortener l
JOIN public.link_clicks c ON c.link_id = l.id
WHERE c.clicked_at > now() - interval '7 days'
GROUP BY l.utm_campaign
ORDER BY clicks DESC;

-- Top-performing individual platform link (not campaign-aggregated)
SELECT l.slug, l.platform, l.utm_source, COUNT(c.id) AS clicks
FROM public.link_shortener l
LEFT JOIN public.link_clicks c ON c.link_id = l.id
GROUP BY l.id
ORDER BY clicks DESC
LIMIT 10;
```

---

## 6. The Analytics widgets (country map, live visitors)

Both live on `/admin/analytics`, both read from the same `BetaAnalyticsDataClient` instance
(`src/app/(app)/admin/analytics/ga4-client.ts`) already used for the page's historical reports.

- **Sessions by country** — a real choropleth (plain SVG, `d3-geo`/`topojson-client`/`world-atlas`,
  no charting library), quantile-bucketed into the existing saffron-300→700 shades. Country shading
  is historical data for the selected date range, same as the rest of the page — not live.
- **Right now** — polls `/admin/analytics/realtime` every 45 seconds. Set the right expectation
  here: **GA4's own Realtime API only refreshes server-side every ~60 seconds** — this is not a
  true instant "someone just clicked" feed, it lags by up to a minute. Polling faster than ~30s
  buys nothing.

Both are session-gated by the existing `middleware.ts` matcher (`/admin/:path*`) — the realtime
endpoint lives at `/admin/analytics/realtime`, not under `/api/*`, specifically so that gate
covers it automatically.

If either widget ever needs debugging: `getGa4Client()` returns `null` (not a throw) when
`GA4_PROPERTY_ID`/`GCP_SERVICE_ACCOUNT_KEY` aren't set, matching the page's existing
"GA4 not configured" empty state. The country/realtime permission scopes were verified live
against the real GA4 property before this was built (`runReport` with `country`/`countryId`
dimensions, and `runRealtimeReport` — both succeed with the existing service account, no new
Google Cloud IAM grant was needed).

---

## 7. Relationship to MDT / PMF — this is NOT that

This work builds a **data surface** — trackable links, a click log, a campaign funnel view. It is
explicitly **not**:

- The n8n workflow or Postiz posting cadence itself. Per `yoursite-studio/WORKING_ORDER.md`
  "Stage 5.5" (operator direction, 2026-08-10), that automation stays gated behind resuming manual
  posting first — unchanged by anything here.
- MDT (Monetization Discovery Tool, `yoursite-studio/BRIEF.md` §4.8) — an internal tool for
  finding market signals, explicitly "specified four times, built zero," with its own warning
  against over-building it. Nothing here builds MDT.

The connection: whenever MDT (or any future audience-intelligence tool) *is* built small, per its
own stated discipline, the click/session/engagement data described in §5 is already sitting in
plain, queryable Postgres — real signal to query from day one, without needing new instrumentation
retrofitted first.
