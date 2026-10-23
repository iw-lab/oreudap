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
  // 🔴 v2: 바깥으로 나가는 곳 0 — 학교 허브는 같은 오리진 중계(/api/hub)다. 옛 개인 등수 API 도 이제 «외부»로 센다(D49).
  // 학교 허브 워커 직결(59a3108 · src/app.js configureHub direct) — 우리 서버다. 학교별 합계·기기 해시만 오간다.
  const OWN_HUB = 'https://oreudap-hub.markmoim-sync.workers.dev/';
  const allowed = u.startsWith(origin) || u.startsWith(`blob:${origin}`) || u.startsWith('data:') || u.startsWith(OWN_HUB);
  if (!allowed || /oreudap-rank|\/api\/rank/.test(u)) external.push(`${r.method()} ${u}`);
});

const t0 = Date.now();
await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
await page.evaluate(async () => {
  const t = Date.now();
  while (!window.__SMOKE__ && Date.now() - t < 25000) await new Promise((r) => setTimeout(r, 50));
  await window.__SMOKE__.ready;
    // 첫 판 안내(D35)는 판을 멈춰 세운다 — 실측 봇은 «이미 놀아 본 아이»다.
    window.__SMOKE__.app.data.seenHow = true;
    // 🔴 실서버 허브 — 새 기기면 시작 때 «학교 정하기»가 뜬다. 봇은 학교를 고르지 않는다(실제 학교 점수를 더럽히지 않게)
    try { localStorage.setItem('oreudap.hub.v1', JSON.stringify({ noSchool: true })); } catch { /* */ }
});
notes.push(`부팅 ${Date.now() - t0}ms`);

// 실제로 한 판 논다 — 실제 클릭으로
await page.click('.subject-chip >> nth=0');
await page.click('#btn-play');
await page.waitForFunction(() => window.__SMOKE__.app.core && window.__SMOKE__.app.core.phase === 'question', null, { timeout: 15000 });
let correct = 0, raced = 0;
const badClicks = [];
const WANT = 10;
for (let i = 0; i < 60 && correct < WANT; i++) {
  const s = await page.evaluate(() => {
    const c = window.__SMOKE__.app.core;
    return { phase: c.phase, answered: c.answered, qid: c.question && c.question.id, ans: c.question ? c.question.answerIndex : -1, floor: c.floor, hearts: c.hearts };
  });
  // 답할 수 있을 때만 누른다(문항 phase 인데 이미 판정된 순간에 누르면 «무시된 클릭»을 정답으로 세어 거짓 FAIL — 2026-10-13 부하 중 9/10)
  if (s.phase !== 'question' || s.answered) { await page.waitForTimeout(200); continue; }
  const t = await page.evaluate((idx) => {
    const c = document.querySelectorAll('.choice')[idx];
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, s.ans);
  if (!t) break;
  await page.waitForTimeout(280);
  // 🔴 클릭 «직전» 상태를 다시 잰다 — 호스트 부하(load 50+)로 프레임이 250ms 상한에 걸리면 첫 문항 2.6초가 클릭 전에
  //    시간초과로 끝난다(2026-10-13 실측: 정답 클릭 6.4초 전에 timeout). 그 클릭은 «무시돼야 맞는» 클릭이라 세지 않고,
  //    답할 수 있을 때 누른 클릭만 «정확히 +1층»을 단언한다(무시·두 층 오름은 그대로 FAIL).
  const pre = await page.evaluate(() => { const c = window.__SMOKE__.app.core; return { ok: c.phase === 'question' && !c.answered, f: c.floor, q: c.question && c.question.id }; });
  if (!pre.ok || pre.q !== s.qid) { raced += 1; continue; }
  await page.mouse.click(t.x, t.y);
  await page.waitForTimeout(120);
  const post = await page.evaluate(() => window.__SMOKE__.app.core.floor);
  if (post !== pre.f + 1) badClicks.push(`${pre.f}층에서 정답 클릭 → ${post}층`);
  correct += 1;
}
const final = await page.evaluate(() => ({ floor: window.__SMOKE__.app.core.floor, qa: window.__SMOKE__.qa() }));
notes.push(`실제 클릭 ${correct}회 → ${final.floor}층 · 오디오 ${final.qa.audio.decoded}/${final.qa.audio.expected} · 좀비트윈 ${final.qa.zombieTweens}`);

await page.screenshot({ path: 'qa/live.png' });

// 🔴 판정은 «정답 1회 = 1층»이다. 절대 층수로 문턱을 잡으면 게이트가 틀린 것을 재게 된다.
if (correct < WANT) fails.push(`정답 클릭 ${correct}회 < ${WANT} — 표본 부족(측정 무효)`);
if (badClicks.length) fails.push(`답할 수 있을 때 누른 정답이 +1층이 아니다: ${badClicks.slice(0, 3).join(' · ')}`);
if (raced) notes.push(`누르기 직전에 문항이 이미 끝나 있던 경우 ${raced}회(호스트 부하 · 시간초과) — 세지 않음`);
if (final.floor !== correct) fails.push(`정답 ${correct}회인데 ${final.floor}층 — 정답 1회당 정확히 1층이어야 한다`);
if (final.qa.audio.decoded < final.qa.audio.expected) fails.push(`오디오 ${final.qa.audio.expected - final.qa.audio.decoded}개 미디코드`);
if (final.qa.loadErrors.length) fails.push(`에셋 로드 실패: ${final.qa.loadErrors.join(', ')}`);
if (external.length) fails.push(`외부 도메인 요청 ${external.length}건: ${external.slice(0, 3).join(' | ')}`);
if (errors.length) fails.push(`콘솔 오류 ${errors.length}건: ${errors.slice(0, 3).join(' | ')}`);

// v3 — 한 번 틀리면 추락 → «다시 일어서기» 창 → 3연속 정답 → 같은 층에서 재출발 → 두 번째 추락은 결과 화면
{
  const clickChoice = async (wrong) => {
    await page.waitForFunction(() => { const c = window.__SMOKE__.app.core; return c.phase === 'question' && !c.answered; }, null, { timeout: 10000 });
    const pt = await page.evaluate((w) => {
      const q = window.__SMOKE__.app.core.question;
      const idx = w ? (q.answerIndex + 1) % q.choices.length : q.answerIndex;
      const r = document.querySelectorAll('.choice')[idx].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, wrong);
    await page.mouse.click(pt.x, pt.y);
  };
  try {
    const fl = await page.evaluate(() => window.__SMOKE__.app.core.floor);
    await clickChoice(true);
    await page.waitForSelector('#overlay-revive:not([hidden])', { timeout: 8000 });
    await page.click('#btn-revive');
    for (let i = 0; i < 3; i++) { await clickChoice(false); await page.waitForTimeout(150); }
    await page.waitForFunction(() => { const c = window.__SMOKE__.app.core; return c.phase === 'question' && !c.reviving; }, null, { timeout: 8000 });
    const back = await page.evaluate(() => window.__SMOKE__.app.core.floor);
    if (back !== fl) fails.push(`다시 일어선 층 ${back} ≠ 떨어진 층 ${fl}`);
    await clickChoice(true);
    await page.waitForFunction(() => document.querySelector('#screen-result').classList.contains('active'), null, { timeout: 8000 });
    notes.push(`추락 → 다시 일어서기 창 → 3연속 → ${back}층 재출발 → 두 번째 추락은 결과 화면`);
    await page.click('#btn-again');
    await page.waitForFunction(() => window.__SMOKE__.app.core && window.__SMOKE__.app.core.phase === 'question', null, { timeout: 15000 });
  } catch (e) {
    fails.push(`추락·다시 일어서기 흐름이 끊겼다: ${String(e.message || e).split('\n')[0]}`);
  }
}

// 학교 순위 카드가 실서버 허브에서 실제로 채워졌는가(«불러오지 못했어요»면 중계·CORS·비밀이 깨진 것)
const rankText = await page.evaluate(() => { window.__SMOKE__.app.quitRun(); return (document.querySelector('[data-gb="school-rank"]') || {}).textContent || ''; }).catch(() => '');
await page.waitForTimeout(1500);
const rankText2 = await page.evaluate(() => (document.querySelector('[data-gb="school-rank"]') || {}).textContent || '').catch(() => rankText);
if (/불러오지 못했/.test(rankText2) || !rankText2.trim()) fails.push(`학교 순위 카드가 비었거나 실패: «${rankText2.slice(0, 60)}»`);
else notes.push(`학교 순위 카드: «${rankText2.replace(/\s+/g, ' ').slice(0, 70)}»`);
await browser.close();

console.log(`\n── 배포 실측 (${TARGET}) ──`);
for (const n of notes) console.log('  · ' + n);
if (fails.length) { console.log('\n❌ 배포 실측 FAIL'); for (const f of fails) console.log('  ✖ ' + f); process.exit(1); }
console.log('\n✅ 배포 실측 PASS — 실제 URL 에서 플레이된다');
