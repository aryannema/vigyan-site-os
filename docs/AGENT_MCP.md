# Agent MCP — two layers

Any coding agent (Claude Code, Codex, OpenCode, Antigravity) builds and runs this site
through MCP servers in **two layers**. They differ in *when* they exist and *what* they touch.

| | Layer 1 — infrastructure | Layer 2 — the site itself |
|---|---|---|
| Exists | before the site does | only after the first deploy |
| Touches | hosts, DNS/CDN, repo, database, channels, automations | this site's content, catalogue, settings |
| Servers | Cloudflare, GitHub, Coolify / Vercel, Supabase, WhatsApp, Postiz, n8n | `site` → `https://<your-domain>/api/mcp` |
| Auth | OAuth on first use, or a token named by an env var | `Bearer $SITE_MCP_KEY` (= the site's `MCP_SECRET_KEY`) + `X-Caller-Label` |
| Used for | build, deploy, cache purge, DNS, schema, social posts, workflows | pages and sections, blog, jobs, short links, products and prices, flags, settings |

Both layers are declared once in `agents/mcp.json` and written into every agent's config by
`pnpm agents:port` (`pnpm agents:check` fails when a config is stale).

## Layer 1 — infrastructure (build and operate)

Grouped into **profiles**; a site switches on the ones its stack uses (`default_profiles`).

| Profile | Servers | Typical jobs |
|---|---|---|
| `core` | `site`, `cloudflare-api`, `cloudflare-docs`, `github` | cache rules, purge, DNS; repo, PRs, CI |
| `coolify` | `coolify` | apps, deploys, env vars, logs (self-hosted) |
| `vercel` | `vercel` | same, on Vercel |
| `supabase-cloud` | `supabase` | projects, SQL, logs |
| `whatsapp` | `whatsapp-business-tools` | numbers, templates, webhooks |
| `social` | `postiz` | schedule posts across social accounts |
| `automation` | `n8n` | list and run workflows |

The template ships `default_profiles: ["core"]`; add the rest as your stack needs them.

## Layer 2 — the site MCP (run the built site)

`/api/mcp` is a Streamable HTTP MCP server (`initialize`, `tools/list`, `tools/call`;
protocol versions 2025-06-18, 2025-03-26, 2024-11-05). It is the admin console for agents:

- Every call is **permission-checked and audited** exactly like an admin click — the caller
  label shows which agent did what.
- A wrong or missing key gets `401` with `WWW-Authenticate`; tool failures come back as MCP
  results with `isError: true`, not HTTP errors.
- Publishing through it triggers the same pipeline as the admin panel: revalidate → cache
  purge → re-warm → search-engine notification.

## The loop

1. **Layer 1 builds:** repo, database, host, DNS, first deploy (after the manual bootstrap in
   `docs/SETUP.md`).
2. **Layer 2 runs:** content, products, flags — through `site`.
3. **Layer 1 follows up:** cache purge/warm (Cloudflare), announce (Postiz), automate (n8n).

## Prove it

```
SITE_MCP_KEY=… bash scripts/agents-smoke.sh
```

Part 1 speaks raw MCP to `site` (and Postiz / n8n when their env is set). Part 2 makes
Claude Code, Codex and Antigravity each call `site.list_pages` and report the count.
Keys are read from the environment and never printed.
