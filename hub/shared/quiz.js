import { createRng } from './rng.js';
import { WORDS } from './data/words.js';
// 꿀꺽 행성 quiz.js(2026-10-09)에서 옮겼다 — 경기권 문제 묶음 전용(허브가 출제·채점, 브라우저는 보여주기만).

// 문항은 코드가 «생성»한다(데이터 손입력 아님). 같은 시드 → 같은 문항 → 리플레이·서버 재계산 결정론.
// 🔴 카드가 열려 있는 동안 «보자마자 아는» 범위만 낸다 — 학습 10% 의 목적은 유창성 유지이지 새 개념 학습이 아니다.

// 🔴 정답 위치 «덱» — 위치 0·1·2 를 «한 장씩» 넣고 셔플해 뽑는다.
//    더 나은 셔플이 아니라 «구조»로 균등을 보장한다(SKILL 절대규칙 ⑨ · L-109).
//    ⚠️ 2장씩 넣은 6장 덱에서 앞 3장만 쓰면 «각 위치 1회»가 되는 확률이 40% 뿐이라
//       판 단위 균등이 깨진다(교차검증 지적 — 총합만 균등해 게이트는 통과했었다).
function makePositionDeck(rnd) {
  const deck = [0, 1, 2];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 🔵 2026-10-11 다시 짰다 — 이 문제는 «게임 도중 1~2초 암산»(꿀꺽 행성 원본)이 아니라 «노래 전에 차분히 푸는 관문»이다.
//    예전 판은 5학년에 «82−44»(2학년 내용)가, 6학년에 «900÷3» 같은 쉬운 연산만 나왔다(사용자 「학년별 세팅 제대로 한 거 맞아?」).
//    학년마다 교육과정 연산 범위를 따른다: 1 한 자리 덧뺄셈·(십몇)−(몇) / 2 받아올림·내림 두 자리·곱셈구구 /
//    3 세 자리 덧뺄셈·(두 자리)×(한 자리)·나눗셈 / 4 곱셈·나눗셈·같은 분모 분수·소수 덧뺄셈 /
//    5 혼합계산·다른 분모 분수 덧셈·분수×자연수·소수×자연수 / 6 분수÷자연수·소수÷자연수·비율·비례식.
//    🔴 오답은 «아이들이 실제로 하는 실수»로 만든다(받아내림 빠뜨림·분자분모 따로 더함·자릿수 착각) — |정답−b| 같은 엉뚱한 수 금지.
const gcd = (x, y) => (y ? gcd(y, x % y) : Math.abs(x));
const frac = (n, d) => { const g = gcd(n, d); n /= g; d /= g; return d === 1 ? String(n) : `${n}/${d}`; };
const dec = (x) => String(Math.round(x * 100) / 100);
function mathQ(rnd, grade) {
  const R = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let text, ans, wrongs = [];
  const r = rnd();
  if (grade === 1) {
    if (r < 0.4) { const a = R(3, 9), b = R(3, 9); text = `${a} + ${b} = ?`; ans = a + b; wrongs = [ans - 1, ans + 1, ans + 10 > 20 ? ans - 2 : ans + 2]; }
    else if (r < 0.75) { const a = R(11, 18), b = R(2, 9); text = `${a} − ${b} = ?`; ans = a - b; wrongs = [ans + 1, ans - 1, a - 10 + b]; }
    else { const a = R(2, 8) * 10 + R(1, 4), b = R(1, 5); text = `${a} + ${b} = ?`; ans = a + b; wrongs = [ans + 10, ans - 1, ans + 1]; }
  } else if (grade === 2) {
    if (r < 0.35) {   // 받아올림 있는 두 자리 덧셈
      let a, b; do { a = R(15, 79); b = R(15, 89 - a + 10); } while ((a % 10) + (b % 10) < 10 || a + b > 99);
      text = `${a} + ${b} = ?`; ans = a + b; wrongs = [ans - 10, ans + 10, ans + 1];
    } else if (r < 0.7) {   // 받아내림 있는 두 자리 뺄셈 — 흔한 실수: 일의 자리를 «큰 수−작은 수»로
      let a, b; do { a = R(31, 98); b = R(12, a - 5); } while ((a % 10) >= (b % 10));
      text = `${a} − ${b} = ?`; ans = a - b;
      const slip = (Math.floor(a / 10) - Math.floor(b / 10)) * 10 + ((b % 10) - (a % 10));
      wrongs = [slip, ans + 10, ans - 1];
    } else { const a = R(2, 9), b = R(2, 9); text = `${a} × ${b} = ?`; ans = a * b; wrongs = [a * (b + 1), a * (b - 1) || ans + a, ans + 1]; }
  } else if (grade === 3) {
    if (r < 0.35) { const a = R(120, 680), b = R(110, 300); const add = rnd() < 0.5;
      if (add) { text = `${a} + ${b} = ?`; ans = a + b; wrongs = [ans + 100, ans - 10, ans + 10]; }
      else { const big = Math.max(a, b) + 200, sm = Math.min(a, b); text = `${big} − ${sm} = ?`; ans = big - sm; wrongs = [ans - 100, ans + 10, ans - 10]; } }
    else if (r < 0.7) { const a = R(12, 49), b = R(3, 9); text = `${a} × ${b} = ?`; ans = a * b; wrongs = [(Math.floor(a / 10) * b) * 10 + (a % 10) * b % 10, ans + b, ans - 10]; }
    else { const b = R(3, 9), q = R(11, 25); const a = b * q; text = `${a} ÷ ${b} = ?`; ans = q; wrongs = [q + 1, q - 1, q + 10]; }
  } else if (grade === 4) {
    if (r < 0.3) { const a = R(12, 45) * 10, b = R(2, 9) * 10; text = `${a} × ${b} = ?`; ans = a * b; wrongs = [ans / 10, ans * 10, ans + a]; }
    else if (r < 0.55) { const b = R(12, 25), q = R(12, 39); const a = b * q; text = `${a} ÷ ${b} = ?`; ans = q; wrongs = [q + 1, q - 1, q + 10]; }
    else if (r < 0.8) { const d = pick([5, 6, 7, 8, 9, 10, 11, 12]); const x = R(1, d - 2), y = R(1, d - 1 - x);
      text = `${x}/${d} + ${y}/${d} = ?`; ans = `${x + y}/${d}`; wrongs = [`${x + y}/${d * 2}`, `${x + y + 1}/${d}`, `${Math.abs(x - y) || x + y + 2}/${d}`]; }
    else { const a = R(11, 59) / 10, b = R(11, 39) / 10; text = `${dec(a)} + ${dec(b)} = ?`; ans = dec(a + b); wrongs = [dec(a + b + 1), dec(a + b - 0.1), dec(a + b + 0.1)]; }
  } else if (grade === 5) {
    if (r < 0.25) { const a = R(5, 30), b = R(2, 9), c = R(2, 9); text = `${a} + ${b} × ${c} = ?`; ans = a + b * c; wrongs = [(a + b) * c, ans + 1, ans - b]; }
    else if (r < 0.55) { const [d1, d2] = pick([[2, 3], [2, 5], [3, 4], [2, 7], [3, 5], [4, 5], [3, 8], [5, 6]]); const n1 = R(1, d1 - 1), n2 = R(1, d2 - 1);
      text = `${n1}/${d1} + ${n2}/${d2} = ?`; ans = frac(n1 * d2 + n2 * d1, d1 * d2); wrongs = [`${n1 + n2}/${d1 + d2}`, `${n1 + n2}/${d1 * d2}`, frac(n1 * d2 + n2 * d1 + 1, d1 * d2)]; }
    else if (r < 0.8) { const d = pick([3, 4, 5, 6, 8]), n = R(1, d - 1), k = d * R(1, 3); text = `${n}/${d} × ${k} = ?`; ans = frac(n * k, d); wrongs = [frac(n * k, d * k), frac(n + k, d), frac(n * k + d, d)]; }
    else { const a = R(2, 9) / 10, b = R(3, 9); text = `${dec(a)} × ${b} = ?`; ans = dec(a * b); wrongs = [dec(a * b * 10), dec(a * b / 10), dec(a * b + 0.1)]; }
  } else {
    if (r < 0.3) { const d = pick([3, 4, 5, 7, 9]), k = R(2, 4), n = k * R(1, Math.floor((d - 1) / 1)); const nn = Math.min(n, d * 2);
      text = `${nn}/${d} ÷ ${k} = ?`; ans = frac(nn, d * k); wrongs = [frac(nn * k, d), frac(nn, d + k), frac(nn + k, d * k)]; }
    else if (r < 0.55) { const b = R(2, 6), q = R(11, 49) / 10; const a = Math.round(q * b * 10) / 10; text = `${dec(a)} ÷ ${b} = ?`; ans = dec(q); wrongs = [dec(q * 10), dec(q + 0.1), dec(q / 10)]; }
    else if (r < 0.8) { const tot = pick([20, 25, 40, 50, 200]); const part = tot * pick([0.1, 0.2, 0.25, 0.4, 0.5, 0.6, 0.75]); text = `${tot}개 중 ${part}개는 몇 %?`; ans = `${Math.round(part / tot * 100)}%`;
      wrongs = [`${part}%`, `${Math.round(part / tot * 100) + 5}%`, `${Math.round(100 - part / tot * 100)}%`]; }
    else { const a = R(2, 5), b = R(a + 1, 9), k = R(2, 6); text = `${a} : ${b} = ${a * k} : □`; ans = b * k; wrongs = [b + k, a * k + (b - a), b * k + 1]; }
  }
  text = text.replace(/\s+$/, '');
  const A = String(ans);
  const ws = [...new Set(wrongs.map(String))].filter((w) => w !== A && !/^-|NaN|Infinity|^0$|^0\/|\/0$/.test(w));
  for (let k = 1; ws.length < 2; k++) { const w = /^\d+$/.test(A) ? String(Number(A) + k + 1) : `${A}`; if (w !== A && !ws.includes(w)) ws.push(w); else break; }
  // 3지선다(정답 위치 덱 0·1·2) — 오답 후보를 섞어 둘
  for (let i = ws.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ws[i], ws[j]] = [ws[j], ws[i]]; }
  return { text, answer: A, wrong: ws.slice(0, 2) };
}

function engQ(rnd, grade) {
  const list = WORDS[String(Math.min(6, Math.max(3, grade)))] || WORDS['3'];
  const i = Math.floor(rnd() * list.length);
  const [ko, en] = list[i];
  const wrong = [];
  while (wrong.length < 2) {
    const j = Math.floor(rnd() * list.length);
    if (j !== i && list[j][1][0] !== en[0] && !wrong.includes(list[j][1])) wrong.push(list[j][1]);
  }
  return { text: `${ko} → ?`, answer: en, wrong };
}

// 한 판(시드)의 문항 전체를 통째로 만든다. 서버·클라·프로브가 같은 결과를 얻는다.
// 🔴 count 기본값을 숫자로 적으면 QUIZ_AT 을 늘렸을 때 «호출부 N 곳 중 M 곳만» 갱신된다.
//    (실제로 QUIZ_AT 을 3→6 으로 늘리자 서버·프로브·테스트가 3문항만 만들어 4~6번 카드가
//     빈 문항이 될 뻔했다.) 개수의 진실원은 QUIZ_AT 하나다.
export function makeQuestions(seed, { subject = 'math', grade = 2, count = 5 } = {}) {
  grade = Math.max(1, Math.min(6, Math.round(Number(grade) || 2)));   // 3.5 같은 값이 오면 WORDS[3.5] 로 죽는다
  count = Math.max(1, Math.min(8, count | 0));
  // 🔴 정답 «위치»가 시드만으로 정해지면, 문항을 하나도 모르는 사람이 위치만 재현해
  //    전부 맞힐 수 있다 — 서버가 «직접 채점»해도 소용이 없다(실측: eng/5 답을 math/2 로
  //    채점해도 6/6 이 나왔다). 과목·학년을 스트림에 섞어 판마다 위치가 달라지게 한다.
  const salt = (0x51A7 * 0x9E3779B1) ^ (grade * 0x85EBCA6B) ^ (subject === 'eng' ? 0xC2B2AE35 : 0x27D4EB2F);
  const R = createRng((seed ^ salt) >>> 0), rnd = R.next;
  const deck = makePositionDeck(rnd);
  const out = [];
  for (let i = 0; i < count; i++) {
    const q = subject === 'eng' ? engQ(rnd, grade) : mathQ(rnd, grade);
    const pos = deck[i % deck.length];
    const choices = [...q.wrong];
    choices.splice(pos, 0, q.answer);
    out.push({ text: q.text, choices, answer: pos, subject, grade });
  }
  return out;
}
