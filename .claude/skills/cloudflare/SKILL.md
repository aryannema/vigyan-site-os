---
name: cloudflare
description: Use when putting a site behind Cloudflare, moving DNS to Cloudflare from a registrar like Hostinger, debugging redirect loops or TLS errors after a cutover, or choosing between the Cloudflare API and the Cloudflare MCP server. Covers the migration order that keeps email alive and the apex/www decision that affects Google indexing.
---

# Cloudflare — DNS cutover and what breaks

Written from one real migration: a Next.js site moved off managed hosting onto a
Hostinger VPS with Coolify, with Cloudflare in front. The order below is the
order that matters, and step 1 is the one that takes email down if skipped.

## 0. Before touching nameservers — export every record

**Moving nameservers replaces your entire DNS zone.** Cloudflare's scan imports
most records, but "most" is the problem: anything it misses simply stops
existing, and the failure is silent until someone notices mail bouncing.

The records that actually break businesses:

| record | what dies |
|---|---|
| `MX` | **all inbound email**, immediately |
| `TXT` SPF | your outbound mail starts landing in spam |
| `TXT`/`CNAME` DKIM | same, and harder to notice |
| `TXT` DMARC | reporting stops; policy may fail open |
| `TXT` verification | Google/Microsoft/Meta domain ownership revoked |

```bash
# export first, from any machine, BEFORE the move
for t in NS A AAAA CNAME MX TXT SRV CAA; do
  echo "--- $t"; dig +short "$t" example.com
done | tee dns-before.txt

dig +short TXT _dmarc.example.com
dig +short TXT google._domainkey.example.com   # and any other selector
```

Keep `dns-before.txt`. After the cutover, diff against it. On the migration this skill is
written from, Google Workspace mail survived **because the MX record was copied
deliberately**, not because the scan caught it.

## 1. Add the zone, then verify records, then delegate

1. Cloudflare → **Add a site**, let it scan
2. **Compare against `dns-before.txt` and add what is missing** — this is the step
   people skip
3. Only then change nameservers at the registrar (Hostinger: Domains → DNS /
   Nameservers → *Change nameservers* → the two nameservers
   Cloudflare shows you — they are specific to your account, so use the pair on
   your own dashboard, never one copied from a guide)
4. Propagation is usually minutes, but registry TTLs can mean hours. Do not
   schedule this before something important.

```bash
dig +short NS example.com      # should return the Cloudflare pair
```

## 2. Point at the origin, and decide about the orange cloud

```
A     @      <VPS IP>     proxied
CNAME www    @            proxied
```

**Proxied (orange cloud)** hides the origin IP — `dig` returns Cloudflare anycast
addresses (`104.x`, `172.67.x`) — and gives caching, TLS termination and DDoS
absorption. This is what you want for a website.

**DNS-only (grey cloud)** is required for anything that is not HTTP: SSH, SMTP,
a database port. Proxying those does not work — Cloudflare's proxy is HTTP(S).
Leave a `ssh.` or `direct.` record grey if you need to reach the box, and accept
that it publishes the origin IP.

## 3. TLS mode — get this wrong and you get a redirect loop

**Set SSL/TLS → Overview → Full (strict).**

| mode | what happens |
|---|---|
| **Off** | no HTTPS |
| **Flexible** | Cloudflare talks HTTP to your origin. Your origin redirects HTTP→HTTPS. Cloudflare follows it back to itself. **Infinite redirect loop** — `ERR_TOO_MANY_REDIRECTS`. The classic Cloudflare bug. |
| **Full** | HTTPS to origin, certificate not verified |
| **Full (strict)** | HTTPS to origin, certificate verified — **use this** |

Full (strict) requires a valid certificate on the origin. Coolify provisions
Let's Encrypt automatically, so this works — but **DNS must already resolve to the
VPS before Coolify can complete the ACME challenge**. Order: DNS → wait → Coolify
issues → switch Cloudflare to Full (strict).

If the origin cannot get a public cert, use a Cloudflare **Origin Certificate**
(15-year, trusted only by Cloudflare) instead of dropping to Flexible.

## 4. Pick ONE canonical host

Serving the same pages on both `example.com` and `www.example.com` splits
indexing: Google sees two sites, neither accumulating full authority.

Decide, then make three things agree:

1. **A 301 redirect** from the loser to the winner (Cloudflare → Rules →
   Redirect Rules, or handle it in Next.js)
2. The **`<link rel="canonical">`** tag on every page, pointing at the winner
3. **`sitemap.xml`** URLs, using the winner

```bash
curl -sI https://example.com/     | grep -iE "^HTTP|^location"   # expect 301 -> the winner
curl -s  https://www.example.com/ | grep -i canonical            # must match
```

A redirect with a canonical tag pointing the *other* way is worse than neither,
because it tells Google two contradictory things.

## 5. Caching, and the trap for server-rendered pages

Cloudflare caches static assets by extension automatically. It does **not** cache
HTML by default, which is correct for Next.js App Router — RSC pages are
per-request and often per-user.

If you add a Cache Rule for HTML, exclude anything authenticated. Caching a
logged-in admin page at the edge serves one user's view to the next.

`/api/*` should never be cached. Verify with `cf-cache-status` — `DYNAMIC` or
`BYPASS` is what you want there; `HIT` on an API route is a bug.

## 6. Security headers — Cloudflare will not add them for you

Common gap, and easy to check:

```bash
curl -sI https://example.com | grep -iE "strict-transport|x-frame|content-security"
```

Empty output means none are set. Add via Cloudflare → Rules → **Transform Rules
→ Modify Response Header**, or in `next.config.mjs`:

- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY` (or a CSP `frame-ancestors`)
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy` — build it incrementally in report-only mode first

Enable HSTS only once HTTPS definitely works everywhere. It is **not reversible
within the max-age window**: browsers refuse HTTP for that domain for a year.

## 7. API or MCP

**Cloudflare MCP servers** — use when an agent should read or change
configuration conversationally. Cloudflare publishes several (docs search, DNS
and zone management, observability, Workers bindings). They handle OAuth, so an
agent works without a token in a config file. Best for "what is my current SSL
mode", "add this DNS record", "why is this cached".

**The REST API** — use for anything scripted, repeatable or in CI.

```bash
# purge cache after a deploy
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'
```

Scope the token: **Zone → DNS → Edit** and **Zone → Cache Purge → Purge** for the
one zone. A Global API Key is your whole account and is sent on every call; do
not use it for deploys.

**Terraform** if the configuration must be reviewable and reproducible.

## 8. Verify a cutover

```bash
dig +short NS example.com                        # Cloudflare pair
dig +short MX example.com                        # matches dns-before.txt
curl -sI https://example.com | grep -i "^server" # server: cloudflare
curl -sI https://example.com | grep -i "^cf-ray" # edge PoP
curl -sI https://example.com/ | grep -iE "^HTTP|^location"   # canonical redirect
```

Then diff the whole zone against `dns-before.txt`. **Send yourself an email from
an outside address** — this is the check people skip, and mail is the thing whose
breakage costs most.

## Failure modes seen in practice

| symptom | cause |
|---|---|
| `ERR_TOO_MANY_REDIRECTS` right after cutover | SSL/TLS mode is Flexible; set Full (strict) |
| Certificate issuance fails in Coolify | DNS does not resolve to the VPS yet, or the record is proxied so the ACME HTTP challenge never reaches the origin |
| Email stops | `MX` not carried over. Restore from `dns-before.txt` |
| Google Search Console reports duplicates | apex and www both serving 200 |
| SSH stops working through the hostname | that record is proxied; the proxy is HTTP-only. Use a grey-cloud record |
| Stale page after deploy | purge the cache, or you cached HTML you should not have |
