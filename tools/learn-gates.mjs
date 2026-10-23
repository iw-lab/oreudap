#!/usr/bin/env node
/**
 * 학습 공통 4행 게이트 (GDD-v2 D55 = game-builder fun-and-learning-gates §D: D-1·D-2·D-3·D-6).
 * 게임 코어를 «직접 import» 한다(곡선을 베끼면 코드가 바뀌어도 영원히 통과한다).
 *
 *  D-1 정답 = 1차 자원 — 모르는 봇 셋(p=0 · 무작위 · 정답 위치 추측)이 «못 오른다»(중앙값 ≤ 4층) — 모든 모드
 *  D-2 학습 이득비 — 45% 아는 봇 ↔ 85% 아는 봇 중앙값 층 비 ≥ 1.25 (n ≥ 500). 문턱 ±5% 안이면 표본 4배
 *  D-3 노출 «명목 = 하한» — 판 시간 중 문항이 화면에 «답할 수 있게» 떠 있는 비율 ≥ 0.55(클래식·거울)
 *  D-6 문항 배열 다양성 — 실제 출제 순서를 game-builder check-question-variety.mjs 에 넣어 rc 0(2갈래·3갈래 따로)
 *
 *   node tools/learn-gates.mjs [N=500]          종료코드 0 PASS · 1 FAIL · 2 표본 부족 · 3 미실행
 *   node tools/learn-gates.mjs --inject=nolearn  회귀 주입: «정답이 아니어도 오른다»로 바꾸면 D-1·D-2 가 빨개야 한다
 */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { GameCore, PHASE } from '../src/core/game.js';
import { PersistentNotes } from '../src/core/srs.js';
import { makeRng } from '../src/core/rng.js';
import { MODES } from '../src/core/balance.js';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.replace(/^--/, '').split('=')));
const N = Number(args.N ?? 500);
const INJECT = args.inject || '';
const STEP = 10;
const MAX_MS = 15 * 60 * 1000;
const fails = [];
const FAIL = (m) => fails.push(m);
const log = (m) => console.log('  · ' + m);

const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/** policy: know(p) · random · position(위치 이력 카운팅) */
function run({ seed, p = 0, policy = 'know', mode = 'classic', subject = 'gugudan' }) {
  const core = new GameCore({ seed, subject, mode, notes: new PersistentNotes(), now: () => 1_700_000_000_000, revive: true });
  const rng = makeRng((seed * 2654435761 + 977) >>> 0);
  core.start();
  let pending = null, guard = 0, qTime = 0;
  const hist = [];
  while (core.phase !== PHASE.OVER && core.t < MAX_MS && guard++ < 300000) {
    // v3: 실제 판처럼 «다시 일어서기»를 받는다(판마다 1번 · 놓친 문제부터 3연속)
    if (core.phase === PHASE.DOWN) { core.beginRevive(); pending = null; }
    if (core.phase === PHASE.QUESTION && !core.answered) qTime += STEP;
    if (core.phase === PHASE.QUESTION && !core.answered && !pending) {
      const q = core.question, k = q.choices.length;
      let choice;
      if (policy === 'random') choice = Math.floor(rng() * k) % k;
      else if (policy === 'position') {
        const c = new Array(k).fill(0);
        for (const h of hist.slice(-6)) if (h < k) c[h] += 1;
        choice = c.indexOf(Math.min(...c));
      } else choice = rng() < p ? q.answerIndex : Math.floor(rng() * k) % k;
      // 회귀 주입: «아무거나 밟아도 정답» = 학습과 진행의 연결을 끊는다
      if (INJECT === 'nolearn') choice = q.answerIndex;
      pending = { at: core.t + Math.max(150, (0.85 + 0.2 * gauss(rng)) * 1000), choice };
    }
    if (pending && core.t >= pending.at) {
      if (core.question) hist.push(core.question.answerIndex);
      core.input(pending.choice);
      pending = null;
    }
    core.advance(STEP);
    if (core.phase === PHASE.RESOLVE) pending = null;
  }
  return { floor: core.floor, t: core.t, qTime };
}

function cell(o, n = N) {
  const fl = [], ex = [];
  for (let s = 1; s <= n; s++) { const r = run({ ...o, seed: s }); fl.push(r.floor); ex.push(r.t ? r.qTime / r.t : 0); }
  return { med: median(fl), mean: fl.reduce((a, b) => a + b, 0) / n, exposure: ex.reduce((a, b) => a + b, 0) / n };
}

console.log(`\n── 학습 공통 4행 (D55 · n=${N}${INJECT ? ` · 주입 ${INJECT}` : ''}) ──`);
if (N < 500) { console.log('❌ 표본 부족 — D-2 는 n ≥ 500'); process.exit(2); }

// D-1 — 모드마다 «모르는 봇 셋»이 못 오른다(오늘의 계단은 클래식 규칙이라 클래식이 대표)
for (const mode of Object.keys(MODES)) {
  const n = 200;
  const r0 = cell({ p: 0, mode }, n), rr = cell({ policy: 'random', mode }, n), rp = cell({ policy: 'position', mode }, n);
  const worst = Math.max(r0.med, rr.med, rp.med);
  log(`D-1 ${mode}: p=0 ${r0.med}층 · 무작위 ${rr.med}층 · 위치추측 ${rp.med}층`);
  // 60초 질주는 하트 5개라 찍어도 몇 층은 오른다 — 문턱을 «아는 봇의 1/4» 로 잡는다
  const cap = mode === 'sprint' ? Math.max(4, Math.floor(cell({ p: 0.85, mode }, n).med / 4)) : 4;
  if (worst > cap) FAIL(`D-1 ${mode}: 모르는 봇이 ${worst}층까지 오른다(> ${cap}) — 정답이 아니어도 진행된다`);
}

// D-2 — 45% ↔ 85% 이득비
const THR = 1.25;
let lo = cell({ p: 0.45 }), hi = cell({ p: 0.85 });
let ratio = hi.mean / Math.max(0.5, lo.mean);
if (Math.abs(ratio - THR) / THR < 0.05) { lo = cell({ p: 0.45 }, N * 4); hi = cell({ p: 0.85 }, N * 4); ratio = hi.mean / Math.max(0.5, lo.mean); log('D-2 문턱 근처 → 표본 4배로 다시 쟀다'); }
log(`D-2 이득비 ${ratio.toFixed(2)} (평균 ${lo.mean.toFixed(1)}층 → ${hi.mean.toFixed(1)}층, 문턱 ${THR})`);
if (!(ratio >= THR)) FAIL(`D-2 학습 이득비 ${ratio.toFixed(2)} < ${THR} — 더 알아도 더 못 오른다`);

// D-3 — 노출 비율(명목 0.55 = 판 시간의 절반 이상이 «문제를 보고 답하는 시간»)
const NOMINAL = 0.55;
for (const mode of ['classic', 'mirror', 'thrill', 'sprint']) {
  const e = cell({ p: 0.85, mode }, 200).exposure;
  log(`D-3 ${mode}: 문항 노출 ${(e * 100).toFixed(0)}%`);
  if (e < NOMINAL) FAIL(`D-3 ${mode}: 문항 노출 ${(e * 100).toFixed(0)}% < ${NOMINAL * 100}% — 판 시간 대부분이 연출이다`);
}

// D-6 — 실제 출제 순서(세션 30판 × 30문항)를 다양성 게이트에
const TOOL = path.join(os.homedir(), '.claude/skills/game-builder/tools/check-question-variety.mjs');
const dir = mkdtempSync(path.join(os.tmpdir(), 'oreudap-var-'));
for (const [label, startFloor, subject, mode] of [['구구단', 0, 'gugudan', 'classic'],
  ['영단어', 0, 'words34', 'classic'], ['국어', 0, 'korean34', 'classic'], ['거울', 0, 'gugudan', 'mirror']]) {
  const served = [];
  for (let s = 1; s <= 30; s++) {
    const core = new GameCore({ seed: 1000 + s, subject, mode, notes: new PersistentNotes(), now: () => 1_700_000_000_000, revive: true });
    core.floor = startFloor;   // 3갈래 구간에서 출발(층 60+ = 항상 3갈래)
    core.start();
    for (let i = 0; i < 25 && core.question; i++) {
      const q = core.question;
      served.push({ sid: `s${s}`, id: q.id, choices: q.choices, answer: q.answerIndex });
      core.input(q.answerIndex);
      core.advance(400);
    }
  }
  // V2(재출제 간격 ≥ 8)는 «실제 순서 전체»에서 잰다 — 보기 수로 나눈 뒤에 재면 사이 문항이 빠져 간격이 거짓으로 줄어든다
  const lastAt = new Map(); let gapBad = 0; const gapEx = [];
  served.forEach((x, i) => {
    const k = `${x.sid}|${x.id}`;
    if (lastAt.has(k) && i - lastAt.get(k) < 8) { gapBad += 1; if (gapEx.length < 3) gapEx.push(`${x.id} 간격 ${i - lastAt.get(k)}`); }
    lastAt.set(k, i);
  });
  if (gapBad) FAIL(`D-6 ${label}: 같은 문항이 8문항 안에 다시 나왔다 ${gapBad}건(${gapEx.join(', ')})`);
  // 갈래 수가 섞이는 구간(8~25층)이 있어 «보기 수»별로 나눠 잰다(V4 는 한 묶음 안의 보기 수가 같아야 한다)
  for (const k of [2, 3]) {
    const part = served.filter((x) => x.choices.length === k);
    if (part.length < 60) continue;
    const f = path.join(dir, `${label.replace(/\s/g, '-')}-${k}.json`);
    writeFileSync(f, JSON.stringify(part));
    try {
      const out = execFileSync('node', [TOOL, '--json', f, '--min', '30', '--min-gap', '1'], { encoding: 'utf8' });
      log(`D-6 ${label} 보기${k}: ${part.length}문항 — ${out.trim().split('\n').pop()}`);
    } catch (e) {
      FAIL(`D-6 ${label} 보기${k}: 다양성 게이트 rc ${e.status} — ${String(e.stdout || '').trim().split('\n').filter((l) => l.startsWith('❌')).join(' / ')}`);
    }
  }
}

if (fails.length) { console.log('\n❌ 학습 게이트 FAIL'); for (const f of fails) console.log('  ✖ ' + f); process.exit(1); }
console.log('\n✅ 학습 공통 4행 PASS (D-1 · D-2 · D-3 · D-6)');
