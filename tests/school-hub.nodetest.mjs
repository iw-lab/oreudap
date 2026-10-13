// 학교 허브 시험 — 실제 스키마(트리거 포함)를 node:sqlite 에 얹어 D1 과 같은 배치 의미로 돌린다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Hub, sqliteD1 } from '../hub/src/hub.js';
import { T, didHash } from '../hub/shared/school.js';

const DID = 'a'.repeat(32), DID2 = 'b'.repeat(32), IPH = 'e'.repeat(16);
const SCHOOL = { code: '7010000', name: '서울한빛초등학교', sido: 'B10' };
async function mk({ free = false } = {}) {
  let now = Date.UTC(2026, 9, 10, 3, 0, 0);
  const hub = new Hub({ db: await sqliteD1(), secret: 'test-key', now: () => now, free });
  const dh = await didHash(DID), dh2 = await didHash(DID2);
  const call = async (p, b) => (await hub.handle(p, b)).body;
  const tick = (ms) => { now += ms; };
  // 문제 묶음 하나를 다 맞혀 경기권을 받는다
  const earn = async (who = dh) => { const p = await call('/pack', { dh: who, subject: 'math', grade: 3 }); tick(T.PACK_MIN_MS_PER_Q * T.PACK_Q + 10);
    const raw = await hub.keyP; const { unseal } = await import('../hub/shared/school.js'); const P = await unseal(raw, p.pid);
    return call('/grade', { dh: who, pid: p.pid, answers: P.a }); };
  return { hub, dh, dh2, call, tick, earn };
}

test('HB-1 새 기기 = 경기권 0(공짜 표 없음) · 묶음 다 맞히면 +TIX_PER_PACK · 같은 묶음 재채점 410 · 너무 빠르면 보류', async () => {
  const { dh, call, tick, earn, hub } = await mk();
  assert.equal((await call('/me', { dh })).tix, 0);
  const p = await call('/pack', { dh, subject: 'eng', grade: 4 });
  assert.equal(p.qs.length, T.PACK_Q);
  assert.ok((await call('/grade', { dh, pid: p.pid, answers: [0, 0, 0, 0, 0] })).tooFast, '1.2초×5 안에 내면 보류');
  const g = await earn();
  assert.equal(g.ticket, T.TIX_PER_PACK); assert.equal(g.tix, T.TIX_PER_PACK);
  const { unseal } = await import('../hub/shared/school.js');
  const p2 = await call('/pack', { dh, subject: 'math', grade: 2 }); tick(9000);
  const P2 = await unseal(await hub.keyP, p2.pid);
  await call('/grade', { dh, pid: p2.pid, answers: P2.a });
  const again = await hub.handle('/grade', { dh, pid: p2.pid, answers: P2.a });
  assert.equal(again.status, 410, '같은 묶음 두 번 = 410');
  const wrong = await call('/pack', { dh, subject: 'math', grade: 2 }); tick(9000);
  const W = await unseal(await hub.keyP, wrong.pid);
  const g3 = await call('/grade', { dh, pid: wrong.pid, answers: W.a.map((a, i) => (i < 2 ? a : (a + 1) % 3)) });
  assert.equal(g3.ticket, 0, '5개 중 2개 정답 = 경기권 0');
});

test('HB-2 경기권 차감 — 0장이면 거절 · 같은 ref 두 번은 한 번만 깎임(멱등)', async () => {
  const { dh, call, earn } = await mk();
  assert.equal((await call('/spend', { dh, ref: 'm:abc:1' })).why, 'ticket');
  await earn();
  const a = await call('/spend', { dh, ref: 'm:abc:1' }), b = await call('/spend', { dh, ref: 'm:abc:1' });
  assert.ok(a.ok && b.ok && b.again); assert.equal(b.tix, T.TIX_PER_PACK - 1);
});

test('HB-3 결과 — 한 경기권에 한 번 · 학교 없으면 0 · 이김 2(판 종류 무관) · 남의 경기권 거절 · 30분 지나면 late · IP 해시 없으면 거절', async () => {
  const { dh, dh2, call, earn, tick } = await mk();
  await earn(); await earn(dh2);
  await call('/spend', { dh, ref: 'ref:r1:0001', kind: 'online' });
  assert.equal((await call('/result', { dh, ref: 'ref:r1:0001', won: true, iph: IPH })).added, 0, '학교 안 고름 = 0점(경기권은 소모)');
  await call('/select', { dh, school: SCHOOL });
  await call('/spend', { dh, ref: 'ref:r2:0001', kind: 'online' });
  assert.equal((await call('/result', { dh, ref: 'ref:r2:0001', won: true, iph: IPH })).added, 2, '온라인이라 우겨도 2');
  assert.equal((await call('/result', { dh, ref: 'ref:r2:0001', won: true, iph: IPH })).why, 'again', '같은 경기권 두 번 = 0');
  assert.equal((await call('/result', { dh: dh2, ref: 'ref:r2:0001', won: true, iph: IPH })).why, 'ticket', '남의 경기권');
  await earn(); await call('/spend', { dh, ref: 'ref:r3:0001' }); tick(T.RESULT_TTL_MIN * 60000 + 1);
  assert.equal((await call('/result', { dh, ref: 'ref:r3:0001', won: true, iph: IPH })).why, 'late');
  const top = await call('/top', { dh });
  assert.equal(top.weekly[0].s, 2); assert.equal(top.mine.weekly.rank, 1);
});

test('HB-4 환불 — 쓴 지 90초 안·결과 전만 · 두 번 환불 0 · 결과 낸 표는 환불 0', async () => {
  const { dh, call, earn, tick } = await mk();
  await earn(); await call('/select', { dh, school: SCHOOL });
  await call('/spend', { dh, ref: 'ref:f1:0001' });
  const r = await call('/refund', { dh, ref: 'ref:f1:0001' });
  assert.ok(r.ok); assert.equal(r.tix, T.TIX_PER_PACK);
  assert.equal((await call('/refund', { dh, ref: 'ref:f1:0001' })).ok, false);
  await call('/spend', { dh, ref: 'ref:f2:0001' }); await call('/result', { dh, ref: 'ref:f2:0001', won: false, iph: IPH });
  assert.equal((await call('/refund', { dh, ref: 'ref:f2:0001' })).ok, false, '점수 받은 표 환불 = 이중 이득');
  await call('/spend', { dh, ref: 'ref:f3:0001' }); tick(T.TICKET_REFUND_SEC * 1000 + 1);
  assert.equal((await call('/refund', { dh, ref: 'ref:f3:0001' })).ok, false, '90초 지나면 환불 0');
});

test('HB-5 하루 상한 — 기기 40 · IP 상한', async () => {
  const { dh, call, earn } = await mk();
  await call('/select', { dh, school: SCHOOL });
  let sum = 0;
  for (let i = 0; i < 12; i++) { await earn(); await call('/spend', { dh, ref: `ref:c${i}a:01`, kind: 'online' }); sum += (await call('/result', { dh, ref: `ref:c${i}a:01`, won: true, iph: IPH })).added;
    await call('/spend', { dh, ref: `ref:c${i}b:01`, kind: 'online' }); sum += (await call('/result', { dh, ref: `ref:c${i}b:01`, won: true, iph: IPH })).added; }
  assert.equal(sum, T.SCHOOL_DAY_CAP);
  assert.equal((await call('/result', { dh, ref: 'ref:noiph:01', won: true })).why, 'iph', 'IP 해시 없음 = 거절');
  const m = await mk(); await m.call('/select', { dh: m.dh, school: SCHOOL });
  await m.hub.db.prepare('INSERT INTO ipcap (day, iph, s) VALUES (?, ?, ?)').bind('2026-10-10', 'f'.repeat(16), T.IP_DAY_CAP - 1).run();
  await m.earn(); await m.call('/spend', { dh: m.dh, ref: 'ref:ip1:0001', kind: 'online' });
  assert.equal((await m.call('/result', { dh: m.dh, ref: 'ref:ip1:0001', won: true, iph: 'f'.repeat(16) })).added, 1, 'IP 상한에 1 남음');
});

test('HB-6 경합 — 환불된 표에 결과 0 · 결과 낸 표 환불 0 · 상한 넘는 갱신은 DB 가 거절', async () => {
  const { dh, call, earn, hub } = await mk();
  await earn(); await call('/select', { dh, school: SCHOOL });
  await call('/spend', { dh, ref: 'ref:race1:01' });
  assert.ok((await call('/refund', { dh, ref: 'ref:race1:01' })).ok);
  assert.equal((await call('/result', { dh, ref: 'ref:race1:01', won: true, iph: IPH })).why, 'ticket', '환불된 표로 점수 0');
  await call('/spend', { dh, ref: 'ref:race2:01' });
  assert.equal((await call('/result', { dh, ref: 'ref:race2:01', won: true, iph: IPH })).added, 2);
  assert.equal((await call('/refund', { dh, ref: 'ref:race2:01' })).ok, false, '점수 받은 표 환불 0');
  // 배치 안의 트리거가 직접 막는지 — «읽고 계산»을 건너뛴 갱신(동시 요청 흉내)
  await hub.db.prepare("UPDATE dev SET pts = 39, pts_day = '2026-10-10' WHERE dh = ?").bind(dh).run();
  await assert.rejects(hub.db.batch([hub.db.prepare("UPDATE dev SET pts = pts + 2 WHERE dh = ?").bind(dh)]), /cap/);
  await assert.rejects(hub.db.batch([hub.db.prepare("INSERT INTO ipcap (day, iph, s) VALUES ('2026-10-10', 'x', ?)").bind(T.IP_DAY_CAP + 1)]), /cap/);
  // 남의 dh 로 scored 를 직접 넣어도 트리거가 막는다
  await call('/spend', { dh, ref: 'ref:race3:01' }).catch(() => {});
  await assert.rejects(hub.db.batch([hub.db.prepare("INSERT INTO scored (ref, dh, n, at) VALUES ('ref:race3:01', 'ffffffffffffffff', 2, 1)")]), /ticket/);
});

test('HB-7 FREE_PLAY — 이용권 0장이어도 판 영수증이 나오고 학교 점수 정산 · 같은 ref 멱등 · 끄면(기본) 그대로 거절', async () => {
  const off = await mk();
  assert.equal((await off.call('/me', { dh: off.dh })).free, false);
  assert.equal((await off.call('/spend', { dh: off.dh, ref: 'r'.repeat(20), kind: 'level' })).ok, false, '기본 허브 = 0장이면 거절');
  const { dh, call, tick } = await mk({ free: true });
  const me = await call('/me', { dh });
  assert.equal(me.free, true); assert.equal(me.tix, 0);
  await call('/select', { dh, school: SCHOOL });
  const ref = 'f'.repeat(20);
  assert.equal((await call('/spend', { dh, ref, kind: 'level' })).ok, true, 'FREE_PLAY = 0장이어도 판 시작');
  assert.equal((await call('/spend', { dh, ref, kind: 'level' })).ok, true, '같은 ref 재전송 멱등');
  assert.equal((await call('/me', { dh })).tix, 0, '차감 전후 이용권 0장 그대로(넣고 바로 씀)');
  tick(60_000);
  const r = await call('/result', { dh, ref, won: true, iph: IPH });
  assert.equal(r.added, 2, '판 끝 학교 점수 정산: ' + JSON.stringify(r));
});
