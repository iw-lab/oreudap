#!/usr/bin/env node
// 학습→진행 격자 프로브 (GDD D10) — 게임 코어를 **직접 import** 한다.
// 🔴 곡선을 다른 언어/다른 식으로 베껴 두면 코드가 바뀌어도 영원히 통과한다(검산기가 아니라 두 번째 구현).
//
// 봇 모델: «아는 확률» p 로 정답을 알고, 모르면 남은 선택지 중 균등 추측.
//          반응시간 N(mu, sd) 는 «결정 시점»에 넣는다(구동 루프가 흡수하지 않도록).
// 공통난수: 셀마다 같은 시드 집합. 세계 RNG(게임)와 봇 RNG 를 분리한다.

import { GameCore, PHASE } from '../src/core/game.js';
import { PersistentNotes } from '../src/core/srs.js';
import { makeRng } from '../src/core/rng.js';

const args = Object.fromEntries(process.argv.slice(2)
  .filter((a) => a.includes('='))
  .map((a) => a.split('=')));
const GATE = process.argv.includes('--gate');
const JSON_OUT = process.argv.includes('--json');

const N = Number(args.N ?? 300);
const MU = Number(args.MU ?? 0.85);
const SD = Number(args.SD ?? 0.20);
const SUBJECT = args.subject ?? 'gugudan';
const MODE = args.mode ?? 'classic';
const STEP = 10; // ms 시뮬 스텝
const MAX_MS = 20 * 60 * 1000;

function gauss(rng) {
  const u = 1 - rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {object} o
 * @param {number} o.p 아는 확률
 * @param {number} o.seed 공통난수 시드
 * @param {'know'|'mash'|'history'} [o.policy]
 */
function runBot({ p, seed, policy = 'know', mu = MU, sd = SD, mode = MODE }) {
  const core = new GameCore({ seed, subject: SUBJECT, mode, notes: new PersistentNotes(), now: () => 1_700_000_000_000, revive: true });
  const botRng = makeRng(seed * 2654435761 + 12345); // 봇 결정 전용(세계 RNG 와 분리)
  core.start();

  let pending = null;   // { at, choice }
  const posHistory = [];
  let guard = 0;

  // 🔴 연타봇은 «국면과 무관하게» 계속 누른다 — 그래야 입력 버퍼 경로를 실제로 밟는다.
  //    문항 국면에서만 누르면 버퍼를 한 번도 안 지나가고 게이트가 초록으로 거짓말한다(실측으로 걸림).
  let mashNext = 0;
  while (core.phase !== PHASE.OVER && core.t < MAX_MS && guard++ < 400000) {
    // v3: 실제 판처럼 «다시 일어서기»를 받는다(판마다 1번 · 놓친 문제부터 3연속)
    if (core.phase === PHASE.DOWN) { core.beginRevive(); pending = null; }
    if (policy === 'mash') {
      if (core.t >= mashNext) { core.input(0); mashNext = core.t + 120; }
      core.advance(STEP);
      continue;
    }
    if (core.phase === PHASE.QUESTION && !core.answered && !pending) {
      const q = core.question;
      const k = q.choices.length;
      let choice;
      if (policy === 'mash') {
        choice = 0;                                   // 항상 왼쪽만 연타
      } else if (policy === 'history') {
        // 문제를 보지 않고 «최근 위치 이력»만으로 가장 덜 나온 자리를 고른다(카운팅 공격)
        const counts = new Array(k).fill(0);
        for (const h of posHistory.slice(-6)) if (h < k) counts[h] += 1;
        let best = 0;
        for (let i = 1; i < k; i++) if (counts[i] < counts[best]) best = i;
        choice = best;
      } else {
        const knows = botRng() < p;
        if (knows) {
          choice = q.answerIndex;
        } else {
          choice = Math.floor(botRng() * k) % k;      // 균등 추측(정답도 포함)
        }
      }
      const delay = policy === 'mash' ? 150 : Math.max(150, (mu + sd * gauss(botRng)) * 1000);
      pending = { at: core.t + delay, choice };
    }

    if (pending && core.t >= pending.at) {
      const q = core.question;
      if (q) posHistory.push(q.answerIndex);
      core.input(pending.choice);
      pending = null;
    }
    core.advance(STEP);
    if (core.phase === PHASE.RESOLVE) pending = null;
  }

  return {
    floor: core.floor,
    cause: core.lastResult && core.lastResult.type === 'fall' ? core.lastResult.cause : 'wrong',
    seconds: core.t / 1000,
    asked: core.stats.asked,
    correct: core.stats.correct,
    timeouts: core.stats.timeouts,
    coins: core.coins,
    bestStreak: core.bestStreak,
  };
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function pct(a, f) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; }

function grid(ps, policy = 'know', opts = {}) {
  const rows = [];
  for (const p of ps) {
    const floors = []; const coins = []; const to = []; const acc = [];
    for (let s = 1; s <= N; s++) {
      const r = runBot({ p, seed: s, policy, ...opts });   // 공통난수: 셀마다 같은 시드 1..N
      floors.push(r.floor); coins.push(r.coins);
      to.push(r.asked ? r.timeouts / r.asked : 0);
      acc.push(r.asked ? r.correct / r.asked : 0);
    }
    rows.push({
      p,
      median: median(floors), p10: pct(floors, 0.1), p90: pct(floors, 0.9),
      coinMedian: median(coins),
      timeoutRate: to.reduce((a, b) => a + b, 0) / N,
      realAccuracy: acc.reduce((a, b) => a + b, 0) / N,
    });
  }
  return rows;
}

const PS = (args.P ?? '0,0.5,0.6,0.7,0.8,0.9,0.95,1.0').split(',').map(Number);
const rows = grid(PS);

if (JSON_OUT) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log(`N=${N} 반응 N(${MU}, ${SD}) 과목=${SUBJECT}`);
  console.log('p\t중앙층\tp10\tp90\t코인중앙\t실정답률\t시간초과');
  for (const r of rows) {
    console.log(`${r.p}\t${r.median}\t${r.p10}\t${r.p90}\t${r.coinMedian}\t${(r.realAccuracy * 100).toFixed(1)}%\t${(r.timeoutRate * 100).toFixed(1)}%`);
  }
}

if (GATE) {
  const fails = [];
  const by = (p) => rows.find((r) => Math.abs(r.p - p) < 1e-9);

  // 표본 단언 — «검사 0건»과 «위반 0건»을 가른다
  if (N < 200) fails.push(`표본 부족: N=${N} (≥200 필요) — 측정 무효`);
  for (const p of [0, 0.6, 0.9, 1.0]) if (!by(p)) fails.push(`p=${p} 행 없음 — 측정 무효`);

  if (fails.length === 0) {
    // ① 단조 증가
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].median < rows[i - 1].median) {
        fails.push(`단조성 위반: p=${rows[i - 1].p}(${rows[i - 1].median}) → p=${rows[i].p}(${rows[i].median})`);
      }
    }
    // ② 찍기로는 못 오른다
    if (by(0).median > 4) fails.push(`찍기 우회: p=0 중앙값 ${by(0).median} > 4`);
    // ③ 학습이 결과를 바꾼다
    // 🔴 v3(한 번 틀리면 추락)부터는 «배수»로 잰다. 하트 3개 시절의 «30층 차이»는 판 길이가 길어서 나온 값이고,
    //    추락형에선 모든 판이 짧아져 절대 차이가 줄어도 «더 알면 몇 배 더 간다»는 그대로다(실측 26/5 = 5.2배).
    const ratio = by(0.9).median / Math.max(1, by(0.6).median);
    const gap = by(0.9).median - by(0.6).median;
    if (ratio < 3 || gap < 15) fails.push(`학습→진행 격차 부족: 0.6↔0.9 = ${gap}층 · ${ratio.toFixed(1)}배 (≥15층 · ≥3배)`);
    // ④ 못해도 게임이 된다 / 잘해도 끝이 있다
    // 🔴 반만 아는 아이도 «가끔은 멀리 간다»(p90)가 있어야 다시 한다 — 중앙값만 보면 추락형에선 늘 낮다.
    if (by(0.5).median < 2) fails.push(`저성취 좌절: p=0.5 중앙값 ${by(0.5).median} < 2`);
    if (by(0.5).p90 < 8) fails.push(`저성취 좌절: p=0.5 상위 10% ${by(0.5).p90} < 8 — 반만 알면 멀리 갈 일이 아예 없다`);
    if (by(1.0).median > 400) fails.push(`천장 없음: p=1.0 중앙값 ${by(1.0).median} > 400`);

    // ⑤ 연타 우회 — 한쪽만 계속 누르는 봇이 찍기보다 유리하면 버퍼가 구멍이다
    const mash = grid([0], 'mash')[0];
    if (mash.median > by(0).median + 1) {
      fails.push(`연타 우회: mash 중앙값 ${mash.median} > 찍기 ${by(0).median} + 1`);
    }
    // ⑥ 위치 이력 공격(D8b) — 덱을 세는 봇이 유리하면 안 된다
    const hist = grid([0], 'history')[0];
    if (hist.median > by(0).median + 1) {
      fails.push(`위치 카운팅 우회(D8b): history 중앙값 ${hist.median} > 찍기 ${by(0).median} + 1`);
    }
    console.log(`\n[연타봇] 중앙값 ${mash.median} · [위치이력봇] 중앙값 ${hist.median} · [찍기봇] ${by(0).median}`);
  }

  if (fails.length) {
    console.error('\n❌ 밸런스 게이트 FAIL');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log('\n✅ 밸런스 게이트 PASS (D10 · D8b)');
}
