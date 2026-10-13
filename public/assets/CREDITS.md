# 크레딧 — 오르답

이 게임의 모든 에셋은 **직접 만들었습니다**. 외부에서 받아 온 그림·소리·글꼴이 없습니다.

| 종류 | 개수 | 만든 방법 |
|---|---|---|
| 캐릭터·발판·배경 이미지 | 22 | Meta AI 이미지 생성 후 배경 제거·리사이즈 |
| 효과음 | 24 | 오프라인 결정론 렌더(numpy 합성) |
| 배경 음악 | 6 | ACE-Step 로컬 생성, 이음새 없는 루프 |
| 낱말 발음 | 943 | EchoTale(같은 제작자)이 OpenAI TTS 로 생성한 것을 재인코딩 |
| 글꼴 | 0 | 기기에 이미 있는 시스템 글꼴만 사용(외부 요청 0) |
| 아이콘 | 2 | 코드로 그린 도형(PIL·SVG) |

## 쓰지 않은 것
- 외부 광고·분석 SDK
- 외부 폰트·CDN (아이의 IP 가 제3자에게 가지 않도록)
- 다른 게임의 그림·소리·규칙 조합

## 파일별 출처
- `images/bg-dawn.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/bg-day.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/bg-night.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/bg-sunset.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-bear-jump.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-bear.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-cat-jump.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-cat.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-dragon-jump.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-dragon.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-fox-jump.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-fox.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-owl-jump.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-owl.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-penguin-jump.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-penguin.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-rabbit-jump.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/char-rabbit.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/platform-cloud.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/platform-crystal.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/platform-stone.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `images/platform-wood.webp` — Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.
- `audio/bgm-rush.m4a` — ACE-Step 1.5 로컬 생성(gen-bgm.sh) → 이음새 없는 루프로 고정. 외부 서비스·크레딧 사용 0.
- `audio/bgm-rush.ogg` — ACE-Step 1.5 로컬 생성(gen-bgm.sh) → 이음새 없는 루프로 고정. 외부 서비스·크레딧 사용 0.
- `audio/bgm-tense.m4a` — ACE-Step 1.5 로컬 생성(gen-bgm.sh) → 이음새 없는 루프로 고정. 외부 서비스·크레딧 사용 0.
- `audio/bgm-tense.ogg` — ACE-Step 1.5 로컬 생성(gen-bgm.sh) → 이음새 없는 루프로 고정. 외부 서비스·크레딧 사용 0.
- `audio/bgm.m4a` — ACE-Step 1.5 로컬 생성(gen-bgm.sh) → 이음새 없는 루프로 고정. 외부 서비스·크레딧 사용 0.
- `audio/bgm.ogg` — ACE-Step 1.5 로컬 생성(gen-bgm.sh) → 이음새 없는 루프로 고정. 외부 서비스·크레딧 사용 0.
- `audio/button.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/button.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/coin.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/coin.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/correct.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/correct.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/gameover.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/gameover.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/heart.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/heart.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/heartbeat.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/heartbeat.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/land.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/land.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/record.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/record.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/school.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/school.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/streak.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/streak.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/timeout.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/timeout.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/wrong.m4a` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `audio/wrong.ogg` — game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.
- `say/*.m4a` — EchoTale(iwenglish) public/seed/_words 의 낱말 발음(OpenAI gpt-4o-mini-tts, voice: nova)을 무음 제거·loudnorm·AAC 32k 모노로 재인코딩(tools/import-word-audio.mjs). 같은 제작자의 자산.

기계가 읽는 원장은 `asset-license.json` 에 있습니다(53개 항목).
