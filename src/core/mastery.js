// 숙련도 — 「내가 진짜 잘하게 됐다」.
//
// 🔴 이건 등수가 아니라 «어제의 나»다. 조사(docs/RESEARCH-retention.md §2)에서 갈린 지점이
//    바로 여기다 — 남과의 서열(수행목표)은 못하는 아이를 더 물러나게 하고, 숙달목표는 그렇지 않다.
//    오르답에는 이미 남과 겨루는 축(오늘의 등수판)이 있으므로, 이 축은 **오직 나**만 본다.
//
// 🔴 칸이 10개뿐이다 — 구구단 2~9단(8) + 영단어 밴드(2). 문항 하나하나를 추적하지 않는다.
//    그건 오답노트(SRS)의 일이고, 여기는 «보여 주기» 위한 굵은 눈금이다. 둘을 합치면
//    저장이 커지고 화면은 오히려 못 읽게 된다.
//
// 🔴 저장은 «최근에 무게»를 준다. 처음 배울 때 틀린 것이 영원히 백분율을 눌러 앉으면
//    아이가 나아져도 막대가 안 움직인다 — 그러면 이 축은 거짓말을 하는 셈이 된다.

import { WEEKLY } from './balance.js';

import { isWordSubject, SUBJECTS } from './questions.js';

/** 한 칸의 최대 표본. 넘으면 오래된 만큼을 비례로 줄인다(최근 실력이 보이게). */
export const MASTERY_WINDOW = 60;

/**
 * 문항 id 를 숙련도 칸 키로. 모르는 모양이면 null(조용히 버린다).
 * 🔴 id 모양은 questions.js:51,62 가 정본이다 — 구구단 `g:7x8` · 영단어 `w:words34:apple:w2k`.
 *    느슨한 정규식(`숫자x숫자` 아무 데나)을 쓰지 않는다: 영단어 id 에 숫자가 섞인 낱말이
 *    들어오면 구구단 칸으로 새어 들어간다. 모양이 바뀌면 여기서 **조용히 null 이 되어야** 하고,
 *    그건 D-게이트가 「숙련도가 한 칸도 안 쌓인다」로 잡는다.
 */
export function bucketOf(subject, id) {
  const s = String(id || '');
  if (subject === 'gugudan') {
    const m = s.match(/^gm?:(\d+)x\d+$/);   // gm = 거울 계단(같은 단으로 센다)
    return m ? `gugudan:${m[1]}` : null;
  }
  // 🔴 낱말 과목 목록을 여기 다시 적지 않는다 — questions.POOLS 가 정본이다.
  //    적어 두면 과목이 늘 때 이 줄을 빠뜨려 숙련도만 조용히 안 쌓인다(화면엔 「아직」으로 보여
  //    고장인지 표본 부족인지 구분이 안 간다 — 가장 늦게 발견되는 종류의 결함).
  if (isWordSubject(subject)) {
    return s.startsWith(`w:${subject}:`) ? subject : null;
  }
  return null;
}

/**
 * 한 판의 결과를 숙련도에 더한다. 원본을 건드리지 않는다.
 * @param {object} mastery 저장된 { [key]: {c, a} }
 * @param {string} subject
 * @param {{id:string, ok:boolean}[]} answers 이번 판에 «판정된» 문항들
 */
export function applyAnswers(mastery, subject, answers) {
  const next = { ...(mastery || {}) };
  for (const ans of answers || []) {
    const key = bucketOf(subject, ans && ans.id);
    if (!key) continue;
    const cur = next[key] || { c: 0, a: 0 };
    let c = cur.c + (ans.ok ? 1 : 0);
    let a = cur.a + 1;
    // 🔴 창을 넘으면 «비율을 유지한 채» 줄인다. 잘라 버리면 방금 맞힌 것만 남아 100% 가 된다.
    if (a > MASTERY_WINDOW) {
      const k = MASTERY_WINDOW / a;
      c = Math.round(c * k);
      a = MASTERY_WINDOW;
    }
    next[key] = { c, a };
  }
  return next;
}

/**
 * 한 판의 `stats.perId`(문항별 {asked, correct})를 그대로 받는다.
 * 🔴 코어가 이미 세고 있는 것을 «다시 세지» 않는다 — 같은 사실을 두 곳에서 세면 반드시 어긋난다.
 *    (게임 코어에 answers 배열을 새로 달지 않은 이유. game.js:269 _track 이 정본이다.)
 */
export function applyPerId(mastery, subject, perId) {
  const list = [];
  for (const [id, rec] of Object.entries(perId || {})) {
    const asked = Number(rec && rec.asked) || 0;
    const correct = Number(rec && rec.correct) || 0;
    for (let i = 0; i < asked; i += 1) list.push({ id, ok: i < correct });
  }
  return applyAnswers(mastery, subject, list);
}

/**
 * 칸 하나의 백분율. 표본이 적으면 «아직 모른다»를 정직하게 말한다.
 * 🔴 3문제 풀고 100% 라고 적어 주면 그건 칭찬이 아니라 오보다.
 */
export function percentOf(mastery, key, minSample = 5) {
  const m = (mastery || {})[key];
  if (!m || !m.a || m.a < minSample) return null;
  return Math.round((m.c / m.a) * 100);
}

/** 화면에 그릴 목록. 표본이 없는 칸도 «아직»으로 남겨 둔다(빈 칸이 자이가르닉 효과를 만든다). */
export function masteryList(mastery, subject) {
  if (subject === 'gugudan') {
    return [2, 3, 4, 5, 6, 7, 8, 9].map((d) => ({
      key: `gugudan:${d}`, label: `${d}단`, pct: percentOf(mastery, `gugudan:${d}`),
    }));
  }
  const label = (SUBJECTS[subject] && SUBJECTS[subject].label) || subject;
  return [{ key: subject, label, pct: percentOf(mastery, subject) }];
}

/** 가장 약한 칸 — 결과 화면이 가리킬 한 곳. 전부 모르면 null. */
export function weakest(mastery, subject) {
  const known = masteryList(mastery, subject).filter((x) => x.pct !== null);
  if (!known.length) return null;
  return known.reduce((lo, x) => (x.pct < lo.pct ? x : lo));
}

// ── 이번 주 도장 ────────────────────────────────────────────────
//
// 🔴 «연속»이 아니라 «누적»이다. 하루 빠져도 앞의 도장이 사라지지 않는다.
//    조사가 공통으로 경고한 것이 「깨지면 0이 되는 연속 출석」이고, 그게 저학년에게
//    좌절과 앱 삭제를 만든다. 그래서 세는 것은 «연속 일수»가 아니라 «이번 주 몇 칸».

/** 그 시각이 속한 주의 월요일 키(YYYY-MM-DD). 주의 경계를 한 곳에서만 정한다. */
export function weekKey(ts) {
  const d = new Date(ts);
  const dow = (d.getDay() + 6) % 7;              // 월=0
  d.setDate(d.getDate() - dow);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 오늘 논 것을 이번 주 도장에 찍는다.
 * 🔴 주가 바뀌면 «도장만» 비운다. 해금(claimed)은 영구다 — 지난주에 받은 것을 뺏지 않는다.
 * @returns {{week:object, unlocked:boolean}} unlocked = 이번에 새로 열렸는가
 */
export function stampToday(week, ts) {
  const wk = weekKey(ts);
  const dow = (new Date(ts).getDay() + 6) % 7;
  const prev = (week && week.week === wk) ? week : { week: wk, days: [], claimed: !!(week && week.claimed) };
  const days = prev.days.includes(dow) ? prev.days : [...prev.days, dow].sort((a, b) => a - b);
  const reached = days.length >= WEEKLY.GOAL_DAYS;
  // claimed 는 «한 번이라도 받았는가»다. 주가 바뀌어도 유지된다.
  const claimed = prev.claimed || reached;
  return {
    week: { week: wk, days, claimed },
    unlocked: reached && !prev.claimed,
  };
}

/** 화면용 — 이번 주 7칸과 달성 여부 */
export function weekView(week, ts) {
  const wk = weekKey(ts);
  const days = (week && week.week === wk) ? (week.days || []) : [];
  return {
    marks: [0, 1, 2, 3, 4, 5, 6].map((d) => days.includes(d)),
    count: days.length,
    goal: WEEKLY.GOAL_DAYS,
    done: days.length >= WEEKLY.GOAL_DAYS,
    everClaimed: !!(week && week.claimed),
  };
}
