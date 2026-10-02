#!/usr/bin/env node
// agent-memory.mjs — share what coding agents know about THIS repo with Cowork / claude.ai.
//
//   pnpm agents:memory --out <folder you sync>   e.g. ~/Nextcloud/Claude-Shared  or  ~/Google Drive/Claude-Shared
//
// Writes <out>/<repo>.md with: AGENTS.md, CLAUDE.md, GEMINI.md, CODEX.md, the session state
// (work-units/session-state.json) and Claude Code's memory for this repo
// (~/.claude/projects/<this-path>/memory/*.md). Lines that look like secrets are withheld.
// Read-only on the sources. Guide: docs/AGENT_MEMORY_SHARING.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const i = args.indexOf('--out');
if (i < 0 || !args[i + 1]) { console.error('usage: pnpm agents:memory --out <synced folder>'); process.exit(2); }
const out = path.resolve(args[i + 1].replace(/^~(?=$|[\\/])/, os.homedir()));

const SECRETISH = /(api[_-]?key|secret|token|password|passwd|bearer)\s*[:=]\s*\S{8,}|-----BEGIN [A-Z ]*PRIVATE KEY|\b(sk|rzp|ghp|xox[bp])[-_][A-Za-z0-9]{12,}/i;
let withheld = 0;
const clean = (t) => t.split('\n').filter((l) => !(SECRETISH.test(l) && ++withheld)).join('\n').trim();

const repo = path.basename(ROOT);
let doc = `# ${repo} — agent memory\n\nGenerated ${new Date().toISOString()} on ${os.hostname()} by \`pnpm agents:memory\`. Read-only copy; edit the originals.\n`;
const files = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'CODEX.md', 'work-units/session-state.json'];
for (const f of files) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const body = clean(fs.readFileSync(p, 'utf8'));
  doc += `\n---\n\n## ${f}\n\n${f.endsWith('.json') ? '```json\n' + body + '\n```' : body}\n`;
}
// Claude Code keeps per-project memory under ~/.claude/projects/<path with / replaced by ->/memory
const memDir = path.join(os.homedir(), '.claude', 'projects', ROOT.replace(/[\\/:]/g, '-'), 'memory');
if (fs.existsSync(memDir)) {
  for (const f of fs.readdirSync(memDir).filter((f) => f.endsWith('.md')).sort()) {
    doc += `\n---\n\n## Claude Code memory / ${f}\n\n${clean(fs.readFileSync(path.join(memDir, f), 'utf8'))}\n`;
  }
}
fs.mkdirSync(out, { recursive: true });
const dest = path.join(out, `${repo}.md`);
fs.writeFileSync(dest, doc);
console.log(`wrote ${dest}${withheld ? ` (${withheld} secret-looking line(s) withheld)` : ''}`);
