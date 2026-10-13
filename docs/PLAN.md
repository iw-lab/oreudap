# PLAN — 오르답 v2 (GDD-v2 승인 2026-10-13)

## 2-1. 구조 (로직·렌더 분리 유지)
- `src/core/` — DOM·Phaser import 0(기존). 거울 계단 = `questions.js` 에 `mirror` 방향 추가(문항 → 보기 뒤집기), `balance.MODES.mirror`.
- `src/scenes/WorldScene.js` — 렌더만. 캐릭터 = 리그 아틀라스(`public/assets/rig/<id>.png/.json`) 애니(idle·jump·cheer·sad), 세계 = 구간 4종 × 시차 3층.
- `src/ui/` — DOM 오버레이(글자·터치). 새 `src/gb/`(키트 클라이언트 — 고치지 않는다), `src/ui/icons.js`(lucide SVG 자체 호스팅).
- `api/hub.js`(Vercel 중계, 키트) · 허브 서버 = daum Worker + D1 `oreudap-hub`(키트 `--free-play`).
- 옛 개인 등수: `rankClient.js` 호출·«오늘의 등수» DOM·이름 칸 제거. `worker/`(옛 등수 워커)는 손대지 않는다.

## 2-3. 에셋 계획 (asset-2d-grammar 슬롯 · `game-assets-src/prompts.json`)
- STYLE(공통): `cute chibi animal mascot, big head about 2.5 heads tall, soft clean toon shading, thick dark outline, warm saturated palette`
- 캐릭터 7(토끼·고양이·곰·여우·부엉이·펭귄·용): VIEW `front view` · POSE `T-pose, arms straight out horizontally to both sides, legs slightly apart` · FRAMING `full body, both feet visible, single isolated character, centered, 10% margin` · BG `plain flat single-color light gray background, no floor, no shadow` · NEG `no text, no props`.
  → `rig-characters.py`(shape human · dir S · size 256 · frames 12 · actions idle·jump·cheer·sad · mocap jump=02_04 auto · cheer=79_69 · sad=79_71) → `replaces` 옛 `char-*.webp` 14장.
- 세계 4(숲·구름·우주·용암) × 층 3(먼 하늘 / 중경 / 가까운 장식) — `side view, horizon at 40%`, 세로 게임이라 **세로 이음(vertically tileable) 1:2**. 먼 층은 컷아웃 없음, 중·근경은 단색 배경 + `cutout-flood.py`.
- 발판 5(나무·구름·수정·현무암·금) — `single object, front view slightly from above, 15% margin`.
- 아이콘 14(과목 5·구간 4·모드 5) — 같은 STYLE, `single object icon`.
- 백엔드: GPT 웹 1순위(`tools/gb-image.sh`) → 막히면 Firefly. 게이트 `check-image-engine.mjs` · `check-sprite-alpha.py` · `gate-char-rig.mjs`. 에셋 30개+ → 쇼룸 `qa/showroom.html`.
- SFX 추가 4(land·heart·record·school) = `gen-sfx.py`.

## 2-4. 작업 분해
| 단계 | 내용 | 종료 조건 |
|---|---|---|
| 3-A 기반 | 키트 설치(`--free-play --host vercel`) · 개인 등수 제거 · lucide 아이콘 · 이모지 0 | `gate-baseline --static` PASS · `check-no-emoji` PASS · 기존 `npm test` 초록 |
| 3-B 첫 화면 | 기본틀 셸(학교 순위 맨 위·과목 칩·시작 1개·모드 카드 5·보조 줄) · PC 2단/태블릿/모바일 적응형 · 자동 전체화면 | 3폭 스크린샷 · 겹침/가로 스크롤 0 |
| 3-C 거울 계단 | 코어 `mirror` 방향 · 모드 · probe-modes 행 · 보기 맞춤 | vitest · `probe-modes` · D43 · answer-balance |
| 3-D 에셋 | 원화 생성 → 리그 7 · 세계 4×3 · 발판 5 · 아이콘 14 · SFX 4 → 씬 연결(구간 = 여정) | `gate-char-rig` FAIL 0 · sprite-alpha 0 FAIL · 쇼룸 |
| 3-E 반응·마감 | juice 9종 · 학교 점수 토스트 · 플레이 PC 좌우 패널 | `check-juice` PASS(≥9) |
| 4 검증 | `npm run gate` + 스모크 + 신규 D44~D56 게이트 · 배포 · 라이브 B1~B8 | 전부 rc 0 |
