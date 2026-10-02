# YourSite Agentic Governance (AGENTS.md)

**Target Agents:** Gemini CLI, Claude Code, Codex CLI, Roo/Cline.
**Last Updated:** 2026-04-18

This repository enforces a strict "Sovereign-First, Hybrid-Second" architectural methodology. 

*Agent Context Note: While the YourSite VVC infrastructure is governed by the full 22-document A-Series methodology, THIS specific repository (the application layer) consolidates those principles into this single **A00 Prime Directive**. Do not search for other A-class documents in this repo.*

All AI agents operating in this workspace MUST adhere to the following invariants. 

---

## 1. Core Architectural Invariants
*   **Velo-Free Portability:** Do not introduce proprietary "black-box" platforms. We use standard open-source tools (Next.js App Router, Supabase/PostgreSQL) deployed on Vercel.
*   **Package Manager:** Strictly `pnpm` (v10.27.0). Never run `npm install`.
*   **ZFS Storage Awareness:** This repo runs on a Vigyan Node. Respect the virtual store mappings (`/vigyan/dev-envs/...`). Do not attempt to modify the global store.
*   **Config-Driven Development:** Hardcoding strings is an anti-pattern. If a value might change (e.g., a social link, a product price, the founder's bio), it must be modified in `src/config/site.ts`.

## 2. Directory Boundaries (The Hybrid Model)
*   **The Public Face (`src/app/(marketing)`):** This route group is strictly public. Never place authenticated UI or proprietary business logic here.
*   **The Admin Vault (`src/app/(app)`):** The secure dashboard surface. All authenticated routes must be protected by Supabase Auth middleware.
*   **The Agentic Hub (`src/app/api`):** Webhooks (`/api/webhook/*`) must cryptographically verify payloads. The MCP API (`/api/mcp`) is the engine for n8n/Postiz automation.

## 3. Brand & Visual Enforcement

**The design system lives in one place: the `site-design` skill
(`.claude/skills/site-design/SKILL.md`). Load it before writing any UI.**
It covers tokens, the shadcn bridge, per-component rules, contrast/alignment
failure modes, the `VBField` validation contract, and copy voice.
`CLAUDE-BRIEF.md` (repo root) is the upstream design-system handoff the skill
was built from — the skill is the operational version; keep them in sync.

Only the non-obvious, repo-specific bits are restated here:

*   **Light-first warm-minimal, NOT dark-first glassmorphism.** (This section
    previously said the opposite — stale from before the 2026-08 warm redesign,
    corrected 2026-09-10.) Ground is warm ivory `#faf6ee`, never pure white;
    ink is `#1c1814`, never pure black. Glassmorphism is banned on light surfaces.
*   **Colour classes:** use the semantic tokens (`paper`/`sand`/`ink`/`muted`/
    `hairline`/`primary`/`accent`) from `tailwind.config.ts`. The older
    `brand-primary`/`brand-bytes`/`brand-dark` aliases still resolve and are kept
    for existing code, but new code should use the semantic names. **Never** use
    generic Tailwind palettes (`slate-*`/`gray-*`/`blue-*`/`zinc-*`) — they read
    cold against the warm ground.
*   **Typography:** Dual-language. `Inter` for English, `Noto Sans Devanagari`
    for Hindi.
*   **Image Wrapping:** For MS Word-style wrapping in the CMS, use the
    `.vb-post-image-left` and `.vb-post-image-right` utility classes.

## 4. Operational Guardrails
*   **No Secrets in Output:** Never `cat`, print, or commit `.env.local` contents.
*   **Secrets documentation (mandatory, temporary policy — repo is currently PRIVATE):** `docs/VIGYAN_SECRETS.md` holds real credential values directly, not just pointers, while this repo stays private — operator decision 2026-09-09. Every credential an agent creates, rotates, or discovers (API tokens, keys, passwords) MUST be recorded there with its actual value, not just "where it lives." **This reverses the moment the repo goes public**: before making this repo public, ALL real values must first be migrated out to Nextcloud (`files/admin/YourSite/web/vigyan-secrets.md`, VVC private repo) and scrubbed from this file (and, if any were ever committed, from git history — a private-repo credential is not automatically safe once history is exposed). Any agent asked to help make this repo public MUST treat that migration as a blocking prerequisite, not an optional cleanup step.
*   **Deterministic Validation:** Always run `pnpm build` to verify architectural integrity before completing a task. Do not leave the workspace in a broken state.
*   **Documentation Alignment:** Before making sweeping architectural changes, consult `docs/INDEX.md` and the docs it lists.
*   **Vercel Boundary:** Production traffic lands on Vercel first. Home-node services such as the WhatsApp FastAPI sidecar must be reached through an explicit Vercel proxy/funnel design, not by assuming local Python code is deployed with the site.
*   **Shared KB Bot Strategy:** WhatsApp, Telegram, and planned Sarvam voice bots must share one KB/RAG source for answers and translations unless a deliberate product decision creates separate knowledge scopes.
*   **Local Development Tunnels:** The user exclusively runs their own `pnpm dev` or `pnpm start` processes on **Port 3000**. For public webhook testing (e.g., Razorpay), use the canonical Tailscale Funnel script:
    *   **Script:** `sudo ./scripts/funnel.sh [on|off|status]`
    *   **Logic:** Maps local `3000` to public `https://<node-dns>.ts.net/`.
    *   **Requirement:** Agents MUST NOT attempt to use alternative tunneling tools or manual `tailscale` commands; always use the script to ensure configuration consistency.

## 5. Session Governance & Context Hygiene
*   **Session State:** Agents MUST read `work-units/session-state.json` first and update it upon completing significant architectural milestones.
*   **Archive State:** Deferred, superseded, or historical decisions belong in `work-units/session-state-archive.json`.
*   **Context Management:** When context usage approaches 33% of the token limit, agents must summarize progress in `work-units/session-state.json` and explicitly confirm the next logical starting point for the following session.
*   **Conciseness:** Be brief. Focus on intent and technical rationale.
