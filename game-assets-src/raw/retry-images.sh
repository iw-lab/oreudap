#!/usr/bin/env bash
# 캐릭터 원화 7 + 세계 4 를 «다 생길 때까지» 뽑는다. GPT 웹앱·Firefly 둘 다 다른 세션과 1슬롯을 나눠 쓴다 —
# 잠금을 못 얻으면(rc 5/8) 2분 쉬고 다시. 이미 생긴 장은 건너뛴다(GPTWEB_SKIP_EXISTING · gb-image 의 Firefly 단계도 있는 out 은 뺀다).
cd "$(dirname "$0")/../.."
need() { python3 - <<'PY'
import json
n=0
for l in open('game-assets-src/raw/all.jsonl'):
    import os
    if l.strip() and not os.path.exists(json.loads(l)['out']): n+=1
print(n)
PY
}
for i in $(seq 1 40); do
  left=$(need); echo "[$(date +%H:%M)] 남은 $left장 (시도 $i)"
  [ "$left" = 0 ] && { echo "✅ 전부 생성"; exit 0; }
  ~/.claude/skills/game-builder/tools/gb-image.sh game-assets-src/raw/all.jsonl
  [ "$(need)" = 0 ] && { echo "✅ 전부 생성"; exit 0; }
  sleep 120
done
echo "❌ 40회 시도 후에도 $(need)장 남음"; exit 4
