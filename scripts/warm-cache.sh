#!/usr/bin/env bash
# Request every sitemap URL once; report cache status and any non-HTML response.
# Usage: scripts/warm-cache.sh [https://www.example.com]
set -uo pipefail
BASE="${1:-https://www.example.com}"
n=0; fail=0
while read -r url; do
  n=$((n+1))
  hdr=$(curl -s -o /dev/null -D - -A site-cache-warmer -H 'Accept: text/html' "$url" | tr -d '\r')
  code=$(awk 'NR==1{print $2}' <<<"$hdr")
  type=$(awk -F': ' 'tolower($1)=="content-type"{print $2}' <<<"$hdr")
  cf=$(awk -F': ' 'tolower($1)=="cf-cache-status"{print $2}' <<<"$hdr")
  if [[ "$code" == 200 && "$type" == text/html* ]]; then printf 'ok   %-8s %s\n' "${cf:--}" "$url"
  else printf 'FAIL %s %s %s\n' "$code" "$type" "$url"; fail=$((fail+1)); fi
done < <(curl -s "$BASE/sitemap.xml" | grep -o '<loc>[^<]*</loc>' | sed 's#</\?loc>##g')
echo "$((n-fail))/$n returned HTML"
[ "$fail" -eq 0 ]
