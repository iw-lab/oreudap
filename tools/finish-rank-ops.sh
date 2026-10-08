#!/bin/bash
# ⚠️ 2026-10-08 등수 저장이 KV → D1(daum 계정)으로 옮겨 이 스크립트의 ②(KV 청소)는 더 이상 쓰이지 않는다. 남은 건 옛 기록용.
# 오르답 — 클라우드플레어 계정(gmail)이 있어야만 되는 두 가지.
#   ① 등수 워커 배포(봇 기록을 아이들 판에서 빼는 수정)
#   ② 오늘 판에 이미 쌓인 봇 기록 청소
# 🔴 반드시 simssijjang@gmail.com 계정이어야 한다. naver 계정으로는 워커가 안 보인다.
set -e
cd ~/Documents/dev/muhan/worker
NS=ce59a7c2c03b486299408a0a67a13d5c

echo "── 지금 로그인된 계정 확인"
npx wrangler whoami 2>&1 | grep -i "email\|associated" || true
echo
read -p "위가 gmail 계정이 맞습니까? (맞으면 엔터, 아니면 Ctrl+C 후 'npx wrangler login') " _

echo "── ① 워커 배포"
npx wrangler deploy

echo "── ② 오늘 판 청소 (봇이 쌓아 둔 줄)"
# 🔴 오늘 판에는 «선생님이 실제로 논 기록»도 섞여 있다(든든한두더지56 같은 것).
#    그래서 통째로 지우지 않고, 남길 이름을 KEEP 에 적으면 그 줄만 빼고 지운다.
#    예: KEEP="든든한두더지56" bash tools/finish-rank-ops.sh
KEEP="${KEEP:-}"
TODAY=$(TZ=Asia/Seoul date +%F)
npx wrangler kv key list --namespace-id $NS --remote --prefix "r:$TODAY:" > /tmp/oreudap-keys.json 2>/dev/null || true
KEEP="$KEEP" node -e '
const fs=require("fs");
const keep=(process.env.KEEP||"").split(",").map(s=>s.trim()).filter(Boolean);
const raw=fs.readFileSync("/tmp/oreudap-keys.json","utf8");
const rows=JSON.parse(raw.slice(raw.indexOf("[")));
const del=[], kept=[];
for (const r of rows) {
  // 키 모양: r:<날짜>:<과목>:<모드>:<이름>:<점수> — 과목 자체에 콜론이 들어 있으므로 «뒤에서» 센다.
  const p=r.name.split(":"); const nick=p[p.length-2];
  (keep.includes(nick) ? kept : del).push(r.name);
}
fs.writeFileSync("/tmp/oreudap-del.json", JSON.stringify(del));
console.log("남길 줄", kept.length, "개"); kept.forEach(k=>console.log("  · 유지", k));
console.log("지울 줄", del.length, "개");  del.forEach(k=>console.log("  · 삭제", k));
'
read -p "위대로 지웁니다. 계속하려면 엔터 (남길 이름이 있으면 Ctrl+C 후 KEEP=\"이름\" 로 다시) " _
npx wrangler kv bulk delete --namespace-id $NS --remote --force /tmp/oreudap-del.json

echo "── 확인"
curl -s "https://oreudap-rank.simssijjang-a04.workers.dev/api/rank?n=50"
echo
echo "✅ 끝. 봇 줄이 사라졌는지 위 rows 로 확인하세요."
