# Documentation

## Start here
- [SETUP.md](SETUP.md) — a new site, start to finish: the manual part (accounts, `pnpm bootstrap`, branding), then the agentic part
- [AGENT_MCP.md](AGENT_MCP.md) — the two MCP layers: infrastructure (build and operate) vs the site MCP (run the built site)
- [AGENT_MEMORY_SHARING.md](AGENT_MEMORY_SHARING.md) — share agent memory with Cowork and claude.ai (`pnpm agents:memory`)
- [../AGENTS.md](../AGENTS.md) — rules every coding agent reads before touching the code

## Building
- [../ARCHITECTURE.md](../ARCHITECTURE.md) — how the pieces fit
- [ADDING_A_FEATURE.md](ADDING_A_FEATURE.md) — worked example: a new table, its permissions, its tests, every command
- [MIGRATIONS.md](MIGRATIONS.md) — generated map of every migration, tagged DDL / required / defaults (`node scripts/migration-map.mjs`)
- [TESTING.md](TESTING.md) · [TESTING_PLAN.md](TESTING_PLAN.md) — the test layers, how to run each, what is not covered yet
- [brand/SKILL.md](brand/SKILL.md) — the brand rules agents follow (filled in by the site-bootstrap skill)

## Running
- [SEO_PLAYBOOK.md](SEO_PLAYBOOK.md) — getting pages indexed: sitemap, IndexNow, Search Console
- [LINK_BUILDER_AND_CAMPAIGNS.md](LINK_BUILDER_AND_CAMPAIGNS.md) · [CAMPAIGNS_FEATURE_SPEC.md](CAMPAIGNS_FEATURE_SPEC.md) — UTM links, short links, campaign funnel
- [KEYS.md](KEYS.md) — encryption keys and rotation

## Hosting
- [PORTABILITY.md](PORTABILITY.md) — what ties the app to Supabase and what does not
- [PORTING.md](PORTING.md) — moving between hosts (Coolify ⇄ Vercel + Supabase Cloud)
