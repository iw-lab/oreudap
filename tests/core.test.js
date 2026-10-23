// 완료 기준(DoD) 1:1 테스트 — GDD §1-8.
// 각 describe 이름 끝의 [Dn] 이 완료 기준 번호다. 항목이 늘면 여기 테스트도 늘어난다.

import { describe, it, expect } from 'vitest';
import { GameCore, PHASE } from '../src/core/game.js';
import { PersistentNotes, SessionQueue, dayKey } from '../src/core/srs.js';
import { PositionDeck, hasRun } from '../src/core/positionDeck.js';
import { gugudanDistractors, gugudanCandidates, wordDistractors } from '../src/core/distractors.js';
import { buildBank, QuestionSource } from '../src/core/questions.js';
import { timerFor, branchesFor, TIMING, HEART, COIN, SRS, SAVE, TIMER, BRANCH, MODES, STAMINA, drainFor, refillFor, capFor, REVIVE, FEVER } from '../src/core/balance.js';
import { makeRng } from '../src/core/rng.js';
import { load, save, migrate, emptySave, sanitize } from '../src/core/storage.js';
import { applyRun, buy, equip, todayMissions } from '../src/core/economy.js';
import { MIN_WORDS_PER_BAND } from '../src/core/balance.js';
import { WORDS_G34 } from '../src/data/words-g34.js';
import { WORDS_G56 } from '../src/data/words-g56.js';
import { COMMON_ERRORS } from '../src/data/gugudan-common-errors.js';

const NOW = () => 1_700_000_000_000;

function newGame(seed = 7, subject = 'gugudan') {
  const g = new GameCore({ seed, subject, notes: new PersistentNotes(), now: NOW });
  g.start();
  return g;
}
/** 정답을 눌러 한 문항 진행 */
function answerCorrect(g) {
  g.advance(50);
  g.input(g.question.answerIndex);
  g.advance(TIMING.JUMP_MS + 1);
}
/** 오답을 눌러 한 문항 진행 */
function answerWrong(g) {
  g.advance(50);
  const wrong = (g.question.answerIndex + 1) % g.question.choices.length;
  g.input(wrong);
  g.advance(TIMING.STUMBLE_MS + TIMING.HIGHLIGHT_MS + 1);
}

describe('정답이 층을 올리고 오답 한 번이면 추락한다 [D2]', () => {
  it('정답 1회 = 층 +1, 코인 +1', () => {
    const g = newGame();
    expect(g.floor).toBe(0);
    answerCorrect(g);
    expect(g.floor).toBe(1);
    expect(g.coins).toBe(COIN.PER_FLOOR);
    expect(g.hearts).toBe(MODES.classic.hearts);
  });

  it('하트로 버티는 모드가 없다 — 질주 말고는 전부 «한 번 틀리면 추락»', () => {
    for (const [id, m] of Object.entries(MODES)) {
      if (m.penaltyMs) { expect(m.hearts, id).toBe(0); continue; }
      expect(m.hearts, id).toBe(1);
    }
  });

  it('오답 = 층 그대로, 하트 −1, 정답 하이라이트 정보 제공', () => {
    const g = newGame();
    g.advance(50);
    const answerText = g.question.answerText;
    const wrong = (g.question.answerIndex + 1) % g.question.choices.length;
    const res = g.input(wrong);
    expect(res.type).toBe('wrong');
    expect(res.answerText).toBe(answerText);
    expect(res.over).toBe(true);
    expect(g.floor).toBe(0);
    expect(g.hearts).toBe(0);
  });

  it('시간초과 = 오답과 같은 처리', () => {
    const g = newGame();
    g.advance(g.timerMs + 1);
    expect(g.hearts).toBe(0);
    expect(g.stats.timeouts).toBe(1);
    expect(g.floor).toBe(0);
  });

  it('스트릭 10의 배수에서만 코인 +5 (10연속부터는 불꽃 계단 코인 배수)', () => {
    const g = newGame();
    for (let i = 0; i < 9; i++) answerCorrect(g);
    expect(g.coins).toBe(9);
    answerCorrect(g); // 10번째 = 불꽃 시작
    expect(g.coins).toBe(9 + COIN.PER_FLOOR * FEVER.COIN_MULT + COIN.STREAK_BONUS);
  });

  it('오답 한 번 뒤에는 다음 문항이 생성되지 않는다', () => {
    const g = newGame();
    answerCorrect(g);
    const askedBefore = g.stats.asked;
    answerWrong(g);
    g.advance(5000);
    expect(g.phase).toBe(PHASE.OVER);
    expect(g.stats.asked).toBe(askedBefore);
  });
});

describe('문항당 판정은 정확히 1회 [D3]', () => {
  it('연타해도 층·하트 변화 합계가 1을 넘지 않는다', () => {
    const g = newGame();
    g.advance(50);
    const idx = g.question.answerIndex;
    g.input(idx); g.input(idx); g.input((idx + 1) % g.question.choices.length);
    expect(g.floor).toBe(1);
    expect(g.hearts).toBe(MODES.classic.hearts);
    expect(g.stats.correct).toBe(1);
    expect(g.stats.wrong).toBe(0);
  });

  it('해결 국면의 입력은 다음 문항을 자동으로 풀지 않는다', () => {
    const g = newGame();
    g.advance(50);
    g.input(g.question.answerIndex);           // 정답 → RESOLVE (220ms)
    g.input(0);                                // 해결 직후 입력 = 다음 활성화보다 220ms 이르다
    g.advance(TIMING.JUMP_MS + 1);
    expect(g.phase).toBe(PHASE.QUESTION);
    expect(g.answered).toBe(false);            // 새 문항은 손대지 않은 채로 시작한다
    expect(g.stats.asked).toBe(2);
  });
});

describe('하트는 모드의 개수를 넘지 않는다 [D5]', () => {
  it('하트 1개 모드는 스트릭으로 하트가 늘지 않는다 — 늘면 «한 번 틀리면 추락»이 거짓말', () => {
    const g = newGame();
    for (let i = 0; i < 30; i++) answerCorrect(g);
    expect(g.hearts).toBe(MODES.classic.hearts);
    expect(HEART.MAX).toBeGreaterThanOrEqual(MODES.classic.hearts);
  });
});

describe('불꽃 계단 [D58]', () => {
  it('연속 정답이 FROM 에 닿는 순간 켜지고(feverStart) 틀리면 꺼진다', () => {
    const g = new GameCore({ seed: 7, subject: 'gugudan', notes: new PersistentNotes(), now: NOW, revive: true });
    g.start();
    let res = null;
    for (let i = 0; i < FEVER.FROM; i++) {
      g.advance(50); res = g.input(g.question.answerIndex);
      if (i < FEVER.FROM - 1) expect(res.fever).toBe(false);
      g.advance(TIMING.JUMP_MS + 1);
    }
    expect(res.fever).toBe(true);
    expect(res.feverStart).toBe(true);
    expect(g.fever).toBe(true);
    answerWrong(g);
    expect(g.fever).toBe(false);
  });
  it('제한시간 끝자락에 맞히면 «간발»(close) 표시', () => {
    const g = newGame();
    g.advance(g.timerMs * 0.9);
    const res = g.input(g.question.answerIndex);
    expect(res.close).toBe(true);
    const h = newGame(8);
    h.advance(50);
    expect(h.input(h.question.answerIndex).close).toBe(false);
  });
});

describe('다시 일어서기 [D57]', () => {
  const mkR = (mode = 'classic', seed = 7) => {
    const g = new GameCore({ seed, subject: 'gugudan', mode, notes: new PersistentNotes(), now: NOW, revive: true });
    g.start();
    return g;
  };
  const fallOnce = (g) => {
    g.advance(50);
    const id = g.question.id;
    g.input((g.question.answerIndex + 1) % g.question.choices.length);
    const ev = g.advance(TIMING.STUMBLE_MS + TIMING.HIGHLIGHT_MS + 1);
    return { id, ev };
  };

  it('추락하면 DOWN 에서 멈추고(시간 정지) 다시 일어서기를 기다린다', () => {
    const g = mkR();
    answerCorrect(g); answerCorrect(g);
    const { ev } = fallOnce(g);
    expect(ev.some((e) => e.type === 'down' && e.need === REVIVE.NEED)).toBe(true);
    expect(g.phase).toBe(PHASE.DOWN);
    const t = g.t;
    expect(g.advance(60_000)).toEqual([]);
    expect(g.phase).toBe(PHASE.DOWN);
    expect(g.t).toBe(t + 60_000);
  });

  it('첫 문제는 방금 놓친 문제, 3연속 정답이면 «같은 층»에서 다시 출발', () => {
    const g = mkR();
    answerCorrect(g); answerCorrect(g);
    const { id } = fallOnce(g);
    const floor = g.floor;
    g.beginRevive();
    expect(g.question.id).toBe(id);
    expect(g.timerMs).toBe(REVIVE.TIMER_S * 1000);
    for (let i = 0; i < REVIVE.NEED; i++) {
      g.advance(50);
      const r = g.input(g.question.answerIndex);
      expect(r.revive.got).toBe(i + 1);
      expect(r.revive.done).toBe(i === REVIVE.NEED - 1);
      expect(g.floor).toBe(floor);          // 다시 일어서는 동안은 층이 오르지 않는다
      g.advance(REVIVE.STEP_MS + 1);
    }
    expect(g.phase).toBe(PHASE.QUESTION);
    expect(g.reviving).toBe(null);
    expect(g.hearts).toBe(MODES.classic.hearts);
    answerCorrect(g);
    expect(g.floor).toBe(floor + 1);
  });

  it('판마다 한 번뿐 — 두 번째 추락은 그대로 끝', () => {
    const g = mkR();
    fallOnce(g);
    g.beginRevive();
    for (let i = 0; i < REVIVE.NEED; i++) { g.advance(50); g.input(g.question.answerIndex); g.advance(REVIVE.STEP_MS + 1); }
    const { ev } = fallOnce(g);
    expect(ev.some((e) => e.type === 'gameover')).toBe(true);
    expect(g.phase).toBe(PHASE.OVER);
  });

  it('다시 일어서기 도중 틀리면 끝', () => {
    const g = mkR();
    fallOnce(g);
    g.beginRevive();
    const { ev } = fallOnce(g);
    expect(ev.some((e) => e.type === 'gameover')).toBe(true);
  });

  it('그만하기(giveUp) = 바로 끝', () => {
    const g = mkR();
    fallOnce(g);
    const ev = g.giveUp();
    expect(ev[0].type).toBe('gameover');
    expect(g.phase).toBe(PHASE.OVER);
  });

  it('아슬아슬의 기력 고갈도 다시 일어서기가 있고, 일어서면 기력이 채워진다', () => {
    const g = mkR('thrill');
    g.stamina = 0.0001;
    const ev = g.advance(50);
    expect(ev.some((e) => e.type === 'down' && e.cause === 'stamina')).toBe(true);
    g.beginRevive();
    const s0 = g.stamina;
    g.advance(3000);
    expect(g.stamina).toBe(s0);               // 다시 일어서는 동안 기력이 줄지 않는다
    for (let i = 0; i < REVIVE.NEED; i++) { g.advance(50); g.input(g.question.answerIndex); g.advance(REVIVE.STEP_MS + 1); }
    expect(g.stamina).toBeGreaterThan(0.5);
  });

  it('revive 옵션이 꺼진 코어(프로브·스모크)는 추락이 곧 끝이다', () => {
    const g = newGame();
    const { ev } = fallOnce(g);
    expect(ev.some((e) => e.type === 'gameover')).toBe(true);
  });

  it('60초 질주에는 다시 일어서기가 없다', () => {
    const g = mkR('sprint');
    expect(g.revivesLeft).toBe(0);
  });
});

describe('타이머 식 [D6]', () => {
  // 🔴 수치를 손으로 적지 않는다 — 밸런스를 조정할 때마다 어긋난다(L-070).
  //    식이 상수와 «같은지»를 보고, 성질(단조 감소·하한·실력 천장)을 따로 단언한다.
  it('식이 상수와 일치하고, 하한 아래로 내려가지 않는다', () => {
    for (const f of [1, 20, 50, 100, 200, 500]) {
      expect(timerFor(f)).toBeCloseTo(Math.max(TIMER.TMIN, TIMER.T0 - TIMER.K * f), 6);
      expect(timerFor(f)).toBeGreaterThanOrEqual(TIMER.TMIN);
    }
  });
  it('층이 오르면 반드시 짧아진다 — 그리고 사람 반응시간 언저리에서 멈춘다', () => {
    for (let f = 1; f < 200; f++) expect(timerFor(f + 1)).toBeLessThanOrEqual(timerFor(f));
    // 🔴 실력 천장이 있어야 엔드리스가 «끝»난다. 하한이 반응시간(평균 0.85초)보다
    //    한참 위면 다 아는 아이는 영영 안 죽는다(2026-09-04 사용자 지적).
    expect(TIMER.TMIN).toBeLessThanOrEqual(1.0);
    const floorAtMin = Math.ceil((TIMER.T0 - TIMER.TMIN) / TIMER.K);
    expect(floorAtMin).toBeLessThan(120);
  });
  it('게임이 그 식을 실제로 쓴다', () => {
    const g = newGame();
    expect(g.timerMs).toBeCloseTo(timerFor(1) * 1000, 6);
    answerCorrect(g);
    expect(g.timerMs).toBeCloseTo(timerFor(2) * 1000, 6);
  });
});

describe('갈래 수 [D7]', () => {
  it('경계 아래는 항상 2, 전면 구간부터는 항상 3', () => {
    const rng = makeRng(1);
    for (const f of [1, BRANCH.THREE_WAY_FROM - 1]) expect(branchesFor(f, rng)).toBe(2);
    for (const f of [BRANCH.THREE_WAY_FULL, 120, 500]) expect(branchesFor(f, rng)).toBe(3);
  });
  it('섞이는 구간은 3갈래 비율 MIX_RATIO ±5%p (N=400 표본, 표본 미달이면 측정 무효)', () => {
    const rng = makeRng(99);
    const N = 400;
    const span = BRANCH.THREE_WAY_FULL - BRANCH.THREE_WAY_FROM;
    let three = 0;
    for (let i = 0; i < N; i++) three += branchesFor(BRANCH.THREE_WAY_FROM + (i % span), rng) === 3 ? 1 : 0;
    expect(N).toBeGreaterThanOrEqual(400);
    const ratio = three / N;
    expect(ratio).toBeGreaterThan(BRANCH.MIX_RATIO - 0.05);
    expect(ratio).toBeLessThan(BRANCH.MIX_RATIO + 0.05);
  });
});

describe('정답 위치 덱 [D8]', () => {
  it('같은 위치 4연속이 없다 (덱 길이의 10배 이상, 병합 경계 포함)', () => {
    for (const branches of [2, 3]) {
      const deck = new PositionDeck(branches, makeRng(branches * 31 + 5));
      const seq = [];
      for (let i = 0; i < 600; i++) seq.push(deck.draw());
      expect(hasRun(seq, 3)).toBe(false);
    }
  });
  it('위치 분포가 균등하다', () => {
    const deck = new PositionDeck(3, makeRng(1234));
    const c = { L: 0, C: 0, R: 0 };
    for (let i = 0; i < 900; i++) c[deck.draw()] += 1;
    for (const k of ['L', 'C', 'R']) expect(Math.abs(c[k] - 300)).toBeLessThan(60);
  });
  it('덱을 소진하지 않는다 — 잔여가 항상 REFILL_AT 초과로 유지된다', () => {
    const deck = new PositionDeck(2, makeRng(77));
    for (let i = 0; i < 200; i++) {
      deck.draw();
      expect(deck.cards.length).toBeGreaterThan(0);
    }
  });
});

describe('오답 생성 규칙 [D9]', () => {
  const dans = [2, 3, 4, 5, 6, 7, 8, 9];
  it('구구단 72문항 전수: 오답은 정답과 다르고 서로 다르며 후보 합집합 안이다', () => {
    const rng = makeRng(5);
    let checked = 0;
    for (const a of dans) {
      for (let b = 1; b <= 9; b++) {
        const answer = a * b;
        const allowed = new Set(gugudanCandidates(a, b));
        for (const n of [1, 2]) {
          const ds = gugudanDistractors(a, b, n, rng);
          expect(ds.length).toBe(n);
          expect(new Set(ds).size).toBe(n);
          for (const d of ds) {
            expect(d).not.toBe(answer);
            expect(d).toBeGreaterThan(0);
            expect(allowed.has(d) || Number.isInteger(d)).toBe(true);
          }
        }
        checked += 1;
      }
    }
    expect(checked).toBe(72); // 모수 단언 — 「검사 0건」과 「위반 0건」을 가른다
  });

  it('흔한 오류 사전의 값이 실제로 후보 안에 있다 (7×8 → 54)', () => {
    expect(gugudanCandidates(7, 8)).toContain(54);
    expect(gugudanCandidates(6, 7)).toContain(48);
    for (const [key, vals] of Object.entries(COMMON_ERRORS)) {
      const [a, b] = key.split('x').map(Number);
      const cands = gugudanCandidates(a, b);
      for (const v of vals) expect(cands).toContain(v);
    }
  });

  // 🔴 품사는 «선호»지 «조건»이 아니다 — 품사군 인원이 모자라면 선택지를 비우느니
  //    밴드 전체로 폴백한다. 그래서 단언은 «같은 품사가 남아 있는 한 같은 품사»다.
  it('영단어 오답은 같은 밴드에서 나오고, 여유가 있으면 같은 품사다 (전수)', () => {
    const rng = makeRng(11);
    for (const [pool, name] of [[WORDS_G34, 'g34'], [WORDS_G56, 'g56']]) {
      let checked = 0;
      for (const item of pool) {
        for (const dir of ['w2k', 'k2w']) {
          const ds = wordDistractors(item, pool, dir, 2, rng);
          expect(ds.length, `${name}/${item.w}/${dir}`).toBe(2);
          const samePosPool = pool.filter((e) => e.pos === item.pos && e.w !== item.w).length;
          for (const d of ds) {
            if (samePosPool >= 2) expect(d.pos, `${name}/${item.w}`).toBe(item.pos);
            expect(pool).toContain(d);
            expect(d.w).not.toBe(item.w);
          }
          expect(ds[0].w).not.toBe(ds[1].w);
          checked += 1;
        }
      }
      expect(checked).toBe(pool.length * 2);
    }
  });
});

describe('학습→진행 연결의 자기검사 [D10]', () => {
  it('정답이 층을 올리는 유일한 경로다 — 오답만 하면 절대 오르지 않는다', () => {
    const g = newGame();
    answerWrong(g); answerWrong(g); answerWrong(g);
    expect(g.floor).toBe(0);
  });
  it('시간이 흘러도 층은 오르지 않는다', () => {
    const g = newGame();
    g.advance(60_000);
    expect(g.floor).toBe(0);
  });
});

describe('SRS — 세션 큐와 영속 박스 [D11]', () => {
  it('세션 큐가 반복 금지 창보다 우선해 3문항 뒤 재출제된다', () => {
    const notes = new PersistentNotes();
    const q = new SessionQueue();
    const src = new QuestionSource({ subject: 'gugudan', rng: makeRng(3), sessionQueue: q, notes, now: NOW });
    const first = src.next(2);
    q.onWrong(first.id, src.index);
    const seen = [];
    for (let i = 0; i < 4; i++) seen.push(src.next(2).id);
    expect(seen[2]).toBe(first.id);       // index 1,2,3 → 3번째가 재출제(1+3)
    expect(SRS.NO_REPEAT_WINDOW).toBeGreaterThan(3); // 복습 간격(3)이 반복 금지 창보다 짧다 = 예외가 실제로 작동한다
  });

  it('세션 3회 정답이면 큐 졸업', () => {
    const q = new SessionQueue();
    q.onWrong('g:7x8', 0);
    expect(q.onCorrect('g:7x8', 3)).toBe('advanced');
    expect(q.onCorrect('g:7x8', 10)).toBe('advanced');
    expect(q.onCorrect('g:7x8', 25)).toBe('graduated');
    expect(q.has('g:7x8')).toBe(false);
  });

  it('영속 박스는 4회 정답에 졸업하고, 배지는 영속 박스를 읽는다', () => {
    const n = new PersistentNotes();
    const t = 1_700_000_000_000;
    n.onWrong('g:7x8', t);
    expect(n.progress('g:7x8')).toEqual({ box: 0, max: 4, graduated: false });
    for (let i = 0; i < 3; i++) n.onCorrect('g:7x8', t);
    expect(n.progress('g:7x8').box).toBe(3);
    expect(n.progress('g:7x8').graduated).toBe(false); // 세션 3회로는 졸업이 아니다
    n.onCorrect('g:7x8', t);
    expect(n.progress('g:7x8').graduated).toBe(true);
  });

  it('박스 날짜가 BOX_DAYS 대로 밀린다', () => {
    const n = new PersistentNotes();
    const t = new Date('2026-09-04T09:00:00').getTime();
    n.onWrong('g:3x3', t);                // 오답노트는 «틀린» 문제로만 시작한다
    n.onCorrect('g:3x3', t);              // box 1 → +1일
    expect(n.data['g:3x3'].due).toBe(dayKey(t + 1 * 86400000));
    n.onCorrect('g:3x3', t);              // box 2 → +3일
    expect(n.data['g:3x3'].due).toBe(dayKey(t + 3 * 86400000));
    n.onCorrect('g:3x3', t);              // box 3 → +7일
    expect(n.data['g:3x3'].due).toBe(dayKey(t + 7 * 86400000));
    n.onCorrect('g:3x3', t);              // box 4 → +16일
    expect(n.data['g:3x3'].due).toBe(dayKey(t + 16 * 86400000));
  });

  it('약점은 더 자주 나오되 더 어려워지지 않는다 — 가중은 WEIGHT_MAX 를 넘지 않는다', () => {
    const n = new PersistentNotes();
    const t = NOW();
    n.onWrong('g:7x8', t);
    expect(n.weight('g:7x8', t)).toBeLessThanOrEqual(SRS.WEIGHT_MAX);
    expect(n.weight('g:7x8', t)).toBeGreaterThan(1);
    expect(n.weight('g:2x2', t)).toBe(1); // 안 틀린 항목은 가중 없음
  });
});

describe('세이브 [D12]', () => {
  function memStore() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  }
  it('키 네임스페이스와 버전 래퍼', () => {
    expect(SAVE.KEY).toBe('oreudap:progress');
    const st = memStore();
    const data = emptySave(); data.coins = 42;
    save(data, st);
    expect(JSON.parse(st.getItem('oreudap:progress')).version).toBe(SAVE.VERSION);
    expect(load(st).coins).toBe(42);
  });
  it('v1 → 현행 마이그레이션 (체인 전체)', () => {
    const v1 = { coins: 10, skin: 'fox', ownedSkins: ['fox'], best: 33, notes: {} };
    const out = migrate(1, v1);
    // v1 의 숫자 best 는 v2 에서 { gugudan } 이 되고, v3 에서 «과목:모드» 로 갈린다.
    expect(out.best).toEqual({ 'gugudan:classic': 33 });
    expect(out.ownedThemes).toEqual(['dawn']);
    expect(out.settings.sound).toBe(true);
    expect(out.mode).toBe('classic');
  });
  it('v2 → v3: 기록이 모드별로 갈리고 기존 값은 클래식으로 간다', () => {
    // 🔴 모드마다 층수의 뜻이 다르다 — 옮기지 않으면 60초 질주 기록과 무한 기록이 한 칸에 섞인다.
    const v2 = { coins: 7, best: { gugudan: 40, words34: 12 }, notes: {} };
    const out = migrate(2, v2);
    expect(out.best).toEqual({ 'gugudan:classic': 40, 'words34:classic': 12 });
    expect(out.coins).toBe(7);
  });
  it('v3 → v4: 새 칸이 «비어서» 열린다 — 하지 않은 날을 했다고 말하지 않는다', () => {
    // 🔴 최고 기록이 높다고 지난 날짜에 깃발을 소급해 찍으면, 아이가 하지 않은 날을
    //    했다고 기록하는 셈이다. 여정 진행도만은 최고 기록에서 그때그때 유도된다.
    const v3 = { coins: 5, best: { 'gugudan:classic': 80 }, notes: {} };
    const out = migrate(3, v3);
    expect(out.best).toEqual({ 'gugudan:classic': 80 });
    expect(out.flags).toEqual({});
    expect(out.mastery).toEqual({});
    expect(out.week).toEqual({ week: '', days: [], claimed: false });
    expect(out.coins).toBe(5);
  });
  it('v1 → v4 전 구간을 한 번에 지난다', () => {
    const out = migrate(1, { coins: 3, best: 12, notes: {} });
    expect(out.best).toEqual({ 'gugudan:classic': 12 });
    expect(out.flags).toEqual({});
    expect(out.week.claimed).toBe(false);
  });
  it('🔴 새 칸도 신뢰 경계 밖이다 — 모양이 어긋나면 고치지 말고 버린다', () => {
    const out = sanitize({
      flags: { '2026-09-06|gugudan': 9, 'ㅁㄴㅇㄹ': 3, '2026-09-06|words34': 2 },
      mastery: { 'gugudan:7': { c: 100, a: 10 }, 'DROP TABLE': { c: 1, a: 1 }, words34: { c: 3, a: 5 } },
      week: { week: '2026-09-07', days: [0, 1, 99, 'x'], claimed: 'yes' },
    });
    expect(out.flags).toEqual({ '2026-09-06|words34': 2 });      // 별 9개·날짜 아님은 버림
    expect(out.mastery).toEqual({ words34: { c: 3, a: 5 } });    // 맞힌 수 > 푼 수는 버림
    expect(out.week).toEqual({ week: '2026-09-07', days: [0, 1], claimed: false });
  });
  it('낯선 모드 문자열은 클래식으로 떨어진다(저장소는 신뢰 경계 밖)', () => {
    expect(sanitize({ mode: '../../etc' }).mode).toBe('classic');
    expect(sanitize({ mode: 'thrill' }).mode).toBe('thrill');
  });
  it('깨진 저장·차단된 저장소에서 빈 세이브로 떨어진다', () => {
    const bad = { getItem: () => '{"nope"', setItem: () => {}, removeItem: () => {} };
    expect(load(bad).coins).toBe(0);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} };
    expect(load(throwing).coins).toBe(0);
  });
  it('알 수 없는 스킨·음수 코인을 정리한다', () => {
    const s = sanitize({ coins: -5, skin: 'hacker', ownedSkins: ['hacker'], ownedThemes: [] });
    expect(s.coins).toBe(0);
    expect(s.skin).toBe('fox');
    expect(s.ownedSkins).toEqual(['fox']);
  });
});

describe('입력은 문항이 살아 있을 때만 판정된다 [D13]', () => {
  it('활성화 «이전» 입력은 버려진다 — 보지 않은 문제에 답이 커밋되지 않는다', () => {
    const g = newGame();
    g.advance(50);
    g.input(g.question.answerIndex);             // 정답 → RESOLVE
    const res = g.input(0);                      // 해결 국면 입력
    expect(res.type).toBe('ignored');
    g.advance(TIMING.JUMP_MS + 1);
    expect(g.answered).toBe(false);              // 새 문항은 손대지 않은 채로 시작한다
    expect(g.stats.asked).toBe(2);
  });

  it('해결 국면 «막바지» 입력도 버려진다(옛 130ms 버퍼 창)', () => {
    const g = newGame();
    g.advance(50);
    g.input(g.question.answerIndex);
    g.advance(TIMING.JUMP_MS - 100);             // 다음 활성화 100ms 전
    expect(g.input(0).type).toBe('ignored');
    g.advance(101);
    expect(g.answered).toBe(false);
  });

  it('연타해도 다음 문항이 자동 판정되지 않는다', () => {
    const g = newGame();
    g.advance(50);
    const startFloor = g.floor;
    for (let i = 0; i < 40; i++) { g.input(0); g.advance(30); }
    // 40번 눌렀지만 «각 문항이 살아 있는 동안»의 입력만 판정됐다
    expect(g.stats.asked).toBe(g.stats.correct + g.stats.wrong);
    expect(g.floor - startFloor).toBe(g.stats.correct);
  });

  it('타임아웃 이후의 입력은 무시된다 — 하트는 타임아웃분 1만 깎인다', () => {
    const g = newGame();
    g.advance(g.timerMs + 1);
    expect(g.hearts).toBe(0);
    expect(g.input(0).type).toBe('ignored');
    expect(g.stats.wrong).toBe(1);
    g.advance(TIMING.STUMBLE_MS + TIMING.HIGHLIGHT_MS + 1);
    expect(g.hearts).toBe(0);
    expect(g.phase).toBe(PHASE.OVER);
  });
});

describe('손상·조작된 저장값 정합화', () => {
  it('"Infinity" 코인이 그대로 통과하지 않는다', () => {
    expect(sanitize({ coins: 'Infinity' }).coins).toBe(0);
    expect(sanitize({ coins: NaN }).coins).toBe(0);
    expect(sanitize({ coins: 1e30 }).coins).toBeLessThanOrEqual(9999999);
  });
  it('배열이어야 할 값이 객체여도 터지지 않는다', () => {
    const s = sanitize({ ownedSkins: { 0: 'dragon' }, missions: { claimed: { a: 1 } } });
    expect(s.ownedSkins).toEqual(['fox']);
    expect(Array.isArray(s.missions.claimed)).toBe(true);
    expect(() => todayMissions(s, NOW())).not.toThrow();
  });
  it('손상된 오답노트 항목은 버려진다(NaN 가중치 차단)', () => {
    const s = sanitize({ notes: { 'g:7x8': { box: 'x', due: '0000-00-00' }, 'g:2x2': { box: 2, due: '2026-09-04' } } });
    expect(s.notes['g:7x8']).toBeUndefined();
    expect(s.notes['g:2x2']).toEqual({ box: 2, due: '2026-09-04' });
    const n = new PersistentNotes(s.notes);
    expect(Number.isFinite(n.weight('g:2x2', NOW()))).toBe(true);
  });
  it('모르는 저장 버전은 받아들이지 않는다', () => {
    expect(migrate(999, { coins: 99999 }).coins).toBe(0);
    expect(migrate(0, { coins: 99999 }).coins).toBe(0);
  });
  it('최고 기록·누적값도 수치로 강제된다', () => {
    const s = sanitize({ best: { gugudan: '-5', words34: 'abc' }, totals: { runs: 'x' } });
    expect(s.best.gugudan).toBe(0);
    expect(s.best.words34).toBe(0);
    expect(s.totals.runs).toBe(0);
  });
});

describe('오답노트는 «틀린» 문제만 담는다', () => {
  it('처음 본 문항을 맞혀도 노트에 생기지 않는다', () => {
    const n = new PersistentNotes();
    expect(n.onCorrect('g:3x3', NOW())).toBe(null);
    expect(n.list()).toEqual([]);
  });
  it('틀린 뒤에는 진급한다', () => {
    const n = new PersistentNotes();
    n.onWrong('g:3x3', NOW());
    expect(n.onCorrect('g:3x3', NOW())).toBe('advanced');
    expect(n.box('g:3x3')).toBe(1);
  });
  it('한 판을 다 맞혀도 오답노트가 비어 있다', () => {
    const g = newGame();
    for (let i = 0; i < 20; i++) answerCorrect(g);
    expect(g.notes.list()).toEqual([]);
  });
});

describe('상점 kind 검증', () => {
  it('알 수 없는 kind 는 theme 으로 취급되지 않는다', () => {
    const s = emptySave();
    s.coins = 5000;
    expect(buy(s, 'bogus', 'night')).toEqual({ ok: false, reason: 'unknown' });
    expect(s.ownedThemes).toEqual(['dawn']);
    expect(equip(s, 'bogus', 'night')).toBe(false);
  });
});

describe('일일 미션 날짜 되돌리기 방지', () => {
  it('기기 시계를 어제로 돌려도 미션이 다시 초기화되지 않는다', () => {
    const s = emptySave();
    const today = NOW();
    applyRun(s, { correct: 30, bestStreak: 10, reviewCorrect: 5 }, today);
    expect(s.coins).toBe(60);
    const yesterday = today - 86400000;
    applyRun(s, { correct: 30, bestStreak: 10, reviewCorrect: 5 }, yesterday);
    expect(s.coins).toBe(60);            // 어제로 되돌려도 재지급 없음
    const tomorrow = today + 86400000;
    applyRun(s, { correct: 30, bestStreak: 10, reviewCorrect: 5 }, tomorrow);
    expect(s.coins).toBe(120);           // 진짜 다음 날은 정상 지급
  });
});

describe('일일 미션은 학습 행위에만 결부된다 [D27]', () => {
  it('런 반복만으로는 달성되지 않는다', () => {
    const s = emptySave();
    for (let i = 0; i < 20; i++) applyRun(s, { correct: 0, bestStreak: 0, reviewCorrect: 0 }, NOW());
    expect(s.coins).toBe(0);
    expect(todayMissions(s, NOW()).every((m) => !m.claimed)).toBe(true);
  });
  it('정답 30개·스트릭 10·오답노트 5정답으로 달성된다', () => {
    const s = emptySave();
    applyRun(s, { correct: 30, bestStreak: 10, reviewCorrect: 5 }, NOW());
    expect(s.coins).toBe(60);
    expect(todayMissions(s, NOW()).every((m) => m.claimed)).toBe(true);
  });
  it('같은 미션을 두 번 지급하지 않는다', () => {
    const s = emptySave();
    applyRun(s, { correct: 30, bestStreak: 10, reviewCorrect: 5 }, NOW());
    applyRun(s, { correct: 30, bestStreak: 10, reviewCorrect: 5 }, NOW());
    expect(s.coins).toBe(60);
  });
  it('날짜가 바뀌면 초기화된다', () => {
    const s = emptySave();
    applyRun(s, { correct: 30, bestStreak: 10, reviewCorrect: 5 }, NOW());
    const tomorrow = NOW() + 86400000;
    expect(todayMissions(s, tomorrow).every((m) => !m.claimed)).toBe(true);
  });
});

describe('상점 — 코스메틱만, 진행에 영향 없음', () => {
  it('코인이 모자라면 못 산다', () => {
    const s = emptySave();
    expect(buy(s, 'skin', 'rabbit')).toEqual({ ok: false, reason: 'poor' });
    s.coins = 60;
    expect(buy(s, 'skin', 'rabbit').ok).toBe(true);
    expect(s.coins).toBe(0);
    expect(buy(s, 'skin', 'rabbit')).toEqual({ ok: false, reason: 'owned' });
  });
  it('보유하지 않은 것은 장착 불가', () => {
    const s = emptySave();
    expect(equip(s, 'skin', 'dragon')).toBe(false);
    expect(s.skin).toBe('fox');
  });
});

describe('결정론', () => {
  it('같은 시드는 같은 문항 시퀀스를 낸다', () => {
    const seq = (seed) => {
      const g = newGame(seed);
      const out = [];
      for (let i = 0; i < 25; i++) { out.push(`${g.question.id}|${g.question.answerIndex}|${g.question.choices.join(',')}`); answerCorrect(g); }
      return out;
    };
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
  });
  it('문항 은행 크기 — 구구단 72, 영단어 밴드당 «단어수×2방향»', () => {
    expect(buildBank('gugudan').length).toBe(72);
    expect(buildBank('words34').length).toBe(WORDS_G34.length * 2);
    expect(buildBank('words56').length).toBe(WORDS_G56.length * 2);
    // 반복 체감을 좌우하는 «절대량» — 한 판에 같은 단어가 금방 돌아오면 안 된다
    expect(WORDS_G34.length).toBeGreaterThanOrEqual(MIN_WORDS_PER_BAND);
    expect(WORDS_G56.length).toBeGreaterThanOrEqual(MIN_WORDS_PER_BAND);
  });
});

// ── 모드 (D33) ────────────────────────────────────────────
describe('모드', () => {
  const mk = (mode) => new GameCore({ seed: 7, subject: 'gugudan', mode, notes: new PersistentNotes(), now: () => 1_700_000_000_000 });

  it('아슬아슬 모드에는 문항 타이머가 없다 — 시계가 둘이면 왜 죽었는지 알 수 없다', () => {
    const c = mk('thrill');
    c.start();
    expect(c.timerMs).toBe(0);
    expect(c.timeLeftMs).toBe(0);
    // 오래 가만히 둬도 «타임아웃»으로는 죽지 않는다(기력으로만 죽는다)
    c.stamina = 1;
    c.advance(5000);
    expect(c.stats.timeouts).toBe(0);
  });

  it('기력은 국면과 무관하게 줄고, 0 이 되면 그 자리에서 끝난다', () => {
    const c = mk('thrill');
    c.start();
    const before = c.stamina;
    c.advance(1000);
    expect(c.stamina).toBeLessThan(before);
    c.stamina = 0.001;
    const ev = c.advance(100);
    expect(ev.some((e) => e.type === 'gameover' && e.cause === 'stamina')).toBe(true);
    expect(c.phase).toBe(PHASE.OVER);
  });

  it('추락으로 끝난 판은 오답으로 세지 않는다 — 답하지 않은 문항이다', () => {
    const c = mk('thrill');
    c.start();
    const wrongBefore = c.stats.wrong;
    c.stamina = 0.0001;
    c.advance(50);
    expect(c.stats.wrong).toBe(wrongBefore);
  });

  it('정답은 기력을 채우되 «그 층의 천장»을 넘지 못한다', () => {
    const c = mk('thrill');
    c.start();
    c.floor = 60;
    c.stamina = 0.4;
    c.input(c.question.answerIndex);
    expect(c.stamina).toBeLessThanOrEqual(capFor(c.floor) + 1e-9);
    expect(capFor(60)).toBeLessThan(1);
  });

  it('천장은 층이 오를수록 내려가고 바닥이 있다', () => {
    // 단조 감소 + 바닥. 🔴 «어느 층에서» 바닥에 닿는지는 밸런스라 수치로 박지 않는다 —
    //    대신 성질만 잰다(29층 근처에서 닿는다는 사실은 probe-modes 가 재고 문서가 적는다).
    for (let f = 1; f < 80; f++) expect(capFor(f + 1)).toBeLessThanOrEqual(capFor(f));
    expect(capFor(1)).toBeGreaterThan(STAMINA.CAP_MIN);
    expect(capFor(10_000)).toBe(STAMINA.CAP_MIN);
  });

  it('소모는 층에 따라 늘고 상한이 있다', () => {
    expect(drainFor(1)).toBeLessThan(drainFor(50));
    expect(drainFor(10_000)).toBe(STAMINA.DRAIN_MAX);
  });

  it('빨리 답할수록·바닥에 가까울수록 더 회복한다', () => {
    expect(refillFor(0, 1)).toBeGreaterThan(refillFor(3000, 1));
    expect(refillFor(0, 0.1)).toBeGreaterThan(refillFor(0, 1));
  });

  it('아슬아슬도 틀리면 추락한다 — 기력은 «실수 없는 아이»를 끝내는 시계다', () => {
    const c = mk('thrill');
    c.start();
    const r = c.input((c.question.answerIndex + 1) % c.question.choices.length);
    expect(r.over).toBe(true);
    expect(c.stamina).toBeLessThan(STAMINA.START);
  });

  it('60초 질주는 오답이면 한 칸 미끄러진다(0층 아래로는 안 간다)', () => {
    const c = mk('sprint');
    c.start();
    c.advance(50);
    c.input(c.question.answerIndex);
    c.advance(TIMING.JUMP_MS + 1);
    expect(c.floor).toBe(1);
    const r = c.input((c.question.answerIndex + 1) % c.question.choices.length);
    expect(r.slid).toBe(MODES.sprint.slide);
    expect(c.floor).toBe(0);
    c.advance(TIMING.STUMBLE_MS + TIMING.HIGHLIGHT_MS + 1);
    const r2 = c.input((c.question.answerIndex + 1) % c.question.choices.length);
    expect(r2.slid).toBe(0);
    expect(c.floor).toBe(0);
  });

  it('60초 질주는 오답으로 끝나지 않고 판 시계가 깎인다', () => {
    const c = mk('sprint');
    c.start();
    c.advance(50);
    const before = c.runLeftMs;
    const r = c.input((c.question.answerIndex + 1) % c.question.choices.length);
    expect(r.over).toBe(false);
    expect(r.penaltyMs).toBe(MODES.sprint.penaltyMs);
    expect(c.runLeftMs).toBe(before - MODES.sprint.penaltyMs);
    c.advance(TIMING.STUMBLE_MS + TIMING.HIGHLIGHT_MS + 1);
    expect(c.phase).toBe(PHASE.QUESTION);
  });

  it('60초 질주는 시간이 다 되면 끝난다', () => {
    const c = mk('sprint');
    c.start();
    expect(c.runEndsAt).toBe(MODES.sprint.runMs);
    const ev = c.advance(MODES.sprint.runMs + 10);
    expect(ev.some((e) => e.type === 'gameover' && e.cause === 'time')).toBe(true);
  });

  it('클래식은 기력·판 시계를 쓰지 않는다(회귀 방지)', () => {
    const c = mk('classic');
    c.start();
    expect(c.stamina).toBe(null);
    expect(c.runEndsAt).toBe(0);
    expect(c.timerMs).toBeGreaterThan(0);
  });

  it('낯선 모드 이름은 클래식으로 떨어진다', () => {
    const c = new GameCore({ seed: 1, subject: 'gugudan', mode: 'nope', notes: new PersistentNotes() });
    expect(c.mode).toBe('classic');
  });
});
