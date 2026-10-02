# Sharing agent memory across Claude Code, Cowork and claude.ai

Coding agents learn things while they work on this repo: your preferences, decisions and
where the work stands. Where that knowledge lives depends on the surface:

| Surface | Where its memory lives | Sees the others? |
|---|---|---|
| Claude Code (and Codex, OpenCode, Antigravity) | this repo (`AGENTS.md`, `CLAUDE.md`, `work-units/session-state.json`) + Claude Code's per-machine memory (`~/.claude/projects/…/memory/`) | no |
| claude.ai chat | your claude.ai account (memory, Projects) | shares with Cowork |
| Cowork (Claude desktop app) | your claude.ai account + folders you give it | shares with claude.ai |

Claude Code's memory never leaves the machine on its own. To let Cowork and claude.ai use it,
export it to a folder you sync:

```
pnpm agents:memory --out ~/Nextcloud/Claude-Shared      # or Google Drive, Dropbox, OneDrive…
```

This writes `Claude-Shared/<repo>.md`: the agent rules, the current session state and Claude
Code's memory for this repo. Lines that look like secrets are left out. Run it whenever you want
the copy refreshed, or from a timer:

```
# Linux, hourly (crontab -e)
0 * * * * cd /path/to/repo && pnpm -s agents:memory --out ~/Nextcloud/Claude-Shared
```

## Using it

- **Cowork:** give the task access to your synced `Claude-Shared` folder, then ask, for example:
  *"Read Claude-Shared/my-site.md and tell me what's pending."*
- **claude.ai:** Project → Project knowledge → add `Claude-Shared/<repo>.md`. Project files are
  copies, so re-add after big changes.
- **Other machines:** the sync app brings the same file everywhere, so every surface reads the
  same context.

## What it does not do

- It does not push anything back. Edit `AGENTS.md`, the session state or the memory files in the repo.
- It does not include `.env`, the secrets vault or any credentials, and it filters secret-looking lines.
- It is one-way and per repo. To gather many repos and machines into one place, use a fleet
  tool. The vigyan-llm-cli `interop share` command does this hourly into Nextcloud.
