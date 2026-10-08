#!/usr/bin/env bash
# 오르답 등수 워커 전용 wrangler — daum 계정(simssijjang@daum.net)에 고정한다(2026-10-08 KV→D1 이전: gmail 계정 D1 10개 상한).
# 로그인은 ~/.cf-homes/daum 하나를 여러 프로젝트가 같이 쓴다(복사본을 두면 한쪽 갱신이 다른 쪽 토큰을 죽인다).
#   tools/cf.sh whoami · (worker/ 에서) ../tools/cf.sh deploy · tools/cf.sh d1 execute oreudap-rank --remote --file=…
set -euo pipefail
export HOME="$HOME/.cf-homes/daum" CLOUDFLARE_ACCOUNT_ID=a043bf13d2ac042d81de8aa70bd1f893 npm_config_cache="${npm_config_cache:-/Users/sim-insu/.npm}"
exec npx -y wrangler@4.83.0 "$@"
