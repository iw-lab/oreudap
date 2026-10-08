// 일일 등수 클라이언트.
//
// 🔴 «가리는 자리»가 보내기 «전»이다. 직접 지은 이름의 원문은 이 기기를 영영 벗어나지 않는다.
//    화면에서만 가리면 서버에는 '김철수' 가 그대로 남는다 — 가린 티만 나고 지켜지는 건 없다.
//    (리로드 아레나는 멀티라 방이 이름을 알 수밖에 없어 서버에서 가린다. 오르답은 싱글이라
//     서버가 이름을 알 이유가 아예 없다 — 그래서 여기서 가린다.)
//
// 🔴 서버는 별표 없는 «직접 이름»을 거부한다(worker/src/rank-core.js 의 acceptName).
//    즉 이 규칙은 예의가 아니라 게이트다.

import { makeNick, isUsableNick, coerceNick, maskNick } from './nickname.js';

export const RANK_API = 'https://oreudap-rank.simssijjang-a04.workers.dev/api/rank';
const NICK_KEY = 'oreudap:nick';
const SENT_KEY = 'oreudap:sent';   // 오늘 이미 올린 최고 기록 — 같은 점수를 반복해 올리지 않는다

function ls() {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
export function todayKey(now = Date.now()) {
  return new Date(now + 9 * 3600e3).toISOString().slice(0, 10);   // 한국 날짜
}

/** 저장된 이름. 없거나 못 쓰는 이름이면 새로 지어 «즉시 저장»한다
 *  (저장하지 않으면 새로고침마다 이름이 바뀐다). */
export function getNick() {
  const s = ls();
  let n = null;
  try { n = s && s.getItem(NICK_KEY); } catch { n = null; }
  if (!isUsableNick(n)) {
    n = makeNick();
    try { if (s) s.setItem(NICK_KEY, n); } catch { /* 사생활 보호 모드 */ }
  }
  return n;
}

/** @returns {{ok:boolean, nick?:string, reason?:string}} */
export function setNick(raw) {
  const clean = coerceNick(raw);
  if (!clean) return { ok: false, reason: '이 이름은 쓸 수 없어요. 다른 이름을 지어 주세요.' };
  try { const s = ls(); if (s) s.setItem(NICK_KEY, clean); } catch { /* 무시 */ }
  return { ok: true, nick: clean };
}

export function suggestNick() { return makeNick(); }

/** 화면과 서버에 나갈 «가려진» 이름 */
export function displayNick(n) { return maskNick(n || getNick()); }

/**
 * 이 판이 «봇이 도는 판»인가.
 * 🔴 게이트마다 플래그를 심는 방식은 쓰지 않는다 — 규칙이 7군데로 흩어지면 반드시 절반만 고쳐진다
 *    (2026-09-05 에 qa-live 하나를 빠뜨려 배포 후 터졌다). 자동화 브라우저는 스스로 신분을 밝히므로
 *    그 한 줄을 읽으면 게이트가 몇 개든, 앞으로 몇 개가 생기든 자동으로 걸린다.
 * 🔴 왜 «안 보내기»가 아니라 «표시해 보내기»인가: D29(실명 마스킹)는 서버까지 실제로 나간 바이트를
 *    검사해야 뜻이 있다. 보내지 않으면 그 게이트가 아무것도 재지 않게 된다.
 */
function isBot() {
  try { return typeof navigator !== 'undefined' && navigator.webdriver === true; } catch { return false; }
}

function sentBest(now) {
  const s = ls();
  try {
    const raw = s && s.getItem(SENT_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && v.day === todayKey(now) ? (v.best || {}) : {};
  } catch { return {}; }
}

/** 오늘 판 상위 n줄 */
export async function fetchBoard(n = 10, fetchFn = fetch) {
  const r = await fetchFn(`${RANK_API}?n=${n}`, { method: 'GET' });
  if (!r.ok) throw new Error(`rank ${r.status}`);
  return r.json();
}

/**
 * 기록 올리기. 오늘 이미 올린 내 최고보다 낮으면 «보내지 않는다» —
 * 서버 쓰기를 아끼고(무료 한도), 판도 같은 아이로 도배되지 않는다.
 */
/**
 * @param {string} subject 'gugudan' | 'words34' | 'words56'
 * @param {number} floor
 * @param {object} [opts] { mode }
 * 🔴 과목과 모드를 «따로» 보낸다. 합쳐 보내면 아직 옛 워커가 도는 동안 그 값이 화이트리스트에
 *    없어 첫 과목(구구단)으로 떨어진다 — 영단어 기록이 구구단 표에 실린다.
 *    나눠 보내면 옛 워커는 모드를 무시하고 과목만 제대로 쓴다(배포 순서에 안 물린다).
 */
export async function submitScore(subject, floor, opts = {}) {
  const now = opts.now || Date.now();
  const fetchFn = opts.fetch || fetch;
  if (!(floor > 0)) return { skipped: 'zero' };
  const mode = opts.mode || 'classic';
  const key = `${subject}:${mode}`;
  const best = sentBest(now);
  if ((best[key] || 0) >= floor) return { skipped: 'notbest' };

  const body = { n: displayNick(opts.nick), s: floor, sub: subject, m: mode };
  // 봇의 기록은 아이들이 보는 오늘 판이 아니라 서버의 «시험 칸»으로 간다.
  if (opts.bot !== undefined ? opts.bot : isBot()) body.t = 1;
  const r = await fetchFn(RANK_API, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({ ok: false }));
  if (out.ok) {
    try {
      const s = ls();
      if (s) s.setItem(SENT_KEY, JSON.stringify({ day: todayKey(now), best: { ...best, [key]: floor } }));
    } catch { /* 무시 */ }
  }
  return out;
}
