// 일일 등수 — 서버가 «받아도 되는 것»만 받는지. 판정은 전부 rank-core 에 있다.
import { describe, it, expect } from 'vitest';
import { acceptName, clean, merge, dedupe, rankOf, rollover, MAX_FLOOR, KEEP, normSub, rowKey, dayFor, isTestRow, rankIn } from '../worker/src/rank-core.js';
import { submitScore, topRows } from '../worker/src/board.js';
import { d1 } from './d1stub.js';
import { isGeneratedNick, makeNick, maskNick, isUsableNick } from '../src/core/nickname.js';

const G = isGeneratedNick;

describe('이름 수용 규칙 — 실명이 서버에 남지 않는다 [D29]', () => {
  it('가려지지 않은 «직접 지은 이름»은 거부한다', () => {
    for (const raw of ['김철수', '이하늘', '박민준', 'Minjun']) {
      expect(acceptName(raw, G), raw).toBeNull();
    }
  });

  it('가린 이름은 받는다 — 그리고 그것이 화면에 뜨는 모양이다', () => {
    expect(maskNick('김철수')).toBe('김*수');
    expect(acceptName('김*수', G)).toBe('김*수');
    expect(acceptName('남**수', G)).toBe('남**수');
  });

  it('자동 생성 이름은 가리지 않고 그대로 받는다 (사람을 가리키지 않는다)', () => {
    for (let i = 0; i < 50; i++) {
      const n = makeNick();
      expect(maskNick(n)).toBe(n);
      expect(acceptName(n, G)).toBe(n);
    }
  });

  it('별표만 있는 이름·스크립트·낱자·공백은 거부한다', () => {
    for (const bad of ['***', '<script>', 'ㅅㅂ', '김 철수', '', null, 42, '김철수\n']) {
      expect(acceptName(bad, G), String(bad)).toBeNull();
    }
  });

  it('아이가 직접 지은 이름은 가려서 보내면 서버가 받는다 (왕복 계약)', () => {
    for (const raw of ['하늘별', '축구왕', '김철수', 'Sky']) {
      expect(isUsableNick(raw), raw).toBe(true);
      expect(acceptName(maskNick(raw), G), raw).not.toBeNull();
    }
  });
});

describe('판 정리 [D29]', () => {
  const day = '2026-09-04';
  it('층 상한을 넘거나 0 이하인 기록은 버린다', () => {
    expect(clean({ n: '김*수', s: MAX_FLOOR + 1, sub: 'gugudan' }, G)).toBeNull();
    expect(clean({ n: '김*수', s: 0, sub: 'gugudan' }, G)).toBeNull();
    // 🔴 모드 없는 옛 형식은 «클래식»으로 읽힌다 — 표는 «과목:모드» 단위다(같은 규칙끼리 줄 세운다).
    expect(clean({ n: '김*수', s: 12, sub: 'gugudan' }, G)).toEqual({ n: '김*수', s: 12, sub: 'gugudan:classic' });
  });

  it('같은 이름은 최고 기록 한 줄만 남는다 — 한 아이가 판을 도배하지 못한다', () => {
    let b = null;
    for (const s of [5, 30, 12, 30, 8]) b = merge(b, { n: '김*수', s, sub: 'gugudan' }, day, G);
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0].s).toBe(30);
  });

  it('과목이 다르면 같은 이름이라도 다른 줄이다', () => {
    let b = null;
    b = merge(b, { n: '김*수', s: 10, sub: 'gugudan' }, day, G);
    b = merge(b, { n: '김*수', s: 20, sub: 'words34' }, day, G);
    expect(b.rows).toHaveLength(2);
  });

  it('판은 KEEP 줄을 넘지 않는다', () => {
    let b = null;
    for (let i = 0; i < KEEP + 20; i++) b = merge(b, { n: `아*${i}`, s: i + 1, sub: 'gugudan' }, day, G);
    expect(b.rows.length).toBeLessThanOrEqual(KEEP);
    expect(b.rows[0].s).toBeGreaterThan(b.rows[b.rows.length - 1].s);
  });

  it('날이 바뀌면 오늘 판을 비우고 어제 상위만 남긴다', () => {
    let b = null;
    for (const s of [30, 20, 10]) b = merge(b, { n: `아*${s}`, s, sub: 'gugudan' }, day, G);
    const next = rollover(b, '2026-09-05');
    expect(next.rows).toHaveLength(0);
    expect(next.yday.day).toBe(day);
    expect(next.yday.rows.length).toBeGreaterThan(0);
  });

  it('등수는 «나보다 높은 사람 수 + 1» 이다', () => {
    const rows = dedupe([30, 20, 20, 10].map((s, i) => ({ n: `아*${i}`, s, sub: 'gugudan' })));
    expect(rankOf(rows, 31)).toBe(1);
    expect(rankOf(rows, 20)).toBe(2);   // 공동 2위
    expect(rankOf(rows, 5)).toBe(5);
    expect(rankOf(rows, 0)).toBeNull();
  });
});

describe('모드별 표 분리', () => {
  const G = isGeneratedNick;
  it('같은 이름이라도 모드가 다르면 다른 줄이다 — 규칙이 다른 기록은 섞이지 않는다', () => {
    const day = '2026-09-05';
    let b = rollover(null, day);
    b = merge(b, { n: '김*수', s: 40, sub: 'gugudan', m: 'classic' }, day, G);
    b = merge(b, { n: '김*수', s: 12, sub: 'gugudan', m: 'sprint' }, day, G);
    expect(b.rows.length).toBe(2);
    expect(new Set(b.rows.map((r) => r.sub))).toEqual(new Set(['gugudan:classic', 'gugudan:sprint']));
  });
  it('낯선 모드는 클래식으로 떨어진다(서버도 신뢰 경계 밖이다)', () => {
    expect(normSub('gugudan', '해킹')).toBe('gugudan:classic');
    expect(normSub(null)).toBe('gugudan:classic');
  });
  it('과목과 모드를 따로 받는다 — 합쳐 보내면 배포 순서에 물린다', () => {
    // 🔴 옛 워커가 도는 동안 클라이언트가 'words56:sprint' 를 보내면 화이트리스트에 없어
    //    첫 과목(구구단)으로 떨어진다 = 영단어 기록이 구구단 표에 실린다. 나눠 받으면 안 물린다.
    expect(normSub('words56', 'sprint')).toBe('words56:sprint');
    expect(normSub('words56')).toBe('words56:classic');          // 모드 모르는 옛 클라이언트
    expect(normSub('words56:thrill')).toBe('words56:thrill');    // 합쳐 온 값도 읽는다
    expect(clean({ n: '김*수', s: 9, sub: 'words56', m: 'thrill' }, G))
      .toEqual({ n: '김*수', s: 9, sub: 'words56:thrill' });
  });
});

// ── 동시 제출에서 줄이 사라지지 않는다 (2026-09-05 실측 결함의 재발 방지) ──
describe('동시 제출', () => {
  // 2026-10-08 KV → D1. 예전 «늦은 읽기» KV 흉내 대신 진짜 SQLite 위에서 잰다.
  const staleKV = d1;
  const count = (db) => db.raw.prepare('SELECT COUNT(*) AS c FROM rows').get().c;

  it('같은 순간에 들어온 서로 다른 제출이 서로를 덮어쓰지 않는다', async () => {
    const kv = staleKV();
    const people = Array.from({ length: 25 }, (_, i) => ({
      n: `빠른여우${String(i).padStart(2, '0')}`, s: i + 1, sub: 'gugudan', m: 'classic',
    }));
    // 🔴 «동시»를 흉내 낸다 — 순차로 await 하면 옛 구조도 통과한다.
    await Promise.all(people.map((p) => submitScore(kv, p)));
    const board = await topRows(kv, 50);
    expect(board.total).toBe(25);
    expect(new Set(board.rows.map((r) => r.n)).size).toBe(25);
  });

  it('같은 사람이 다시 내면 «더 높은 기록»만 남는다(줄이 늘지 않는다)', async () => {
    const kv = staleKV();
    await submitScore(kv, { n: '김*수', s: 10, sub: 'gugudan', m: 'classic' });
    await submitScore(kv, { n: '김*수', s: 30, sub: 'gugudan', m: 'classic' });
    await submitScore(kv, { n: '김*수', s: 20, sub: 'gugudan', m: 'classic' });
    const b = await topRows(kv, 50);
    expect(b.total).toBe(1);
    expect(b.rows[0].s).toBe(30);
  });

  it('같은 이름·같은 층을 두 번 내도 오류 없이 한 줄이다(INSERT OR IGNORE)', async () => {
    const kv = staleKV();
    expect((await submitScore(kv, { n: '김*수', s: 30, sub: 'gugudan', m: 'classic' })).ok).toBe(true);
    expect((await submitScore(kv, { n: '김*수', s: 30, sub: 'gugudan', m: 'classic' })).ok).toBe(true);
    expect(count(kv)).toBe(1);
  });

  it('모드가 다르면 같은 사람도 다른 줄이다', async () => {
    const kv = staleKV();
    await submitScore(kv, { n: '김*수', s: 40, sub: 'words56', m: 'classic' });
    await submitScore(kv, { n: '김*수', s: 12, sub: 'words56', m: 'sprint' });
    const b = await topRows(kv, 50);
    expect(b.total).toBe(2);
    expect(new Set(b.rows.map((r) => r.sub))).toEqual(new Set(['words56:classic', 'words56:sprint']));
  });

  it('방금 낸 기록이 목록에 아직 안 보여도 내 등수에는 내가 들어간다', async () => {
    // 🔴 KV list 는 방금 쓴 키를 30~60초쯤 뒤에야 보여 준다. 그대로 매기면 «내가 빠진 판»에서
    //    내 등수를 계산해 방금 1등을 했는데도 이상한 숫자가 나온다.
    const kv = staleKV();
    const r = await submitScore(kv, { n: '김*수', s: 40, sub: 'gugudan', m: 'classic' });
    expect(r.ok).toBe(true);
    expect(r.rank).toBe(1);
    expect(r.total).toBe(1);
  });

  it('별표 없는 실명은 키를 만들지도 않는다', async () => {
    const kv = staleKV();
    const r = await submitScore(kv, { n: '김철수', s: 50, sub: 'gugudan', m: 'classic' });
    expect(r.ok).toBe(false);
    expect(count(kv)).toBe(0);
  });

  it('줄 키에 날짜·과목·모드·이름·점수가 다 들어간다(옛 KV 키 — 이전 스크립트가 읽는다)', () => {
    // 점수까지 키에 있어야 «다른 기록 = 다른 키» 가 되어 덮어쓰기가 원천적으로 없다.
    expect(rowKey('2026-09-05', 'words56:sprint', '김*수', 12)).toBe('r:2026-09-05:words56:sprint:김*수:0012');
  });

  it('늦은 읽기가 있어도 낮은 점수가 높은 기록을 덮지 않는다', async () => {
    // 🔴 이 테스트가 실제로 결함을 잡았다 — 「내 줄을 읽어 더 높으면 쓴다」 구조에서는
    //    30층이 20층으로 내려앉았다(KV 읽기가 한 박자 늦기 때문).
    const kv = staleKV();
    await submitScore(kv, { n: '김*수', s: 30, sub: 'gugudan', m: 'classic' });
    await submitScore(kv, { n: '김*수', s: 20, sub: 'gugudan', m: 'classic' });
    const b = await topRows(kv, 50);
    expect(b.rows[0].s).toBe(30);
  });
});

describe('게이트 봇의 기록이 아이들 판에 섞이지 않는다', () => {
  const kvStub = d1;

  it('t 표시를 읽는다', () => {
    expect(isTestRow({ t: 1 })).toBe(true);
    expect(isTestRow({ t: true })).toBe(true);
    expect(isTestRow({ s: 10 })).toBe(false);
    expect(isTestRow(null)).toBe(false);
  });

  it('시험 칸은 진짜 날짜와 «다른» 칸이다', () => {
    expect(dayFor('2026-09-05', false)).toBe('2026-09-05');
    expect(dayFor('2026-09-05', true)).not.toBe('2026-09-05');
  });

  it('🔴 봇이 아무리 높은 층을 올려도 오늘 판에는 한 줄도 안 뜬다', async () => {
    const kv = kvStub();
    // 봇 다섯이 사람보다 훨씬 높은 기록을 낸다 — 표시가 없으면 판을 통째로 차지할 점수다
    for (let i = 0; i < 5; i += 1) {
      await submitScore(kv, { n: `빠른여우${String(i).padStart(2, '0')}`, s: 400 + i, sub: 'gugudan', m: 'classic', t: 1 });
    }
    await submitScore(kv, { n: '김*수', s: 7, sub: 'gugudan', m: 'classic' });

    const board = await topRows(kv, 50);
    expect(board.total).toBe(1);
    expect(board.rows.map((r) => r.n)).toEqual(['김*수']);
  });

  it('그래도 봇의 제출은 «성공»으로 돌아온다 — 게이트가 재는 경로가 줄면 안 된다', async () => {
    const kv = kvStub();
    const r = await submitScore(kv, { n: '빠른여우07', s: 30, sub: 'gugudan', m: 'classic', t: 1 });
    expect(r.ok).toBe(true);
    expect(r.rank).toBe(1);        // 등수 계산까지 돌았다
    expect(r.total).toBe(1);
  });

  it('봇 줄은 이름 규칙 검사를 그대로 통과해야 한다 — 시험 칸이 뒷문이 되면 안 된다', async () => {
    const kv = kvStub();
    const r = await submitScore(kv, { n: '김철수', s: 30, sub: 'gugudan', m: 'classic', t: 1 });
    expect(r.ok).toBe(false);      // 가리지 않은 실명은 시험 칸에도 안 들어간다
  });
});

describe('등수는 «내 표» 안에서 매긴다 [2026-09-05 교차검증 발견]', () => {
  const kvStub = d1;

  it('🔴 영단어를 처음 하는 아이는 구구단 점수 때문에 2등이 되지 않는다', async () => {
    const kv = kvStub();
    await submitScore(kv, { n: '졸린오리58', s: 100, sub: 'gugudan', m: 'classic' });
    const r = await submitScore(kv, { n: '명랑한여우54', s: 10, sub: 'words34', m: 'classic' });
    expect(r).toMatchObject({ ok: true, rank: 1, total: 1 });
  });

  it('🔴 등수가 인원보다 클 수 없다 — 낮은 점수를 다시 내도 «내 최고»로 센다', async () => {
    const kv = kvStub();
    await submitScore(kv, { n: '졸린오리58', s: 30, sub: 'gugudan', m: 'classic' });
    await submitScore(kv, { n: '명랑한여우54', s: 25, sub: 'gugudan', m: 'classic' });
    const r = await submitScore(kv, { n: '졸린오리58', s: 20, sub: 'gugudan', m: 'classic' });
    expect(r.rank).toBe(1);
    expect(r.rank).toBeLessThanOrEqual(r.total);
  });

  it('같은 과목이라도 모드가 다르면 다른 표다', async () => {
    const kv = kvStub();
    await submitScore(kv, { n: '졸린오리58', s: 90, sub: 'gugudan', m: 'classic' });
    const r = await submitScore(kv, { n: '명랑한여우54', s: 12, sub: 'gugudan', m: 'sprint' });
    expect(r).toMatchObject({ rank: 1, total: 1 });
  });

  it('🔴 다른 과목 기록이 판 상위 50줄을 채워도 내 표 등수·인원이 맞다 [2026-10-08 교차검증 codex·meta]', async () => {
    const db = kvStub();
    for (let i = 0; i < 50; i += 1) await submitScore(db, { n: `빠른여우${String(i).padStart(2, '0')}`, s: 450 + i, sub: 'words56', m: 'classic' });
    await submitScore(db, { n: '졸린오리58', s: 400, sub: 'gugudan', m: 'classic' });
    await submitScore(db, { n: '명랑한여우54', s: 300, sub: 'gugudan', m: 'classic' });
    const r = await submitScore(db, { n: '명랑한여우54', s: 200, sub: 'gugudan', m: 'classic' });
    expect(r).toMatchObject({ ok: true, rank: 2, total: 2 });
  });

  it('점수에 객체가 오면 서버 오류가 아니라 «거부»다', async () => {
    const db = kvStub();
    expect(await submitScore(db, { n: '졸린오리58', s: { toString: null }, sub: 'gugudan', m: 'classic' })).toEqual({ ok: false, reason: 'rejected' });
  });

  it('rankIn 은 순수 함수로도 같은 판정을 한다', () => {
    const rows = [
      { n: '가', s: 100, sub: 'gugudan:classic' },
      { n: '나', s: 10, sub: 'words34:classic' },
    ];
    expect(rankIn(rows, 'words34:classic', '나', 10)).toEqual({ rank: 1, total: 1 });
    expect(rankIn(rows, 'gugudan:classic', '가', 100)).toEqual({ rank: 1, total: 1 });
  });
});

describe('판이 아주 클 때 [2026-09-05 교차검증 발견 · 2026-10-08 D1]', () => {
  // KV 시절엔 목록이 1,000줄씩 끊겨 «5페이지 너머의 1등»을 놓쳤다. D1 은 한 번에 다 읽는다 — 그래도 잰다.
  it('🔴 8,000줄 판에서 맨 뒤 이름의 1등을 놓치지 않는다', async () => {
    const db = d1();
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const ins = db.raw.prepare('INSERT INTO rows (day, sub, n, s, at) VALUES (?, ?, ?, ?, 0)');
    for (let i = 0; i < 8000; i += 1) ins.run(day, 'gugudan:classic', `빠른여우${String(i).padStart(5, '0')}`, i === 7999 ? 400 : 10);
    const r = await submitScore(db, { n: '졸린오리58', s: 30, sub: 'gugudan', m: 'classic' });
    expect(r.ok).toBe(true);
    expect(r.partial).toBeUndefined();
    expect(r.rank).toBe(2);
  });

  it('사흘 지난 줄은 제출 때 치운다(KV TTL 대신) · 오늘·어제 줄과 봇 칸 오늘 줄은 남는다', async () => {
    const db = d1();
    const k = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
    const now = Date.now(), old = k(now - 5 * 864e5), yday = k(now - 864e5);
    const ins = db.raw.prepare('INSERT INTO rows (day, sub, n, s, at) VALUES (?, ?, ?, ?, 0)');
    ins.run(k(now - 3 * 864e5), 'gugudan:classic', '빠른여우05', 5);
    ins.run(old, 'gugudan:classic', '빠른여우01', 5); ins.run(`t-${old}`, 'gugudan:classic', '빠른여우02', 5);
    ins.run(yday, 'gugudan:classic', '빠른여우03', 9); ins.run(`t-${k(now)}`, 'gugudan:classic', '빠른여우04', 9);
    await submitScore(db, { n: '졸린오리58', s: 30, sub: 'gugudan', m: 'classic' });
    const days = db.raw.prepare('SELECT day FROM rows ORDER BY day').all().map((x) => x.day);
    expect(days).not.toContain(old);
    expect(days).not.toContain(`t-${old}`);
    const d3 = k(now - 3 * 864e5);   // 오늘 포함 3일(오늘·어제·그제)만 남는다 — 사흘 전은 지운다
    expect(days).not.toContain(d3);
    expect(days).toEqual(expect.arrayContaining([yday, k(now), `t-${k(now)}`]));
    const b = await topRows(db, 50);
    expect(b.yday.rows.map((r) => r.n)).toEqual(['빠른여우03']);
  });
});
