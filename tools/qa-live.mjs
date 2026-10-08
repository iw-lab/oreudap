#!/usr/bin/env node
// 배포된 URL 실측 — 「배포됐다」와 「거기서 돌아간다」는 다른 명제다.
import { chromium } from 'playwright';

const TARGET = process.argv[2];
if (!TARGET) { console.error('사용법: node tools/qa-live.mjs <url>'); process.exit(2); }

const fails = [];
const notes = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ko-KR' });
const page = await ctx.newPage();
const errors = [];
const external = [];
const origin = new URL(TARGET).origin;
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('request', (r) => {
  const u = r.url();
  // 🔴 바깥으로 나가도 되는 곳은 «등수 API» 하나뿐이다(D21). 나머지는 전부 외부로 센다.
  //    실명이 실리지 않는지는 D29 가 따로 잰다(tools/qa-play.mjs).
  const RANK = 'https://oreudap-rank.simssijjang-a04.workers.dev/api/rank';
  const allowed = u.startsWith(origin) || u.startsWith(`blob:${origin}`) || u.startsWith('data:') || u.startsWith(RANK);
  if (!allowed) external.push(`${r.method()} ${u}`);
});

const t0 = Date.now();
await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(async () => {
  const t = Date.now();
  while (!window.__SMOKE__ && Date.now() - t < 25000) await new Promise((r) => setTimeout(r, 50));
  await window.__SMOKE__.ready;
    // 첫 판 안내(D35)는 판을 멈춰 세운다 — 실측 봇은 «이미 놀아 본 아이»다.
    window.__SMOKE__.app.data.seenHow = true;
});
notes.push(`부팅 ${Date.now() - t0}ms`);

// 실제로 한 판 논다 — 실제 클릭으로
await page.click('.subject-card >> nth=0');
await page.click('#scope-start');
await page.waitForFunction(() => window.__SMOKE__.app.core && window.__SMOKE__.app.core.phase === 'question', null, { timeout: 15000 });
let correct = 0;
const WANT = 10;
for (let i = 0; i < 60 && correct < WANT; i++) {
  const s = await page.evaluate(() => {
    const c = window.__SMOKE__.app.core;
    return { phase: c.phase, ans: c.question ? c.question.answerIndex : -1, floor: c.floor, hearts: c.hearts };
  });
  if (s.phase !== 'question') { await page.waitForTimeout(200); continue; }
  const t = await page.evaluate((idx) => {
    const c = document.querySelectorAll('.choice')[idx];
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, s.ans);
  if (!t) break;
  await page.waitForTimeout(280);
  await page.mouse.click(t.x, t.y);
  correct += 1;
  await page.waitForTimeout(120);
}
const final = await page.evaluate(() => ({ floor: window.__SMOKE__.app.core.floor, qa: window.__SMOKE__.qa() }));
notes.push(`실제 클릭 ${correct}회 → ${final.floor}층 · 오디오 ${final.qa.audio.decoded}/${final.qa.audio.expected} · 좀비트윈 ${final.qa.zombieTweens}`);

await page.screenshot({ path: 'qa/live.png' });

// 🔴 판정은 «정답 1회 = 1층»이다. 절대 층수로 문턱을 잡으면 게이트가 틀린 것을 재게 된다.
if (correct < WANT) fails.push(`정답 클릭 ${correct}회 < ${WANT} — 표본 부족(측정 무효)`);
if (final.floor !== correct) fails.push(`정답 ${correct}회인데 ${final.floor}층 — 정답 1회당 정확히 1층이어야 한다`);
if (final.qa.audio.decoded < final.qa.audio.expected) fails.push(`오디오 ${final.qa.audio.expected - final.qa.audio.decoded}개 미디코드`);
if (final.qa.loadErrors.length) fails.push(`에셋 로드 실패: ${final.qa.loadErrors.join(', ')}`);
if (external.length) fails.push(`외부 도메인 요청 ${external.length}건: ${external.slice(0, 3).join(' | ')}`);
if (errors.length) fails.push(`콘솔 오류 ${errors.length}건: ${errors.slice(0, 3).join(' | ')}`);

// ── D36: 이 봇의 기록이 아이들 등수판에 올라가지 않았는가 ────────────────
// 🔴 게이트가 실서버를 재는 이상 봇의 기록도 실서버로 나간다. 나가는 건 맞다(D29 는 «실제로 나간
//    바이트»를 검사해야 뜻이 있다) — 다만 아이들이 보는 판에 섞이면 안 된다. 서버가 그 줄을
//    «시험 칸»으로 보내는지는 여기서만 진짜로 확인된다(로컬 게이트는 흉내 낸 KV 로 잰다).
// 🔴 검사가 뜻을 가지려면 «실제로 제출이 나가야» 한다. 여기까지는 정답만 눌렀을 뿐
//    정산(showResult)에 닿지 않았으므로 제출이 0건이다 — 그 상태로 판을 보면 언제나 «깨끗»하다.
//    2026-09-05 에 실제로 그 헛검사가 PASS 를 찍었다. 그래서 판을 끝내고 제출을 만든다.
const settle = await page.evaluate(async () => {
  const app = window.__SMOKE__.app;
  try { localStorage.removeItem('oreudap:sent'); } catch { /* 무시 */ }
  const nick = (() => { try { return localStorage.getItem('oreudap:nick'); } catch { return null; } })();
  const floor = app.core ? app.core.floor : 0;
  app.quitRun();
  await new Promise((r) => setTimeout(r, 2500));
  return { nick, floor, settled: app.settled };
}).catch(() => null);
await browser.close();

if (!settle || !settle.nick || !settle.settled || !(settle.floor > 0)) {
  fails.push(`등수 제출이 만들어지지 않았다(측정 무효) — ${JSON.stringify(settle)}`);
} else {
  const { nick, floor } = settle;
  // 🔴 KV 목록 조회는 방금 쓴 줄을 30~60초쯤 뒤에야 보여 준다. 곧바로 «없다»를 결론으로 삼으면
  //    워커가 옛 버전이어도 통과해 버린다. 보일 때까지 기다렸다가 판정한다.
  const API = 'https://oreudap-rank.simssijjang-a04.workers.dev/api/rank?n=50';
  let found = null; let total = 0;
  for (let i = 0; i < 15; i += 1) {                 // 최대 약 90초
    try {
      const board = await fetch(API).then((r) => r.json());
      total = board.total || 0;
      const mine = (board.rows || []).filter((r) => r.n === nick);
      if (mine.length) { found = mine; break; }
    } catch { /* 다음 회차에 다시 */ }
    await new Promise((r) => setTimeout(r, 6000));
  }
  if (found) {
    fails.push(`봇 기록이 오늘 판에 올라갔다: ${nick} ${found.map((r) => r.s + '층').join(', ')} — 워커가 아직 옛 버전이다 (bash tools/finish-rank-ops.sh)`);
  } else {
    notes.push(`등수판 청결 OK — ${nick} ${floor}층을 제출했는데 90초를 기다려도 오늘 판(${total}줄)에 안 뜬다`);
  }
}
console.log(`\n── 배포 실측 (${TARGET}) ──`);
for (const n of notes) console.log('  · ' + n);
if (fails.length) { console.log('\n❌ 배포 실측 FAIL'); for (const f of fails) console.log('  ✖ ' + f); process.exit(1); }
console.log('\n✅ 배포 실측 PASS — 실제 URL 에서 플레이된다');
