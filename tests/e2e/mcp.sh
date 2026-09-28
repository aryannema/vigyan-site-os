#!/usr/bin/env bash
#
# End-to-end exercise of the MCP endpoint against a RUNNING SERVER and a REAL
# DATABASE.
#
# The vitest suites check pieces in isolation; this checks that the pieces are
# actually connected — HTTP, bearer auth, JSON-RPC framing, Zod validation, the
# capability check inside Postgres, and the audit row. A unit test cannot tell
# you the route forgot to await the verifier.
#
# Usage:
#   docker run -d --name siteos-e2e -p 55433:5432 \
#     -e POSTGRES_PASSWORD=e2elocal -e POSTGRES_DB=siteos postgres:16-alpine
#   psql ... -c 'CREATE EXTENSION pgcrypto'
#   # create roles anon/authenticated/service_role — see tests/README.md
#   for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"; done
#   pnpm build && pnpm start -p 3111 &
#   REPO=$PWD BASE=http://127.0.0.1:3111 bash tests/e2e/mcp.sh
set -uo pipefail
# NOTE: no `set -e`. A failing check must record a failure and continue, not
# abort the run and hide every test after it.

BASE="${BASE:-http://127.0.0.1:3111}"
MCP="$BASE/api/mcp"
SHARED="${MCP_SECRET_KEY:?set MCP_SECRET_KEY}"

pass=0; fail=0
ok()   { printf '  [ok  ] %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  [FAIL] %s\n     %s\n' "$1" "${2:-}"; fail=$((fail+1)); }
check(){ # name, expected, actual
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected '$2' got '$3'"; fi
}

# Body on stdout, status in a file. NOT a variable: callers use $(rpc ...),
# which runs this in a subshell, so an assignment here would never reach them —
# and the check would silently read the PREVIOUS call's status.
CODE_FILE=$(mktemp)
rpc() { # auth-header, json-body -> body on stdout; status in $(rpc_code)
  local hdr="$1" body="$2" out
  out=$(curl -s -w '\n%{http_code}' -X POST "$MCP" \
        -H 'Content-Type: application/json' ${hdr:+-H "$hdr"} -d "$body")
  printf '%s' "${out##*$'\n'}" > "$CODE_FILE"
  printf '%s' "${out%$'\n'*}"
}
rpc_code() { cat "$CODE_FILE"; }

echo
echo "  Authentication"
echo

rpc "" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' >/dev/null
check "no credential is rejected" "401" "$(rpc_code)"

rpc "Authorization: Bearer wrong-secret" \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' >/dev/null
check "wrong secret is rejected" "401" "$(rpc_code)"

body=$(rpc "Authorization: Bearer $SHARED" \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}')
check "shared secret is accepted" "200" "$(rpc_code)"
proto=$(printf '%s' "$body" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("result",{}).get("protocolVersion","?"))' 2>/dev/null)
[ -n "$proto" ] && [ "$proto" != "?" ] && ok "initialize returns protocolVersion ($proto)" \
  || bad "initialize returns protocolVersion" "$body"

echo
echo "  JWT"
echo

PAIR=$(cd "$REPO" && pnpm -s mcp:token --issue agent@example.com 2>/dev/null)
ACCESS=$(printf '%s' "$PAIR" | python3 -c 'import json,sys;print(json.load(sys.stdin)["access_token"])')
REFRESH=$(printf '%s' "$PAIR" | python3 -c 'import json,sys;print(json.load(sys.stdin)["refresh_token"])')
[ -n "$ACCESS" ] && ok "issued an access/refresh pair" || bad "issued a pair" "$PAIR"

rpc "Authorization: Bearer $ACCESS" \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' >/dev/null
check "access token authenticates" "200" "$(rpc_code)"

# The whole point of the typ claim: a 30-day refresh token must not call tools.
rpc "Authorization: Bearer $REFRESH" \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' >/dev/null
check "refresh token CANNOT call tools" "401" "$(rpc_code)"

echo
echo "  Refresh endpoint"
echo

out=$(curl -s -w '\n%{http_code}' -X POST "$MCP/refresh" \
      -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}")
code="${out##*$'\n'}"; rbody="${out%$'\n'*}"
check "refresh returns 200" "200" "$code"
NEW=$(printf '%s' "$rbody" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
[ -n "$NEW" ] && ok "refresh issued a new access token" || bad "refresh issued a token" "$rbody"

rpc "Authorization: Bearer $NEW" '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' >/dev/null
check "the refreshed token works" "200" "$(rpc_code)"

# An access token must not mint more access tokens.
out=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$MCP/refresh" \
      -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$ACCESS\"}")
check "access token REJECTED at refresh" "401" "$out"

nostore=$(curl -s -D- -o /dev/null -X POST "$MCP/refresh" \
  -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}" \
  | grep -ci 'cache-control: no-store' || true)
check "refresh response is no-store" "1" "$nostore"

echo
echo "  Transport"
echo

code=$(curl -s -o /dev/null -w '%{http_code}' "$MCP" -H "Authorization: Bearer $SHARED")
check "GET declines the optional stream (405)" "405" "$code"

allow=$(curl -s -D- -o /dev/null "$MCP" -H "Authorization: Bearer $SHARED" | grep -ci 'allow: POST' || true)
check "GET advertises Allow: POST" "1" "$allow"

code=$(curl -s -o /dev/null -w '%{http_code}' "$MCP")
check "GET without a credential is 401" "401" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$MCP" -H "Authorization: Bearer $SHARED")
check "DELETE returns 204 (stateless)" "204" "$code"

cors=$(curl -s -D- -o /dev/null -X OPTIONS "$MCP" | grep -ci 'access-control-allow-origin' || true)
check "OPTIONS does NOT reflect an origin" "0" "$cors"

echo
echo "  Tools"
echo

body=$(rpc "Authorization: Bearer $ACCESS" '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
n=$(printf '%s' "$body" | python3 -c 'import json,sys;print(len(json.load(sys.stdin).get("result",{}).get("tools",[])))' 2>/dev/null || echo 0)
[ "${n:-0}" -gt 0 ] && ok "tools/list returned $n tools" || bad "tools/list returned tools" "$body"

printf '%s' "$body" | python3 -c '
import json,sys
for t in json.load(sys.stdin).get("result",{}).get("tools",[])[:8]:
    print("        -", t["name"])
' 2>/dev/null

body=$(rpc "Authorization: Bearer $ACCESS" \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"__no_such_tool__","arguments":{}}}')
err=$(printf '%s' "$body" | python3 -c 'import json,sys;print("error" in json.load(sys.stdin))' 2>/dev/null)
check "an unknown tool returns a JSON-RPC error" "True" "$err"

# ---------------------------------------------------------------- capability
#
# The part that matters most, and the part a unit test cannot reach: the
# permission decision is made by POSTGRES, not by this route. Same endpoint,
# same tool, two different JWT subjects — one allowed, one refused.
#
# Requires DATABASE_URL and two seeded users. Skipped, loudly, when absent:
# a silent skip is how a suite ends up proving nothing.
echo
echo "  Capability enforcement"
echo

if [ -z "${DATABASE_URL:-}" ] || ! command -v psql >/dev/null; then
  echo "  [skip] DATABASE_URL or psql missing — capability checks NOT run"
  echo "         These are the most valuable assertions here. See tests/README.md."
else
  SLUG="e2e-$(date +%s)"
  body=$(rpc "Authorization: Bearer $ACCESS" \
    "{\"jsonrpc\":\"2.0\",\"id\":20,\"method\":\"tools/call\",\"params\":{\"name\":\"create_post\",\"arguments\":{\"title\":\"e2e\",\"slug\":\"$SLUG\",\"content\":\"x\",\"category\":\"engineering\"}}}")
  n=$(psql "$DATABASE_URL" -t -A -c "select count(*) from public.posts where slug='$SLUG';" 2>/dev/null || true)
  check "an editor CAN create a post" "1" "${n:-0}"

  # Two rows per write is correct, not a duplicate: perform_action() records the
  # authorized action, and the trigger records the row change independently. The
  # trigger fires even if a future code path forgets perform_action.
  a=$(psql "$DATABASE_URL" -t -A -c "select count(*) from public.action_audit_log l join public.posts p on p.id::text=l.target_id where p.slug='$SLUG';" 2>/dev/null || true)
  check "the write was audited (2 layers)" "2" "${a:-0}"

  claim=$(psql "$DATABASE_URL" -t -A -c "select count(*) from public.action_audit_log l join public.posts p on p.id::text=l.target_id where p.slug='$SLUG' and l.actor_claim is not null;" 2>/dev/null || true)
  check "the audit names the JWT subject" "1" "${claim:-0}"

  if [ -n "${VIEWER_TOKEN:-}" ]; then
    DENY="e2e-deny-$(date +%s)"
    body=$(rpc "Authorization: Bearer $VIEWER_TOKEN" \
      "{\"jsonrpc\":\"2.0\",\"id\":21,\"method\":\"tools/call\",\"params\":{\"name\":\"create_post\",\"arguments\":{\"title\":\"denied\",\"slug\":\"$DENY\",\"content\":\"x\",\"category\":\"engineering\"}}}")
    denied=$(printf '%s' "$body" | grep -ci "not permitted" || true)
    check "a viewer is REFUSED by the database" "1" "$denied"
    n=$(psql "$DATABASE_URL" -t -A -c "select count(*) from public.posts where slug='$DENY';" 2>/dev/null || true)
    check "and nothing was written" "0" "${n:-0}"
  else
    echo "  [skip] VIEWER_TOKEN unset — denial path NOT tested"
  fi
fi

echo
echo "  ── $pass passed, $fail failed"
echo
rm -f "$CODE_FILE"
[ "$fail" -eq 0 ]
