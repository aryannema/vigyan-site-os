# The agent endpoint

`POST /api/mcp` exposes this site's governed resources as [Model Context
Protocol](https://modelcontextprotocol.io) tools. Every call is
capability-checked **in the database** before it touches data, and runs inside a
single transaction — the same wall a human admin meets.

## Authentication

Two credentials are accepted, and they are not equivalent.

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

```bash
pnpm mcp:token --new-secret            # 64 chars
export MCP_JWT_SECRET='...'

pnpm mcp:token --issue agent@example.com
```

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

Both tokens are signed with the same key, by the same issuer, for the same
audience, carrying the same scopes. **The only thing separating them is a `typ`
claim**, and it is checked in both directions:

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

**The deprecated HTTP+SSE transport is not implemented**, and will not be.
Building on something already replaced is not worth the code.

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
