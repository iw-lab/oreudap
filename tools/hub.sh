#!/usr/bin/env bash
# 학교 허브 배포·명령 — 오르답은 hanmail 계정(8d3bdf75…)에 둔다.
#   왜 daum 이 아닌가: 2026-10-12 daum D1 이 상한 10개로 꽉 찼다 → 사용자 지시 «한메일 계정에 d1 하나 만들고».
#   로그인 = .cf-home → roblox/.cf-kid-home 의 default.toml 을 «가리키는 링크»(복사하면 refresh token 이 회전돼 둘 다 죽는다 — 메모리 oauth-copy-loses-rotated-token).
#   로그인 이메일이 다르면 멈춘다(계정이 조용히 바뀌는 사고 — 메모리 wrangler-login-switches-accounts-silently).
# 사용: tools/hub.sh deploy | tools/hub.sh <wrangler 인자…>
set -euo pipefail
R="$(cd "$(dirname "$0")/.." && pwd)"
cd "$R/hub"
export HOME="$R/.cf-home"
unset CLOUDFLARE_API_TOKEN CF_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID=8d3bdf75848452c42b8fccca0109c604
who=$(npx wrangler whoami 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -o 'email [^ ]*' | head -1 | cut -d' ' -f2 | sed 's/\.$//')
[ "$who" = "simssijjang@hanmail.net" ] || { echo "❌ 이 허브는 hanmail 계정 전용 — 지금 로그인: ${who:-없음}"; exit 3; }
if [ "${1:-}" = deploy ]; then exec npx wrangler deploy; fi
exec npx wrangler "$@"
