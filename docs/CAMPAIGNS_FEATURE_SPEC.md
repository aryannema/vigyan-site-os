# Campaigns Feature — Spec for Review

**STATUS: PENDING OPERATOR REVIEW.** Built and technically verified end-to-end (2026-09-01), but
the operator has explicitly said (2026-09-02) they are not yet convinced/confident using it. This
document is the review artifact — an exact, structured account of what exists right now, not a
usage guide (see `docs/LINK_BUILDER_AND_CAMPAIGNS.md` for that) and not a narrative of how it was
built (see decision `VBYTES-2026-09-01-01` in `work-units/session-state.json` for that). Read this
to answer: **what exactly is here, and is it the right thing?**

---

## 1. Scope — three things, wired together

| # | Piece | What it is | Where |
|---|---|---|---|
| 1 | Link Builder | Admin CRUD for tagged short links | `/admin/links` |
| 2 | Automation surface | Same link creation, callable by n8n/Postiz | `/api/mcp` (2 new tools) |
| 3 | Campaign funnel | A view joining click data to GA4 session data by campaign name | `/admin/analytics` (Campaigns card) |

Nothing else. No ad-spend, no scheduling, no social posting automation — those are explicitly out
of scope, see §6.

---

## 2. Data model — exact schema (migration `017_utm_link_shortener.sql`)

**`public.link_shortener`** — one row per short link.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text, UNIQUE, NOT NULL | the `/go/<slug>` path |
| `target_url` | text, NOT NULL | where it redirects |
| `utm_source` | text, nullable | e.g. `linkedin` |
| `utm_medium` | text, nullable | e.g. `social` |
| `utm_campaign` | text, nullable | **the field the funnel groups by — see §4** |
| `utm_term` | text, nullable | |
| `utm_content` | text, nullable | |
| `platform` | text, nullable | freeform (linkedin/facebook/instagram/blog/email/other), not a foreign key |
| `offer_type` | text, NOT NULL, default `'free'` | CHECK `IN ('paid','lead_magnet','free')` — see §5 |
| `status` | text, NOT NULL, default `'active'` | CHECK `IN ('draft','active','archived')` — **UI filter only, does not affect whether the link resolves** |
| `created_by` | uuid, nullable | FK to `auth.users` |
| `created_at`, `updated_at` | timestamptz | |

**`public.link_clicks`** — append-only click log, no counter column.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `link_id` | uuid, FK → `link_shortener.id`, `ON DELETE CASCADE` | |
| `clicked_at` | timestamptz, default now | |
| `referrer` | text, nullable | from the request header |
| `user_agent` | text, nullable | from the request header |

**Access:** `link_shortener` is capability-gated (`resource:links`) — `role_capabilities` grants
`admin`: view/create/edit/delete, `editor`: view/create/edit (no delete). `link_clicks` has **zero
RLS policies and zero grants to any session role** — only the service-role redirect route can write
it, and only the admin owner-connection (`query()`) can read it. Neither table is readable by
`anon`.

---

## 3. Every new route, exact behavior

| Route | Method | Auth | Behavior |
|---|---|---|---|
| `/admin/links` | GET | session (admin/editor `links:view`) | List view, joins `link_clicks` count per link |
| `/admin/links/new` | GET/POST | session (`links:create`) | Create form |
| `/admin/links/[id]/edit` | GET/POST | session (`links:edit`) | Edit form |
| `/go/[slug]` | GET | **none — public** | Looks up `slug`, appends non-null `utm_*` values as query params onto `target_url`, 302-redirects. Logs a `link_clicks` row asynchronously (Next.js `after()`) so the click log never adds latency to the redirect. Returns `404` if the slug doesn't exist. **Ignores `status`** — an `archived` link still resolves; deleting the row is the only way to break it. |
| `/admin/analytics/realtime` | GET | session (any signed-in admin/editor) | JSON `{activeUsers, byCountry}` from GA4 Realtime, polled by the "Right now" widget every 45s |

**MCP tools** (`/api/mcp`, `tools/call`, bearer `MCP_SECRET_KEY` + required `X-Caller-Label`):

- **`create_short_link`** — required: `slug`, `target_url`. Optional: `utm_source`, `utm_medium`,
  `utm_campaign`, `utm_term`, `utm_content`, `platform`, `offer_type` (default `free`), `status`
  (default `active`). Writes directly via `supabaseAdmin` (not the audited `mutate()` path used by
  the admin UI — MCP callers are agents, not `auth.users` identities). Logged to `mcp_audit_log`,
  not `action_audit_log`.
- **`list_short_links`** — optional filters: `target_url`, `utm_campaign`, `limit` (default 20,
  max 100). Read-only.

---

## 4. The `utm_campaign` convention — the one thing that makes the funnel work

This is not enforced by the database — it's a **convention**, and it is the single most important
thing to understand or challenge in this review.

When a blog post publishes (from any of three places — the cron job, a direct admin-UI publish, or
an MCP `create_blog_post`/`update_blog_post` call), a new helper (`onBlogPostPublished()` in
`src/lib/blog-publish-hooks.ts`) automatically creates one base short link for that post with
`utm_campaign` set to `blog-<slug>`. If a second automation (n8n, a person) later creates a
platform-specific link for the *same* post — say, one for a LinkedIn share — the expectation is
that it reuses that same `blog-<slug>` campaign name (found by calling `list_short_links` with
`target_url` set), giving it its own `utm_source`/`utm_medium` but the same campaign.

**If that convention is followed**, every platform's traffic for one post rolls up into a single
row on the Campaigns card. **If it is not followed** — if every link gets its own ad-hoc campaign
name — the funnel fragments into many unrelated rows and stops being useful. Nothing currently
enforces this beyond documentation and the `list_short_links` lookup step. **This is worth
scrutinizing in review**: is a convention enough, or does this need a harder constraint (e.g. one
canonical campaign row per post, linked by ID rather than by matching string)?

---

## 5. `offer_type` — exact scope, not more

`paid` / `lead_magnet` / `free`. **A reporting label, nothing else.** No ad-spend platform (Meta
Ads, Google Ads) is integrated. Setting `offer_type: 'paid'` does not spend money, does not create
an ad, does not talk to any external ad platform — it only changes how the link is labeled/grouped
in `/admin/links` and the Campaigns card. The `LinkForm` UI auto-suggests `paid` if the target URL
matches an active `products` row's checkout path; otherwise it's a manual pick, defaulting to
`free`.

---

## 6. The Campaigns card — exact query, exact columns shown

`/admin/analytics`'s Campaigns card now shows, per `utm_campaign`: **Clicks** (from
`link_clicks`, joined via `link_shortener.utm_campaign`), **Sessions**, **Engagement rate**,
**Pageviews** (all three from GA4's `sessionCampaignName` dimension, filtered to the selected date
range), and **Offer** (the `offer_type` of whichever link under that campaign was created first).
Rows are the union of every campaign name seen on either side (a campaign might have clicks but no
GA4 session yet, or vice versa) — sorted by clicks+sessions descending, capped at 10 rows.

**A real caveat, worth flagging in review:** GA4 session data lags — its own dashboard already
shows a ~1–3 day reporting delay. A link clicked minutes ago will show `clicks: 1` immediately but
`sessions: 0` until GA4 catches up. This is not a bug, but it may look like the funnel is broken if
not expected.

---

## 7. Explicitly NOT built — do not assume otherwise

- No n8n workflow or Postiz posting logic exists. This spec only covers the surface (`create_short_link`,
  the `short_url` field added to the existing blog-publish webhook payload) that a *future* n8n
  workflow would call. Per `yoursite-studio/WORKING_ORDER.md` "Stage 5.5," that automation stays
  gated behind resuming manual posting first — a separate, later decision.
- No MDT (Monetization Discovery Tool). This feature produces queryable Postgres data that MDT
  could eventually use, but does not build MDT itself.
- No city-level geo pins on the Analytics map (country-level only — GA4's `city` dimension has no
  lat/lon).
- No ad-spend/boosting flow (see §5).

---

## 8. Open questions for review

1. **Is the `utm_campaign`-string-matching convention (§4) solid enough**, or does it need a
   harder link (e.g. a `campaign_id` FK) before this is trusted for real reporting?
2. **Is `offer_type` the right three categories**, or does the operator want something else here
   (e.g. tying it to an actual `products.id` rather than a freeform label)?
3. **Is the GA4 reporting lag (§6) going to read as confusing/broken** in daily use, and if so,
   should the UI say so explicitly (e.g. "sessions may take a day to appear")?
4. **Should `editor` role really get `create`+`edit` on links but not `delete`** (matches the
   Products feature's existing editor grant pattern) — or does this need different access rules?
