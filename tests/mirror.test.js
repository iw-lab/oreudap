// 거울 계단(v2) — 답을 보고 문제를 고른다. D48.
import { describe, it, expect } from 'vitest';
import { QuestionSource, describeId, buildBank } from '../src/core/questions.js';
import { SessionQueue, PersistentNotes } from '../src/core/srs.js';
import { makeRng } from '../src/core/rng.js';
import { GameCore } from '../src/core/game.js';
import { MODES } from '../src/core/balance.js';
import { bucketOf } from '../src/core/mastery.js';

const src = (subject, seed = 7) => new QuestionSource({
  subject, rng: makeRng(seed), sessionQueue: new SessionQueue(), notes: new PersistentNotes({}), now: () => 1700000000000, mirror: true,
});
const product = (s) => { const [a, b] = s.split('×').map((x) => Number(x.trim())); return a * b; };

describe('거울 계단 [D48]', () => {
  it('모드가 있고 클래식과 수치가 같다(보기 모양만 다르다)', () => {
    expect(MODES.mirror).toBeTruthy();
    expect(MODES.mirror.mirror).toBe(true);
    expect(MODES.mirror.hearts).toBe(MODES.classic.hearts);
    expect(MODES.mirror.timed).toBe(MODES.classic.timed);
  });
  it('구구단: 문제 = 곱, 보기 = 식, 정답 식의 곱 = 문제, 오답 식의 곱 ≠ 문제 (72문항 × 2·3갈래 전수)', () => {
    for (const k of [2, 3]) {
      const s = src('gugudan');
      for (const it of s.items) {
        for (let ai = 0; ai < k; ai++) {
          const q = s.build(it, k, ai);
          expect(q.prompt).toBe(String(it.a * it.b));
          expect(q.choices).toHaveLength(k);
          expect(new Set(q.choices).size).toBe(k);
          q.choices.forEach((c, i) => {
            expect(c).toMatch(/^\d × \d$/);
            if (i === ai) expect(product(c)).toBe(it.a * it.b);
            else expect(product(c)).not.toBe(it.a * it.b);
          });
        }
      }
    }
  });
  it('낱말: 뜻 → 낱말 방향만 나온다', () => {
    const bank = buildBank('words34', null, true);
    expect(bank.length).toBeGreaterThan(100);
    expect(bank.every((x) => x.dir === 'k2w')).toBe(true);
  });
  it('오답노트·숙련도: 거울 id 는 따로 쓰고, 같은 단으로 센다', () => {
    expect(describeId('gm:7x8')).toEqual({ q: '56', a: '7 × 8' });
    expect(describeId('g:7x8')).toEqual({ q: '7 × 8', a: '56' });
    expect(bucketOf('gugudan', 'gm:7x8')).toBe('gugudan:7');
  });
  it('판이 실제로 거울 문항을 낸다', () => {
    const c = new GameCore({ seed: 3, subject: 'gugudan', mode: 'mirror', notes: new PersistentNotes({}), now: () => 1700000000000 });
    c.start();
    for (let i = 0; i < 30 && !c.question; i++) c.advance(100);
    expect(c.question.choices[c.question.answerIndex]).toMatch(/×/);
    expect(c.question.id.startsWith('gm:')).toBe(true);
  });
});
