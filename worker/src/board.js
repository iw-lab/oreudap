// 판 저장 — **D1 한 행 = 기록 한 줄**(2026-10-08 KV → D1).
//
// 🔴 왜 옮겼나: KV 시절 등수판 한 번 그리기 = 목록 조회(list) 2회, 제출 = 쓰기 1 + 목록 1.
//    KV 무료 목록 조회는 계정 전체 하루 1,000회라 교실 몇 반이면 바닥났다(2026-10-07 1,303회 → 429).
//    D1 은 읽기 500만 행·쓰기 10만 행/일이다. 워커는 daum 계정으로 옮겼다(gmail 계정 D1 은 10개 상한).
//
// 🔴 KV 시절의 결정은 그대로 산다: 점수까지 기본키라 «다른 기록 = 다른 행» → 읽고-고치고-쓰기가 없다.
//    D1 은 쓴 직후 읽으면 바로 보이므로(단일 주 DB) «방금 쓴 줄이 목록에 없다» 보정은 필요 없지만,
//    해가 없어 dedupe 에 add 를 그대로 끼워 둔다.
//
// 🔴 «사람»을 저장하지 않는다. 계정도 쿠키도 기기 식별자도 없다. 이름은 기기가 가려서 보내고,
//    별표 없는 직접 이름은 거부한다(rank-core.acceptName).
//
// ⚠️ 오르답은 싱글 플레이라 점수를 «클라이언트가» 보낸다 — 이 판은 «오늘의 기록판»이지 공식 기록이 아니다.
import { kstDay, clean, dedupe, rankIn, dayFor, isTestRow, KEEP, YDAY_KEEP } from './rank-core.js';
import { isGeneratedNick } from '../../src/core/nickname.js';

const KEEP_DAYS = 3;                       // 사흘이면 «오늘 + 어제»를 그리고도 남는다
// 표는 이름·과목당 한 줄(최고 기록)이라 판 읽기는 그날 행을 그대로 읽으면 된다
// 판 조회는 (day, s) 인덱스로 상위 ?2 줄만 읽는다(D1 은 «읽은 행» 단위로 센다 — 2026-10-08 FULL grok·gemini)
const DAY_ROWS = 'SELECT sub, n, s FROM rows WHERE day = ?1 ORDER BY s DESC LIMIT ?2';
const SUB_ROWS = 'SELECT sub, n, s FROM rows WHERE day = ?1 AND sub = ?2';
// 🔴 더 높은 기록일 때만 올린다 — 같은 아이의 낮은 재제출·동시 제출이 최고 기록을 덮지 못한다(원자 upsert)
const UPSERT = `INSERT INTO rows (day, sub, n, s, at) VALUES (?1, ?2, ?3, ?4, ?5)
  ON CONFLICT (day, sub, n) DO UPDATE SET s = excluded.s, at = excluded.at WHERE excluded.s > rows.s`;

const shiftDay = (day, d) => new Date(Date.parse(day + 'T00:00:00Z') + d * 864e5).toISOString().slice(0, 10);

export async function submitScore(db, row) {
  const add = clean(row, isGeneratedNick);
  if (!add) return { ok: false, reason: 'rejected' };
  const today = kstDay();
  // 🔴 봇의 줄은 시험 칸으로. 아이들이 보는 판(topRows)은 언제나 진짜 날짜만 읽는다.
  const day = dayFor(today, isTestRow(row));
  const cut = shiftDay(today, -(KEEP_DAYS - 1));   // day < cut 을 지운다 → 오늘 포함 달력 KEEP_DAYS 일만 남는다(FULL codex·grok: 전엔 4일)
  // 넣기 · 오래된 줄 치우기(KV 의 TTL 대신 — 진짜 칸·봇 칸을 따로, 각각 기본키 범위로) · 내 표 읽기를 한 묶음으로
  const [, , , mine] = await db.batch([
    db.prepare(UPSERT).bind(day, add.sub, add.n, add.s, Date.now()),
    db.prepare('DELETE FROM rows WHERE day < ?1').bind(cut),
    db.prepare("DELETE FROM rows WHERE day >= 't-' AND day < ?1").bind(dayFor(cut, true)),
    db.prepare(SUB_ROWS).bind(day, add.sub),
  ]);
  // 🔴 등수·인원은 «내 표»(과목:모드) **전체**로 센다 — 판 전체 상위 50줄로 자른 뒤 세면
  //    다른 과목 기록이 50줄을 채울 때 내 표가 통째로 빠져 「1등 · 0명」이 됐다(2026-10-08 교차검증 codex·meta).
  const rows = (mine.results || []).map((r) => (r.n === add.n && r.s < add.s ? { ...r, s: add.s } : r));
  if (!rows.some((r) => r.n === add.n)) rows.push(add);
  return { ok: true, ...rankIn(rows, add.sub, add.n, add.s) };
}

export async function topRows(db, n) {
  const day = kstDay();
  const y = shiftDay(day, -1);
  const [t, yy] = await db.batch([db.prepare(DAY_ROWS).bind(day, KEEP), db.prepare(DAY_ROWS).bind(y, YDAY_KEEP)]);
  const rows = dedupe(t.results || []);
  const yrows = dedupe(yy.results || []).slice(0, YDAY_KEEP);
  return {
    day,
    rows: rows.slice(0, Math.max(1, Math.min(KEEP, n | 0))),
    total: rows.length,
    yday: yrows.length ? { day: y, rows: yrows } : null,
  };
}
