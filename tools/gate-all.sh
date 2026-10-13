#!/usr/bin/env bash
# 전체 게이트 — 배포 전 이 하나만 돌리면 된다.
# 종료코드 0 PASS · 1 FAIL · 3 미실행(도구가 죽음)
set -uo pipefail
cd "$(dirname "$0")/.."

FAILED=()
run() {
  local name="$1"; shift
  echo ""
  echo "▶ $name"
  if "$@"; then
    echo "  ✅ $name"
    return
  fi
  local rc=$?
  # 🔴 rc=3 은 «도구가 죽었다» = 미실행이지 실패가 아니다. 브라우저가 호스트 부하로 떨어지는
  #    일이 실제로 있었다(2026-09-04: 시각 QA 가 rc=3, 단독 재실행은 통과). 미실행은 한 번 다시 잰다.
  #    🚫 rc=1(진짜 실패)은 절대 재시도하지 않는다 — 재시도로 빨간불을 지우면 게이트가 아니다.
  if [[ $rc -eq 3 ]]; then
    echo "  ⚠️  $name 미실행(rc=3) — 한 번 다시 잰다"
    if "$@"; then
      echo "  ✅ $name (재실행)"
      return
    fi
    rc=$?
  fi
  echo "  ❌ $name (rc=$rc)"
  FAILED+=("$name(rc=$rc)")
}

run "유닛 테스트 (D2~D13·D27·D29)"    npx vitest run --reporter=dot
run "학습 데이터 (D23)"               node tools/check-data.mjs
run "정답 위치 균형 (D8)"             node tools/answer-balance.mjs
run "밸런스 격자 (D10·D8b)"           node tools/probe-grid.mjs N=300 --gate
run "다양성 (D30)"                    node tools/probe-variety.mjs --gate
run "모드 밸런스 (D33)"               node tools/probe-modes.mjs N=300 --gate
run "학습 공통 4행 (D55)"            node tools/learn-gates.mjs N=500
run "기본틀 정적 (D44)"               node "$HOME/.claude/skills/game-builder/tools/gate-baseline.mjs" . --static
run "이모지 0 (D50)"                  node "$HOME/.claude/skills/game-builder/tools/check-no-emoji.mjs" .
run "반응 9종 (D54)"                  node "$HOME/.claude/skills/game-builder/tools/check-juice.mjs" .
run "결정론 (D19)"                    "$HOME/.claude/skills/game-builder/tools/check-determinism.sh"
run "GDD 표 동기화"                   node tools/sync-gdd-table.mjs --check
run "에셋 매니페스트"                  python3 tools/process-assets.py --check
run "라이선스 원장 (D20)"             node tools/make-license.mjs --check
run "라이선스 게이트 (D20)"           "$HOME/.claude/bin/free-assets.sh" verify public/assets
run "빌드"                            npx vite build
run "2D 스모크 (D17·D18·D19·D22)"     node "$HOME/.claude/skills/game-builder/tools/phaser-smoke.mjs" --dir dist --page index.html --port 8181 --steps 600 --scene-cycles 5
run "시각 QA (D15·D16)"               node tools/qa-visual.mjs --dir dist
run "보기 맞춤 (D43)"                  node tools/qa-choice-fit.mjs --dir dist
run "플레이 QA (D13·D14·D21·D22·D29·D36)" node tools/qa-play.mjs --dir dist
run "BGM 강도 (D31)"                   node tools/qa-bgm.mjs --dir dist
run "영어 발음 (D32)"                  node tools/qa-voice.mjs --dir dist
run "낭독 지연 (D32b)"                node tools/qa-voice-latency.mjs --dir dist
run "모드 화면 (D34)"                  node tools/qa-modes.mjs --dir dist
run "놀이 방법 (D35)"                  node tools/qa-howto.mjs --dir dist
run "재방문·재미 (D37~D40)"     node tools/qa-retention.mjs --dir dist
run "세계·캐릭터 (D51·D52)"          node tools/qa-world.mjs --dir dist
run "올라가는 느낌 (D28)"             node tools/qa-climb.mjs --dir dist
run "성능·번들 (D25)"                 node tools/qa-perf.mjs --dir dist

echo ""
echo "════════════════════════════════════════════════"
if [ ${#FAILED[@]} -eq 0 ]; then
  echo "✅ 전체 게이트 통과 — 배포 가능"
  exit 0
fi
echo "❌ 실패 ${#FAILED[@]}건:"
for f in "${FAILED[@]}"; do echo "   · $f"; done
exit 1
