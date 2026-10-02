---
name: site-build
description: Use when building, testing or previewing site-os — the BUILD_TARGET=stable dist directory, the four verification gates (build, test, env:check, brand:check), the preview servers on :3000 and :3100, and the failure modes that look like bugs but are not.
---

# Building and verifying

## The gates — all four, every time

```bash
BUILD_TARGET=stable pnpm build     # production build
pnpm test                          # vitest
pnpm env:check                     # every process.env var has a declared home
pnpm brand:check                   # brand assets, scales, no retired hexes
```

`tsc --noEmit` alone is not enough: it cannot see inside a SQL string or a
Tailwind class name, and both have produced runtime failures here that compiled
cleanly.

## `BUILD_TARGET=stable` writes to `.next-stable`

`next.config.mjs` sets `distDir` from it. **Use the same value for build and
start**, or `pnpm start` serves a stale or missing directory:

```bash
BUILD_TARGET=stable pnpm build
BUILD_TARGET=stable PORT=3100 pnpm start
```

### Rebuilding under a running server breaks it

Rebuilding into `.next-stable` while a server is serving from it invalidates the
chunk hashes its manifest holds, and every page starts throwing. It looks like a
code bug; it is not. **Restart the server after a rebuild**:

```bash
pkill -f "next start"; sleep 2
BUILD_TARGET=stable PORT=3100 pnpm start > /tmp/vb-preview.log 2>&1 &
```

## Previewing

| Port | Serves |
|---|---|
| 3000 | `~/projects/site-os` — main |
| 3100 | `~/projects/site-os-brand-v4` — the brand-v4 worktree |

Both bind to all interfaces, so no tunnel: `localhost`, Tailscale
`100.88.18.114`, or LAN `192.168.0.11`. Admin routes 307 to `/login` — that is
correct, not a failure.

The Coolify tunnel (`scripts/coolify-tunnel.sh`, port 8000) is unrelated; it
reaches the Coolify dashboard and API, which are loopback-only on the server.

## Verify against the rendered page, not the source

A page compiling proves nothing about what it renders. curl it:

```bash
curl -s http://localhost:3100/services | grep -oiE "lead generation|demand gen"
```

For anything visual, say plainly that it was **not** seen if no browser was
opened. Structural checks are not the same as looking at it.

## Tailwind: an unknown class fails the build, a wrong one does not

Tailwind v3 cannot apply an alpha modifier (`bg-saffron-500/10`) to a `var()`
holding a full hex, which is why the saffron and green scales in
`tailwind.config.ts` must stay hex literals. `brand:check` asserts they still
match `tokens.css`.

To prove a class emits real CSS, grep the built stylesheet — there are several,
and the main one is the largest:

```bash
grep -o "\.rounded-ui-md{[^}]*}" .next-stable/static/css/*.css
```

## Committing

Branch `brand-v4`. **No push, no merge, no deploy** without being asked.

Before committing, check no secret is staged:

```bash
git status --porcelain | grep -E '\.env\.local|\.secrets/'   # must be empty
git grep -l '<any token value>'                              # must be 0 files
```

`.env.local` and `.secrets/` are gitignored (`.gitignore:36` and `:44`).

## Related

- `[[site-database]]` — migrations and the ownership rule.
- `[[brand]]` — what `brand:check` is enforcing.
- `docs/OPS.md` §3 — which store holds which environment value.
