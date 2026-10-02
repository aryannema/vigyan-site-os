#!/usr/bin/env bash
# agents-smoke.sh — prove the bundled MCP servers work from real agents. READ-ONLY.
# Never prints a token. Set (only the ones you want tested):
#   SITE_MCP_KEY            this site's MCP_SECRET_KEY (Admin > Settings > Secrets > Show)
#   MCP_CALLER_LABEL        audit label for these calls (default: agents-smoke)
#   POSTIZ_BACKEND_URL, POSTIZ_API_KEY      Postiz > Settings > Public API
#   N8N_URL, N8N_MCP_TOKEN                  n8n > Settings > Instance-level MCP
# Agents must be logged in once: claude, codex, agy.
# Run from the repo root: bash scripts/agents-smoke.sh
set -uo pipefail
export MCP_CALLER_LABEL="${MCP_CALLER_LABEL:-agents-smoke}"
SITE_URL="$(node -e "const j=require('./.mcp.json');process.stdout.write(j.mcpServers.site.url)")"
pass=0; fail=0; skip=0
ok()   { echo "  PASS  $*"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $*"; fail=$((fail+1)); }
skp()  { echo "  skip  $*"; skip=$((skip+1)); }

# ── 1. protocol: initialize + tools/list ─────────────────────────────────────
rpc() { # url auth-header-or-empty extra-header-or-empty body
  curl -s -m 30 -X POST "$1" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
    -H 'mcp-protocol-version: 2025-06-18' ${2:+-H "$2"} ${3:+-H "$3"} --data "$4"
}
probe() { # name url auth extra
  local init tools n
  init=$(rpc "$2" "$3" "$4" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"agents-smoke","version":"1"}}}')
  if ! echo "$init" | grep -q '"protocolVersion"'; then bad "$1 initialize ($(echo "$init" | head -c 120))"; return; fi
  tools=$(rpc "$2" "$3" "$4" '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')
  n=$(echo "$tools" | grep -o '"name"' | wc -l)
  [ "$n" -gt 0 ] && ok "$1 initialize + tools/list ($n tools)" || bad "$1 tools/list empty"
}
echo "1. MCP protocol (initialize + tools/list)"
[ -n "${SITE_MCP_KEY:-}" ] && probe site "$SITE_URL" "Authorization: Bearer $SITE_MCP_KEY" "X-Caller-Label: $MCP_CALLER_LABEL" || skp "site (SITE_MCP_KEY not set)"
[ -n "${POSTIZ_API_KEY:-}" ] && [ -n "${POSTIZ_BACKEND_URL:-}" ] && probe postiz "$POSTIZ_BACKEND_URL/mcp/$POSTIZ_API_KEY" "" "" || skp "postiz (POSTIZ_BACKEND_URL/POSTIZ_API_KEY not set)"
[ -n "${N8N_MCP_TOKEN:-}" ] && [ -n "${N8N_URL:-}" ] && probe n8n "$N8N_URL/mcp-server/http" "Authorization: Bearer $N8N_MCP_TOKEN" "" || skp "n8n (N8N_URL/N8N_MCP_TOKEN not set)"

# ── 2. agents: each must CALL site.list_pages and report the count ──────────
PROMPT='Use the MCP server named "site" and call its tool list_pages (no arguments). Reply with ONLY the number of page ids it returned, nothing else. If you cannot call the tool, reply exactly NO_TOOL.'
check() { # agent output
  local out; out=$(echo "$2" | tr -d '\r' | grep -Eo '^[[:space:]]*[0-9]+[[:space:]]*$|NO_TOOL' | tail -1 | tr -d ' ')
  if [[ "$out" =~ ^[0-9]+$ ]]; then ok "$1 called site.list_pages -> $out pages"; else bad "$1 (${out:-no answer}: $(echo "$2" | tail -1 | head -c 140))"; fi
}
echo "2. Agents calling the site MCP"
if [ -z "${SITE_MCP_KEY:-}" ]; then skp "agents (SITE_MCP_KEY not set)"; else
  command -v claude >/dev/null && check claude "$(timeout 240 claude -p "$PROMPT" --mcp-config .mcp.json --strict-mcp-config --allowedTools mcp__site__list_pages 2>&1)" || skp claude
  command -v codex  >/dev/null && check codex  "$(timeout 240 codex exec --skip-git-repo-check -c 'approval_policy="never"' "$PROMPT" 2>&1)" || skp codex
  command -v agy    >/dev/null && check antigravity "$(timeout 240 agy -p "$PROMPT" --dangerously-skip-permissions 2>&1)" || skp antigravity
fi

echo; echo "result: $pass passed, $fail failed, $skip skipped"
[ "$fail" -eq 0 ]
