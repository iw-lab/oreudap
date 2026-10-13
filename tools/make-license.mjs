#!/usr/bin/env node
// 라이선스 원장 + 크레딧 생성 (D20). 배포 전 free-assets.sh / free-audio.sh verify 가 이 원장을 본다.
// 🔴 손으로 적지 않는다 — 에셋이 늘면 원장이 반드시 어긋난다. --check 로 어긋남을 막는다.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DEST = path.join(ROOT, 'public', 'assets');
const CHECK = process.argv.includes('--check');

const SOURCES = {
  image: {
    license: 'self-generated',
    source: 'Meta AI 이미지 생성 → 배경 제거·리사이즈(tools/process-assets.py). 오르답 제작진이 이 게임을 위해 생성.',
  },
  zone: {
    license: 'self-generated',
    source: 'GPT 웹앱 이미지 생성(game-builder gb-image.sh · 원장 game-assets-src/zones/_engine.json) → 720×1280 webp(tools/process-assets.py).',
  },
  rig: {
    license: 'self-generated',
    source: 'GPT 웹앱 T포즈 원화(game-assets-src/rig/src/_engine.json) → Adobe Firefly 3D → Blender 뼈대·CMU 모션캡처(공개) → 스프라이트 아틀라스(game-builder rig-characters.py).',
  },
  sfx: {
    license: 'self-generated',
    source: 'game-builder gen-sfx.py 오프라인 결정론 렌더(numpy) → loudnorm·ogg/m4a 변환.',
  },
  bgm: {
    license: 'self-generated',
    source: 'ACE-Step 1.5 로컬 생성(gen-bgm.sh) → 이음새 없는 루프로 고정. 외부 서비스·크레딧 사용 0.',
  },
  // 🔴 이것만 «다른 프로젝트에서 가져온» 자산이다. 다만 남의 것이 아니라 같은 제작자의
  //    EchoTale(iwenglish)이 OpenAI gpt-4o-mini-tts(voice: nova)로 생성해 둔 것을 재인코딩했다.
  //    출처를 뭉뚱그리면 나중에 「이건 어디서 왔더라」가 된다 — 경로까지 적어 둔다.
  say: {
    license: 'self-generated',
    source: 'EchoTale(iwenglish) public/seed/_words 의 낱말 발음(OpenAI gpt-4o-mini-tts, voice: nova)을 '
      + '무음 제거·loudnorm·AAC 32k 모노로 재인코딩(tools/import-word-audio.mjs). 같은 제작자의 자산.',
  },
};

const entries = [];
for (const f of fs.readdirSync(path.join(DEST, 'images')).sort()) {
  if (!/\.(webp|png|svg)$/.test(f)) continue;
  entries.push(f.startsWith('zone-') ? { file: `images/${f}`, ...SOURCES.zone, date: '2026-10-13' }
    : { file: `images/${f}`, ...SOURCES.image, date: '2026-09-04' });
}
if (fs.existsSync(path.join(DEST, 'rig'))) {
  for (const f of fs.readdirSync(path.join(DEST, 'rig')).sort()) {
    if (!/\.(png|json)$/.test(f)) continue;
    entries.push({ file: `rig/${f}`, ...SOURCES.rig, date: '2026-10-13' });
  }
}
for (const f of fs.readdirSync(path.join(DEST, 'audio')).sort()) {
  if (!/\.(ogg|m4a)$/.test(f)) continue;
  const kind = f.startsWith('bgm') ? SOURCES.bgm : SOURCES.sfx;
  entries.push({ file: `audio/${f}`, ...kind, date: '2026-09-04' });
}

// 🔴 낱말 발음은 943개다 — 파일마다 한 줄씩 적으면 원장이 그 하나로 뒤덮여 «읽을 수 없는 원장»이
//    된다. 출처가 파일마다 다르지 않으므로 코퍼스 한 항목으로 적고 개수를 명시한다.
const sayFiles = fs.existsSync(path.join(DEST, 'say'))
  ? fs.readdirSync(path.join(DEST, 'say')).filter((f) => f.endsWith('.m4a')) : [];
if (sayFiles.length) {
  entries.push({ file: 'say/*.m4a', count: sayFiles.length, ...SOURCES.say, date: '2026-09-05' });
}

const ledger = { version: 1, project: 'oreudap', entries };
const ledgerText = `${JSON.stringify(ledger, null, 2)}\n`;

const credits = `# 크레딧 — 오르답

이 게임의 모든 에셋은 **직접 만들었습니다**. 외부에서 받아 온 그림·소리·글꼴이 없습니다.

| 종류 | 개수 | 만든 방법 |
|---|---|---|
| 캐릭터·발판·배경 이미지 | ${entries.filter((e) => e.file.startsWith('images/')).length} | Meta AI 이미지 생성 후 배경 제거·리사이즈 |
| 효과음 | ${entries.filter((e) => e.file.startsWith('audio/') && !e.file.includes('bgm')).length} | 오프라인 결정론 렌더(numpy 합성) |
| 배경 음악 | ${entries.filter((e) => e.file.includes('bgm')).length} | ACE-Step 로컬 생성, 이음새 없는 루프 |
| 낱말 발음 | ${sayFiles.length} | EchoTale(같은 제작자)이 OpenAI TTS 로 생성한 것을 재인코딩 |
| 글꼴 | 0 | 기기에 이미 있는 시스템 글꼴만 사용(외부 요청 0) |
| 아이콘 | 2 | 코드로 그린 도형(PIL·SVG) |

## 쓰지 않은 것
- 외부 광고·분석 SDK
- 외부 폰트·CDN (아이의 IP 가 제3자에게 가지 않도록)
- 다른 게임의 그림·소리·규칙 조합

## 파일별 출처
${entries.map((e) => `- \`${e.file}\` — ${e.source}`).join('\n')}

기계가 읽는 원장은 \`asset-license.json\` 에 있습니다(${entries.length}개 항목).
`;

const LEDGER_PATH = path.join(DEST, 'asset-license.json');
const AUDIO_LEDGER = path.join(DEST, 'audio-license.json');
const CREDITS_PATH = path.join(DEST, 'CREDITS.md');

const audioLedger = {
  version: 1,
  entries: entries.filter((e) => e.file.startsWith('audio/')).map((e) => ({ ...e, file: e.file.replace('audio/', '') })),
};
const audioText = `${JSON.stringify(audioLedger, null, 2)}\n`;

if (CHECK) {
  const same = (p, t) => fs.existsSync(p) && fs.readFileSync(p, 'utf8') === t;
  const bad = [];
  if (!same(LEDGER_PATH, ledgerText)) bad.push('asset-license.json');
  if (!same(AUDIO_LEDGER, audioText)) bad.push('audio-license.json');
  if (!same(CREDITS_PATH, credits)) bad.push('CREDITS.md');
  if (bad.length) {
    console.error(`❌ 라이선스 원장이 에셋과 어긋난다 (${bad.join(', ')}) — \`node tools/make-license.mjs\` 를 돌려라.`);
    process.exit(1);
  }
  console.log(`✅ 라이선스 원장 일치 · 항목 ${entries.length}개 · 전부 self-generated`);
} else {
  fs.writeFileSync(LEDGER_PATH, ledgerText);
  fs.writeFileSync(AUDIO_LEDGER, audioText);
  fs.writeFileSync(CREDITS_PATH, credits);
  console.log(`✅ 원장 ${entries.length}건 + CREDITS.md 생성`);
}
