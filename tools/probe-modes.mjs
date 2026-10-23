#!/usr/bin/env node
/**
 * 모드별 난이도 격자 (D33). 코어를 직접 돌린다 — 곡선을 베끼면 검산이 아니라 두 번째 구현이다.
 *
 * 🔴 모드는 «더 어려운 클래식»이면 안 된다. 서로 다른 이유로 죽어야 모드다:
 *    클래식 = 오답 한 번(문항 시계) / 아슬아슬 = 오답 또는 기력 고갈 / 60초 질주 = 시간 종료(오답은 감점).
 *    이 게이트는 그 «사인»의 분포까지 본다 — 아슬아슬에서 대부분 오답으로 끝나면
 *    기력 게이지는 장식이라는 뜻이다.
 *
 *   node tools/probe-modes.mjs [N=300] [--gate]
 */
import { GameCore, PHASE } from '../src/core/game.js';
import { PersistentNotes } from '../src/core/srs.js';
import { makeRng } from '../src/core/rng.js';
import { MODES } from '../src/core/balance.js';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=')));
const GATE = process.argv.includes('--gate');
const N = Number(args.N ?? 300);
const MU = Number(args.MU ?? 0.85);
const SD = Number(args.SD ?? 0.20);
const SUBJECT = args.subject ?? 'gugudan';
const STEP = 10;
const MAX_MS = 20 * 60 * 1000;

const gauss = (rng) => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());

function runBot({ p, seed, mode, mu = MU, sd = SD }) {
  const core = new GameCore({ seed, subject: SUBJECT, mode, notes: new PersistentNotes(), now: () => 1_700_000_000_000, revive: true });
  const botRng = makeRng(seed * 2654435761 + 12345);
  core.start();
  let pending = null;
  let guard = 0;
  let lowMs = 0;      // 기력이 «위험 구간»에 머문 시간 — 아슬아슬함의 실측치
  while (core.phase !== PHASE.OVER && core.t < MAX_MS && guard++ < 400000) {
    // v3: 실제 판처럼 «다시 일어서기»를 받는다(판마다 1번 · 놓친 문제부터 3연속)
    if (core.phase === PHASE.DOWN) { core.beginRevive(); pending = null; }
    if (core.phase === PHASE.QUESTION && !core.answered && !pending) {
      const q = core.question;
      const k = q.choices.length;
      const choice = botRng() < p ? q.answerIndex : Math.floor(botRng() * k) % k;
      pending = { at: core.t + Math.max(150, (mu + sd * gauss(botRng)) * 1000), choice };
    }
    if (pending && core.t >= pending.at) { core.input(pending.choice); pending = null; }
    if (core.lowStamina) lowMs += STEP;
    core.advance(STEP);
    if (core.phase === PHASE.RESOLVE) pending = null;
  }
  const cause = core.lastResult && core.lastResult.type === 'fall' ? core.lastResult.cause : 'wrong';
  return { floor: core.floor, cause, seconds: core.t / 1000, lowRatio: core.t > 0 ? lowMs / core.t : 0 };
}

const med = (a) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const pct = (a, f) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length * f)]; };

const fails = [];
const PS = [0.5, 0.7, 0.8, 0.9, 1];
const table = {};
for (const mode of Object.keys(MODES)) {
  table[mode] = {};
  console.log(`\n=== ${mode} (${MODES[mode].label}) — ${MODES[mode].hint}`);
  console.log('p\t중앙층\tp10\tp90\t중앙시간\t사인분포\t\t위험구간비율');
  for (const p of PS) {
    const rs = Array.from({ length: N }, (_, i) => runBot({ p, seed: 1000 + i, mode }));
    const fl = rs.map((r) => r.floor);
    const causes = {};
    for (const r of rs) causes[r.cause] = (causes[r.cause] || 0) + 1;
    const low = rs.reduce((a, r) => a + r.lowRatio, 0) / rs.length;
    table[mode][p] = { med: med(fl), p10: pct(fl, 0.1), p90: pct(fl, 0.9), causes, low, sec: med(rs.map((r) => r.seconds)) };
    const cs = Object.entries(causes).map(([k, v]) => `${k} ${Math.round(v / N * 100)}%`).join(' ');
    console.log(`${p}\t${med(fl)}\t${pct(fl, 0.1)}\t${pct(fl, 0.9)}\t${med(rs.map((r) => r.seconds)).toFixed(0)}s\t${cs.padEnd(22)}\t${(low * 100).toFixed(0)}%`);
  }
}

if (GATE) {
  // ① 모드마다 «죽는 이유»가 달라야 모드다
  // 🔴 v3: 모든 모드가 «한 번 틀리면 추락»이라 오답은 어느 모드에서나 판을 끝낸다. 그래서 게이지의 몫은
  //    «틀리지 않는 아이»를 끝내는 것이다 — 다 아는 봇(p=1)은 거의 전부 기력으로 끝나야 하고,
  //    잘하는 봇(p=0.9)에게도 기력 고갈이 실제로 일어나야 게이지가 장식이 아니다.
  const perfect = (table.thrill[1].causes.stamina || 0) / N;
  if (perfect < 0.9) fails.push(`아슬아슬: 다 아는 봇이 기력으로 끝난 판이 ${(perfect * 100).toFixed(0)}% — 90% 미만이면 게이지가 끝을 못 낸다`);
  const staminaShare = (table.thrill[0.9].causes.stamina || 0) / N;
  if (staminaShare < 0.1) fails.push(`아슬아슬: 잘하는 봇(p=0.9)이 기력으로 끝난 판이 ${(staminaShare * 100).toFixed(0)}% — 10% 미만이면 게이지가 장식이다`);
  const sprintTime = (table.sprint[0.9].causes.time || 0) / N;
  if (sprintTime < 0.6) fails.push(`60초 질주에서 시간 종료로 끝난 판이 ${(sprintTime * 100).toFixed(0)}% — 60% 미만이면 1분을 버티지 못한다는 뜻이다`);
  const classicWrong = (table.classic[0.9].causes.wrong || 0) / N;
  if (classicWrong < 0.9) fails.push(`클래식이 오답 외의 이유로 끝난다(${((1 - classicWrong) * 100).toFixed(0)}%) — 하트 모드에 다른 시계가 섞였다`);

  // ② 아슬아슬은 «아슬아슬»해야 한다 — 위험 구간에 실제로 머무는 시간
  const low = table.thrill[0.9].low;
  if (low < 0.10) fails.push(`아슬아슬 위험구간 체류가 판의 ${(low * 100).toFixed(0)}% — 10% 미만이면 긴장이 없다`);
  if (low > 0.65) fails.push(`아슬아슬 위험구간 체류가 판의 ${(low * 100).toFixed(0)}% — 65% 초과면 늘 빨간 화면이라 경고가 무의미하다`);

  // ③ 실력이 오르면 더 오래 간다(모든 모드 공통 단조성)
  for (const mode of Object.keys(MODES)) {
    for (let i = 1; i < PS.length; i++) {
      if (table[mode][PS[i]].med < table[mode][PS[i - 1]].med) {
        fails.push(`${mode}: p=${PS[i]} 중앙층 ${table[mode][PS[i]].med} < p=${PS[i - 1]} 의 ${table[mode][PS[i - 1]].med} — 실력이 손해가 된다`);
      }
    }
  }
  // ④ 찍기만으로는 못 간다(모드별 D8b)
  for (const mode of Object.keys(MODES)) {
    if (table[mode][0.5].med > table[mode][1].med * 0.5) {
      fails.push(`${mode}: 반만 아는 봇이 완벽한 봇의 ${(table[mode][0.5].med / table[mode][1].med * 100).toFixed(0)}% 까지 간다 — 찍기 이득이 크다`);
    }
  }
  console.log('');
  if (fails.length) {
    console.error('❌ 모드 게이트 FAIL');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log('✅ 모드 게이트 PASS (D33)');
}
