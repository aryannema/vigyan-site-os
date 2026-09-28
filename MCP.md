# The agent endpoint

`POST /api/mcp` exposes this site's governed resources as [Model Context
Protocol](https://modelcontextprotocol.io) tools. Every call is
capability-checked **in the database** before it touches data, and runs inside a
single transaction — the same wall a human admin meets.

## Authentication

The MCP specification's model is **OAuth 2.1 bearer tokens**; how you obtain the
token is left open. What exists:

| | what it is | here? |
|---|---|---|
| **none** | stdio only — the client already spawned the process | n/a (HTTP endpoint) |
| **static shared secret** | one key, one identity, never expires | ✅ `MCP_SECRET_KEY` |
| **self-issued JWT** | per-subject, expiring, scoped, no external provider | ✅ **recommended** |
| **full OAuth 2.1** | authorization server, discovery, dynamic registration | SDK supports it; not used here |
| **mTLS or proxy auth** | handled at the reverse proxy, outside MCP | valid, not implemented |

Two credentials are accepted here, and they are not equivalent.

### A shared secret — simple, and limited

```
Authorization: Bearer ${MCP_SECRET_KEY}
```

One secret, one identity, no expiry. Fine for a single service you control.
Its limits are worth naming: every client holding it is **indistinguishable in
the audit log**, rotating it cuts off all of them at once, and it never expires
on its own.

The identity it authenticates is `MCP_SERVICE_ACTOR` — a uuid or email that must
exist in `auth.users`. The token authenticates; **that row's role in
`user_roles` decides every capability.**

### JWTs — per-subject, expiring, auditable

#### Who generates the key — nobody central

No signing authority, no registration, no key server. **Whoever runs the site
generates the secret on their own machine**, and the same process signs and
verifies.

```bash
pnpm mcp:token --new-secret            # 64 random chars, generated locally
export MCP_JWT_SECRET='...'

pnpm mcp:token --issue agent@example.com
```

HS256 is **symmetric**: one secret both signs and checks. The server handing out
a token is the server validating it, which is why there is no registration step
— it is talking to itself.

| | who sets it | what it is for |
|---|---|---|
| `MCP_JWT_SECRET` | you, via `--new-secret` | signs and verifies |
| `MCP_JWT_ISSUER` | defaults to `vigyan-site-os` | which system minted this |
| `MCP_JWT_AUDIENCE` | defaults to `vigyan-site-os-mcp` | which system may accept it |

`iss` and `aud` earn their keep when several services share one secret: without
an `aud` check, a token for one would open the other. Give each its own
`MCP_JWT_AUDIENCE`. Running one site? The defaults are correct and you never
touch them.

**Every clone of this template gets its own isolated authentication.** Your
secret is yours; tokens minted against it work on your deployment and nowhere
else. There is no shared secret in the repository and no default — which is also
why a missing or short secret **disables JWT auth** rather than falling back. A
shipped default would mean every deployment on earth shared one key: the
appearance of security with none of it.

Outgrowing it: HS256 shares the secret between minter and verifier. If tokens
must be minted somewhere you would not trust with a signing key, switch to
**RS256** — the minter keeps the private key, this server needs only the public
half. Only the verifier changes.

Returns a pair:

```json
{
  "access_token":  "…",
  "refresh_token": "…",
  "token_type": "Bearer",
  "expires_in": 900
}
```

Send `Authorization: Bearer <access_token>`.

A JWT names its own subject, so it does **not** borrow `MCP_SERVICE_ACTOR` —
which is the practical gain: the audit log records *who* called, not merely that
something did. The `sub` must resolve to an `auth.users` row, by uuid or email.

**A token cannot grant a capability the database has not granted.** That is the
whole reason authorization lives in Postgres here — the token decides *who*, the
database decides *what*.

## Access and refresh

| | lifetime | what it can do |
|---|---|---|
| **access** | 15 min | call tools |
| **refresh** | 30 days | obtain a new access token — **nothing else** |

A long-lived access token that leaks is usable until it expires, and you cannot
tell that it leaked. A 15-minute one caps that window, and the refresh token is
sent only when refreshing rather than on every call, so it spends far less time
in transit and in logs.

```bash
curl -X POST https://your-site/api/mcp/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refresh_token":"…"}'
```

```json
{ "access_token": "…", "token_type": "Bearer", "expires_in": 900 }
```

Two deliberate choices there. Refresh is a **separate route**, so the refresh
token is absent from every ordinary tool call. And it is read from the **body**,
not the `Authorization` header, because access tokens live in that header and a
client bug could easily send the wrong one — different position, harder to
confuse.

Lifetimes: `MCP_JWT_ACCESS_MINUTES`, `MCP_JWT_REFRESH_DAYS`.

### The type check that makes this worth doing

Decode both tokens from one `--issue` and compare:

```
claim    | ACCESS               | REFRESH              | same?
---------|----------------------|----------------------|--------
iss      | vigyan-site-os       | vigyan-site-os       | YES
aud      | vigyan-site-os-mcp   | vigyan-site-os-mcp   | YES
sub      | agent@example.com    | agent@example.com    | YES
scopes   | ['mcp']              | ['mcp']              | YES
typ      | access               | refresh              | ** NO **
exp      | +15 min              | +30 days             | ** NO **
```

Same key, same algorithm, same everything — **except `typ` and expiry**. Delete
the `typ` check and the two become literally interchangeable: a 30-day refresh
token would pass every other test a valid access token passes.

So it is checked in both directions:

```
refresh token presented as an access token  ->  rejected
access token presented as a refresh token   ->  rejected
```

Without the first, a 30-day refresh token would call tools and the short access
lifetime would be decoration. Without the second, a leaked access token could
mint replacements forever.

`tests/mcp-auth.test.ts` asserts both, because if a future change drops the
check everything still compiles and the signature still verifies — the failure
would be silent.

### Rotation is deliberately absent

Rotation — a new refresh token each exchange, old one invalidated — is stronger
because it **detects theft**: if a thief and the legitimate client both use the
same token, one presents a superseded one and you know.

But that needs **server-side state**, a record of which tokens have been used.
This endpoint is stateless, and a rotation with nothing to compare against would
look like protection while providing none. If you want rotation, add a token
store first.

## Transports

**Streamable HTTP** — the transport the MCP specification adopted in revision
2025-03-26, replacing the older HTTP+SSE pair.

| method | behaviour |
|---|---|
| `POST` | JSON-RPC. The whole interface. |
| `GET` | `405` with `Allow: POST` |
| `DELETE` | `204` — session termination |
| `OPTIONS` | preflight |

**GET returns 405 on purpose.** Streamable HTTP lets a client open a GET stream
for server-initiated messages, and permits a server to decline. Every tool here
is a synchronous request/response against Postgres — no progress notifications,
no subscriptions. An idle stream would hold a connection open and never carry a
byte, so declining is the honest answer.

`DELETE` returns 204 because this server is stateless: identity is
re-established from the bearer token on every request, so there is no session to
end. Well-behaved clients are cleaning up; telling them the cleanup failed would
be misleading.

### SSE is not dead — the two-endpoint transport is

"SSE is deprecated" is a misleading shorthand. Two different things:

| | status |
|---|---|
| **SSE the technology** (`text/event-stream`) | **alive** — Streamable HTTP uses it internally |
| **HTTP+SSE the transport** (two endpoints) | **deprecated**, replaced in revision 2025-03-26 |

**The old transport used two endpoints.** A client opened `GET /sse` and held it
open indefinitely; the server replied down that long-lived stream while the
client posted requests to a *separate* `POST /messages/`. Two connections that
had to stay correlated — so a dropped stream killed the session, and it could
not survive a load balancer routing the two endpoints to different servers.

**Streamable HTTP uses one endpoint.** `POST /api/mcp` carries the request and
the server answers with `application/json` or `text/event-stream` as needed.
Same URL, same request. SSE is still there — as a *response mode* rather than a
connection you maintain.

This endpoint always answers `application/json`, because every tool here is a
synchronous query against Postgres. That is a complete Streamable HTTP
implementation: streaming is permitted, not required.

**The deprecated two-endpoint transport is not implemented**, and will not be.

CORS preflight does **not** reflect origins and does **not** allow credentials.
This endpoint is for programmatic clients holding a bearer token; echoing
arbitrary origins would let any page a victim visits call it with their token.

## Configuration

| variable | |
|---|---|
| `MCP_SECRET_KEY` | shared-secret credential (optional if using JWTs) |
| `MCP_SERVICE_ACTOR` | the `auth.users` identity the shared secret maps to |
| `MCP_JWT_SECRET` | **≥32 characters**, or JWT auth stays off |
| `MCP_JWT_ACCESS_MINUTES` | default 15 |
| `MCP_JWT_REFRESH_DAYS` | default 30 |
| `MCP_JWT_ISSUER` / `MCP_JWT_AUDIENCE` | defaults are fine |

A short `MCP_JWT_SECRET` **disables JWT auth** rather than being accepted:
HS256 with a 9-character key is brute-forceable offline from any token signed
with it, so accepting it would be worse than refusing.

There is no default secret anywhere. A shipped default looks like security while
providing none.

> [!WARNING]
> Serve this over TLS. A bearer token over plain HTTP is a bearer token in
> cleartext, and so is a refresh token.

## What an agent can do

Draft and publish posts, edit CMS sections, manage job openings, read CRM
enquiries — each subject to the role its identity carries. Give an agent a role
with `blog:edit` but not `blog:publish` and it writes drafts it cannot ship.

Calls land in `mcp_audit_log` like any other write.

## Errors

Rejection reasons are logged server-side and **not** returned to the caller.
"Expired" versus "bad signature" versus "wrong token type" helps an attacker
enumerate and helps a legitimate client not at all — their token either works or
needs reissuing.

## Testing

```bash
pnpm vitest run tests/mcp-auth.test.ts
```

Ten assertions: verification, scope enforcement, both type-confusion directions,
refresh exchange, scope carry-over, wrong-secret rejection, and that a weak
secret disables auth instead of being accepted.
