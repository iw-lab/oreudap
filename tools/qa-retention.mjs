#!/usr/bin/env node
/**
 * 재방문·재미 게이트 — D37~D41.
 *
 * 🔴 이 게이트가 재는 것은 「재미있는가」가 아니다. 그건 기계가 못 잰다.
 *    재는 것은 「재미를 만들려다 아이를 압박하고 있지 않은가」다 —
 *    재방문 장치는 **한 줄만 잘못 써도** 강박 장치가 된다(docs/RESEARCH-retention.md §3).
 *
 * 용법: node tools/qa-retention.mjs [--dir dist] [--port 8291]
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8291));

const fails = [];
const notes = [];
const FAIL = (m) => fails.push(m);
const NOTE = (m) => notes.push(m);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webp': 'image/webp', '.png': 'image/png', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rq) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      // 학교 허브 중계가 없는 로컬 서버 — 키트 약속대로 «꺼짐»을 200 으로 알린다(404 면 콘솔 오류로 세진다)
      if (u.startsWith('/api/hub')) { rq.writeHead(200, { 'Content-Type': 'application/json' }); rq.end('{"offline":true}'); return; }
      let f = path.join(DIR, u === '/' ? 'index.html' : u);
      if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIR, 'index.html');
      rq.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(rq);
    });
    srv.listen(PORT, () => res(srv));
  });
}

/** 게이트 봇의 공통 준비 — 첫 판 안내는 판을 멈춰 세운다 */
const boot = async (page) => {
  await page.evaluate(async () => {
    const t = Date.now();
    while (!window.__SMOKE__ && Date.now() - t < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
    window.__SMOKE__.app.data.seenHow = true;
  });
};

async function main() {
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle', timeout: 60000 });
  await boot(page);

  // ── D37: 오늘의 계단은 날짜가 같으면 어디서나 같은 판 ────────────
  // 🔴 «전국이 같은 판»은 기기가 하나뿐이라 눈으로 확인할 수 없다. 그래서 여기서만 잡힌다.
  // 화면에 실제로 그려진 오늘의 계단을 두 번 읽어 같은지 본다(렌더 경로까지 포함해 잰다)
  const readDaily = () => page.evaluate(() => {
    window.__SMOKE__.app.renderDaily();
    return {
      goal: document.querySelector('#daily-goal')?.textContent || '',
      rule: document.querySelector('#daily-rule')?.textContent || '',
      day: document.querySelector('#daily-day')?.textContent || '',
    };
  });
  const d1 = await readDaily();
  const d2 = await readDaily();
  if (JSON.stringify(d1) !== JSON.stringify(d2)) {
    FAIL(`오늘의 계단이 부를 때마다 달라진다 — 결정론이 깨졌다: ${JSON.stringify(d1)} vs ${JSON.stringify(d2)}`);
  }
  if (!/목표 \d+층/.test(d1.goal)) FAIL(`오늘의 목표가 화면에 없다: "${d1.goal}"`);
  NOTE(`오늘의 계단 ${d1.day} · ${d1.goal} · ${d1.rule}`);

  // 규칙이 실제로 판에 반영되는가 — 구구단은 오늘의 단만 나와야 한다
  const ruled = await page.evaluate(async () => {
    const app = window.__SMOKE__.app;
    app.startDaily('gugudan');
    const t = Date.now();
    while ((!app.core || app.core.phase !== 'question') && Date.now() - t < 8000) {
      await new Promise((r) => setTimeout(r, 60));
    }
    const dans = new Set();
    for (let i = 0; i < 14; i += 1) {
      const c = app.core;
      if (!c || c.phase !== 'question' || c.answered) { await new Promise((r) => setTimeout(r, 120)); continue; }
      const m = String(c.question.id).match(/^g:(\d+)x/);
      if (m) dans.add(Number(m[1]));
      app.press(c.question.answerIndex, 'pointer');
      await new Promise((r) => setTimeout(r, 180));
    }
    const scope = app.daily ? app.daily.scope : null;
    app.quitRun();
    return { dans: [...dans].sort((a, b) => a - b), scope, wasDaily: true };
  });
  if (ruled.scope) {
    const outside = ruled.dans.filter((d) => !ruled.scope.includes(d));
    if (outside.length) FAIL(`오늘의 규칙(${ruled.scope.join(',')}단) 밖의 단이 나왔다: ${outside.join(',')}`);
    NOTE(`오늘의 규칙 ${ruled.scope.join(',')}단 → 실제 출제 ${ruled.dans.join(',')}단`);
  } else {
    NOTE(`오늘은 단 제한이 없는 날 · 출제 ${ruled.dans.join(',')}단`);
  }

  // 🔴 오늘의 계단이 «일반 런으로 새지» 않는가 — 상태 누수는 조용해서 눈으로 못 본다
  const leak = await page.evaluate(() => {
    const app = window.__SMOKE__.app;
    app.startRun();                 // 일반 런
    const d = app.daily;
    app.quitRun();
    return d;
  });
  if (leak) FAIL('일반 런을 시작했는데 daily 가 살아 있다 — 그 판 결과가 오늘의 깃발로 기록된다');

  // ── D38: 구간 해금이 건너뛰기로 열리지 않는다 ──────────────────
  const lock = await page.evaluate(() => {
    const app = window.__SMOKE__.app;
    const read = () => [...document.querySelectorAll('#zone-list .zone')]
      .map((z) => ({ locked: z.classList.contains('locked'), text: z.textContent.replace(/\s+/g, ' ').trim() }));
    app.subject = 'gugudan';
    // ① 기록 0 — 첫 구간만 열려 있어야 한다
    app.data.best = {};
    app.renderJourney();
    const fresh = read();
    // ② 저장 데이터를 «손으로» 조작해 본다 — 해금을 직접 써 넣을 수 있는가
    app.data.unlockedZones = ['forest', 'cloud', 'space', 'lava'];
    app.data.journey = { space: true };
    app.renderJourney();
    const forged = read();
    // ③ 정직하게 20층을 찍으면 다음이 열린다
    app.data.best[app.bestKey()] = 20;
    app.renderJourney();
    const earned = read();
    app.data.best = {};
    delete app.data.unlockedZones; delete app.data.journey;
    app.renderJourney();
    return { fresh, forged, earned };
  });
  if (lock.fresh[0].locked) FAIL('첫 구간이 잠겨 있다 — 시작할 곳이 없다');
  if (!lock.fresh[1].locked) FAIL('기록 0인데 두 번째 구간이 열려 있다');
  if (JSON.stringify(lock.forged) !== JSON.stringify(lock.fresh)) {
    FAIL('저장 데이터에 해금을 써 넣었더니 구간이 열렸다 — 해금은 최고 기록에서만 유도돼야 한다');
  }
  if (lock.earned[1].locked) FAIL('20층을 찍었는데 두 번째 구간이 안 열렸다');
  if (!lock.earned[2].locked) FAIL('20층인데 세 번째 구간까지 열렸다 — 건너뛰기');
  NOTE(`구간 잠금 OK · 기록0 잠금 ${lock.fresh.filter((z) => z.locked).length}개 → 20층 ${lock.earned.filter((z) => z.locked).length}개`);

  // ── D39: 압박 문구가 화면에 없다 ──────────────────────────────
  // 🔴 조사가 지목한 다크패턴을 «문구 수준»에서 막는다. 「이번 주 3일 남았어요」와
  //    「3일 못 채우면 사라져요」는 코드가 같고 문구만 다르다 — 그래서 문구를 잰다.
  const BANNED = ['연속 끊', '사라집니다', '사라져', '초 남았', '지금 안 하면', '마지막 기회',
    '오늘 안 하면', '기록이 초기화', '놓치면'];
  const screens = ['title', 'result', 'collection', 'notes'];
  const seen = [];
  for (const sc of screens) {
    const text = await page.evaluate((name) => {
      const app = window.__SMOKE__.app;
      app.go(name);
      const el = document.querySelector(`#screen-${name}`);
      return el ? el.textContent.replace(/\s+/g, ' ') : '';
    }, sc);
    for (const w of BANNED) if (text.includes(w)) seen.push(`${sc}: "${w}"`);
  }
  if (seen.length) FAIL(`압박 문구가 화면에 있다: ${seen.join(' · ')}`);
  NOTE(`압박 문구 검사 ${screens.length}화면 · 금지어 ${BANNED.length}개 · 발견 0`);

  // ── D41: 제목이 원작 상표를 비껴간다 ──────────────────────────
  // 🔴 docs/RESEARCH.md §3-1 이 「제목에 «무한»·«계단» 조합 및 «Infinite Stairs» 회피」를
  //    적어 뒀는데, 정작 제목이 「정답을 밟고 오르는 무한 계단」이었다(2026-09-06 발견).
  //    규칙을 문서에만 적어 두면 반드시 어긴다 — 게이트가 없는 항목은 아무도 안 잡는다.
  // 🔴 «무한»과 «계단»을 각각 금지하는 게 아니다. 둘이 «가까이 붙는 것»이 상표를 닮게 만든다.
  const brand = await page.evaluate(async () => {
    const title = document.title || '';
    const desc = document.querySelector('meta[name="description"]')?.content || '';
    let mf = '';
    try {
      const href = document.querySelector('link[rel="manifest"]')?.href;
      if (href) mf = JSON.stringify(await fetch(href).then((r) => r.json()));
    } catch { mf = ''; }
    return { title, desc, mf };
  });
  // 「무한」과 「계단」 사이에 글자가 5자 이내면 «조합»으로 본다(「무한 계단」·「무한의 계단」·「무한 학습 계단」)
  const COMBO = /무한.{0,5}계단|계단.{0,5}무한/;
  const EN = /infinite\s*stairs/i;
  for (const [where, text] of Object.entries({ '제목': brand.title, '설명': brand.desc, 'manifest': brand.mf })) {
    if (COMBO.test(text)) FAIL(`${where}에 «무한+계단» 조합이 있다 — 원작 상표를 닮는다: "${String(text).slice(0, 80)}"`);
    if (EN.test(text)) FAIL(`${where}에 «Infinite Stairs» 가 있다: "${String(text).slice(0, 80)}"`);
  }
  NOTE(`제목 "${brand.title}" · 상표 회피 OK`);

  // ── D40: 종료점이 보인다 ─────────────────────────────────────
  const stop = await page.evaluate(async () => {
    const app = window.__SMOKE__.app;
    app.mode = 'classic'; app.subject = 'gugudan'; app.scope = null;
    app.startRun();
    const t = Date.now();
    while ((!app.core || app.core.phase !== 'question') && Date.now() - t < 8000) {
      await new Promise((r) => setTimeout(r, 60));
    }
    // 하트를 다 잃어 «진짜» 결과 화면으로 간다(quitRun 은 타이틀로 가므로 못 쓴다)
    for (let i = 0; i < 40 && !app.settled; i += 1) {
      const c = app.core;
      if (!c || c.phase !== 'question' || c.answered) { await new Promise((r) => setTimeout(r, 120)); continue; }
      app.press((c.question.answerIndex + 1) % c.question.choices.length, 'pointer');
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 500));
    const b = document.querySelector('#btn-enough');
    const r = b ? b.getBoundingClientRect() : null;
    const goals = [...document.querySelectorAll('#result-goals .goal')].map((g) => g.textContent.replace(/\s+/g, ' ').trim());
    return {
      onResult: document.querySelector('#screen-result')?.classList.contains('active'),
      text: b ? b.textContent.trim() : null,
      h: r ? r.height : 0, w: r ? r.width : 0,
      goals,
      cause: document.querySelector('#result-cause')?.textContent || '',
    };
  });
  if (!stop.onResult) FAIL('하트를 다 잃었는데 결과 화면이 아니다 — 측정 무효');
  if (!stop.text) FAIL('결과 화면에 「그만두는 길」이 없다 — 종료점을 없애면 안 된다');
  if (stop.h < 44) FAIL(`종료 버튼 높이 ${Math.round(stop.h)}px < 44px — 있으나 못 누른다`);
  // 🔴 목표가 하나뿐이면 그것을 넘은 순간 갈 곳이 없어진다. 성격이 다른 것을 겹쳐야 한다.
  if (stop.goals.length < 3) FAIL(`결과 화면의 목표가 ${stop.goals.length}개 — 셋 이상이어야 한다`);
  NOTE(`종료점 "${stop.text}" ${Math.round(stop.w)}×${Math.round(stop.h)}px · 목표 ${stop.goals.length}개`);
  for (const g of stop.goals) NOTE(`  · ${g}`);

  if (errors.length) FAIL(`콘솔 오류 ${errors.length}건: ${errors.slice(0, 3).join(' | ')}`);

  await browser.close();
  srv.close();

  console.log('\n── 재방문·재미 게이트 (D37~D41) ───────────────');
  for (const n of notes) console.log('  · ' + n);
  if (fails.length) {
    console.log('\n❌ 재방문 게이트 FAIL');
    for (const f of fails) console.log('  ✖ ' + f);
    process.exit(1);
  }
  console.log('\n✅ 재방문 게이트 PASS (D37 · D38 · D39 · D40 · D41)');
}

main().catch((e) => {
  console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e && e.message);
  process.exit(3);
});
