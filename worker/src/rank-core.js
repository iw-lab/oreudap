// 일일 등수의 «순수한 부분» — Durable Object 바깥에서 테스트할 수 있게 떼어 놓는다.
// 🔴 판정은 전부 여기 있다. rank.js 는 저장소 배선만 한다.

export const KEEP = 50;              // 오늘 판에 남기는 줄 수
export const YDAY_KEEP = 3;          // 어제 상위 몇 줄을 기념으로 남길지
export const MAX_FLOOR = 500;        // 완벽 플레이 중앙값이 200층이다 — 그 배를 상한으로 둔다
export const NICK_CAP = 12;
export const SUBJECT_IDS = ['gugudan', 'words34', 'words56'];
export const MODE_IDS = ['classic', 'thrill', 'sprint'];
// 🔴 표는 «같은 규칙끼리»만 줄 세워야 뜻이 있다. 60초 질주 55층과 무한 78층을 한 표에 넣으면
//    등수가 실력이 아니라 모드 선택을 재게 된다. 그래서 과목이 아니라 «과목:모드» 가 표의 단위다.
//    옛 클라이언트가 보내는 모드 없는 값은 클래식으로 읽는다(호환).
export const SUBJECTS = SUBJECT_IDS.flatMap((s) => MODE_IDS.map((m) => `${s}:${m}`));

/**
 * «과목» 과 «모드» 를 표의 키 하나로 합친다.
 * 🔴 두 필드를 따로 받는 이유는 배포 순서다. 클라이언트가 `sub:'words56:sprint'` 를 보내면
 *    아직 옛 워커가 돌고 있는 동안 그 값이 화이트리스트에 없어 SUBJECTS[0](구구단)으로 떨어진다 —
 *    즉 영단어 기록이 구구단 표에 실린다. 필드를 나눠 두면 옛 워커는 mode 를 무시하고
 *    과목만 제대로 쓰므로, 클라이언트를 먼저 배포해도 아무것도 망가지지 않는다.
 */
export function normSub(v, mode) {
  const raw = typeof v === 'string' ? v : '';
  const [subject, inlineMode] = raw.split(':');
  const sub = SUBJECT_IDS.includes(subject) ? subject : SUBJECT_IDS[0];
  const m = typeof mode === 'string' && MODE_IDS.includes(mode) ? mode
    : (MODE_IDS.includes(inlineMode) ? inlineMode : 'classic');
  return `${sub}:${m}`;
}

/** 한국 날짜(UTC+9). Workers 의 시계는 UTC 라 그냥 자르면 **아침 9시에 날이 바뀐다.** */
export function kstDay(ms = Date.now()) {
  return new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
}

/**
 * 🔴 이름 수용 규칙 — 이 게이트가 «실명이 서버에 남지 않는다»를 실제로 집행한다.
 *    오르답은 싱글 플레이라 서버가 원래 이름을 알 이유가 전혀 없다.
 *    그래서 기기가 가려서 보내고, 서버는 «가려지지 않은 직접 이름»을 받지 않는다.
 *    - 자동 생성 이름(빠른여우07)  → 그대로 받는다. 3만 가지 중 하나이고 사람을 안 가리킨다.
 *    - 직접 지은 이름            → 반드시 별표가 있어야 받는다(김*수). 없으면 거부.
 */
export function acceptName(n, isGenerated) {
  if (typeof n !== 'string') return null;
  const s = n.normalize('NFC').slice(0, NICK_CAP);
  if (!s) return null;
  if (!/^[가-힣a-zA-Z0-9*]+$/.test(s)) return null;    // 낱자·공백·특수문자 차단
  if (isGenerated(s)) return s;
  if (!s.includes('*')) return null;                   // 가려지지 않은 직접 이름은 받지 않는다
  if (s.replace(/\*/g, '').length < 1) return null;    // 별표만 있는 이름
  return s;
}

/** 들어온 줄 하나를 «저장해도 되는 모양»으로. 못 쓰면 null. */
export function clean(r, isGenerated) {
  const n = acceptName(r && r.n, isGenerated);
  const raw = r && r.s;   // 객체는 Number() 에서 던질 수 있다 → 숫자·문자열만(2026-10-08 교차검증 codex)
  const s = typeof raw === 'number' || typeof raw === 'string' ? Math.round(Number(raw) || 0) : 0;
  if (!n || !(s > 0) || s > MAX_FLOOR) return null;
  const sub = normSub(r && r.sub, r && r.m);
  return { n, s, sub };
}

/**
 * 봇이 보낸 줄인가. 클라이언트가 `t:1` 을 붙여 스스로 밝힌다(navigator.webdriver).
 * 🔴 이건 «부정 방지»가 아니라 «판 청소»다 — 속이려는 사람은 이 값을 빼면 그만이고, 그래도 아무 이득이 없다.
 *    막으려는 건 악의가 아니라 우리 게이트가 매일 아이들 판에 쌓아 놓는 봇 기록이다.
 */
export function isTestRow(r) { return !!(r && (r.t === 1 || r.t === true)); }

/** 봇의 줄은 같은 구조 그대로 «다른 날짜 칸»에 넣는다.
 *  쓰기·목록 조회·등수 계산이 전부 똑같이 도므로 게이트가 재는 경로는 하나도 줄지 않는다.
 *  다만 topRows 는 언제나 진짜 날짜만 읽으므로 아이들 판에는 섞이지 않는다. */
export function dayFor(day, test) { return test ? `t-${day}` : day; }

/**
 * 한 줄이 저장되는 키. 🔴 **점수까지 키에 넣는다** — 이 파일에서 가장 중요한 줄이다.
 *
 * 「판 전체가 아니라 줄 하나」까지만 갔을 때도 여전히 틀렸다. 같은 아이가 다시 제출할 때
 * «내 줄을 읽어 더 높으면 쓴다»를 하면, KV 의 늦은 읽기가 옛 점수를 줘서 30층이 20층으로
 * 내려앉는다(테스트로 재현했다). 점수가 키의 일부면 서로 다른 기록은 서로 다른 키라서
 * **덮어쓰기 자체가 일어나지 않는다** — 쓰기 전에 읽을 일도 없다. 최고 기록은 dedupe 가 고른다.
 *
 * 이름에는 `:` 가 들어올 수 없다(acceptName 이 한글·영숫자·별표만 통과시킨다).
 * 점수는 0 채움 4자리 — 키 정렬이 곧 점수 정렬이 되어 눈으로 훑기 쉽다.
 */
export function rowKey(day, sub, n, s) {
  return `r:${day}:${sub}:${n}:${String(Math.round(s)).padStart(4, '0')}`;
}

/** 키에서 날짜를 되꺼낸다(목록 조회용 접두사와 짝) */
export function dayPrefix(day) { return `r:${day}:`; }

/** 날이 바뀌었으면 오늘 판을 비우고 «어제 상위»만 남긴다. */
export function rollover(b, day) {
  if (b && b.day === day) return b;
  return { day, rows: [], yday: b ? { day: b.day, rows: (b.rows || []).slice(0, YDAY_KEEP) } : null };
}

/** 판 + 새 줄 → 새 판. 원본을 건드리지 않는다.
 *  🔴 같은 이름은 «최고 기록 한 줄»만 남긴다 — 한 아이가 열 판 하면 판이 그 아이로 도배된다. */
export function merge(board, row, day, isGenerated) {
  const b = rollover(board, day);
  const add = clean(row, isGenerated);
  return add ? { ...b, rows: dedupe([...b.rows, add]) } : b;
}

/** 이름별 최고 기록만 남기고 내림차순 정렬 */
export function dedupe(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = `${r.n}|${r.sub}`;
    const cur = best.get(k);
    if (!cur || r.s > cur.s) best.set(k, r);
  }
  return [...best.values()].sort((x, y) => y.s - x.s).slice(0, KEEP);
}

/** 내 기록이 오늘 판에서 몇 등인가(1부터). 판 밖이면 null. */
export function rankOf(rows, score) {
  if (!(score > 0)) return null;
  const better = rows.filter((r) => r.s > score).length;
  return better + 1;
}

/**
 * 🔴 «내 표 안에서» 몇 등이고 몇 명인가. 2026-09-05 교차검증이 잡은 결함 두 개를 한꺼번에 막는다.
 *
 * ① 과목을 섞어 세면 안 된다. 표의 단위는 «과목:모드» 인데(위 SUBJECTS 주석) 등수만 판 전체에서
 *    셌다. 영단어를 처음 하는 아이가 혼자인데도 「2등 · 2명」을 들었다 — 구구단 점수가 등수에
 *    들어왔기 때문이다. 재현: 구구단 100층 한 명 + 영단어 10층 제출 → rank 2, total 2.
 * ② 등수는 «내 최고»로 매긴다. 다른 기기에서 낮은 점수를 다시 내면 dedupe 는 최고 기록을 남기는데
 *    등수는 방금 낸 낮은 점수로 셌다 — 「3등 · 2명」 같은 있을 수 없는 값이 나왔다.
 *    재현: 졸린오리58 30층·명랑한여우54 25층 상태에서 졸린오리58 이 20층 제출 → rank 3, total 2.
 */
export function rankIn(rows, sub, nick, score) {
  const mine = rows.filter((r) => r.sub === sub);
  const best = mine.find((r) => r.n === nick);
  return { rank: rankOf(mine, best ? best.s : score), total: mine.length };
}
