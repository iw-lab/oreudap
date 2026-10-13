#!/usr/bin/env node
/**
 * 「모드가 화면에서도 모드인가」 게이트 (D34).
 *
 * 🔴 probe-modes(D33)는 코어만 돌린다 — 코어가 아무리 맞아도 HUD 가 게이지를 안 그리면
 *    아이에겐 없는 기능이다. 여기서는 «브라우저에서 보이는 것»만 잰다.
 *
 *  ① 모드를 고르면 그 모드로 판이 시작된다(고른 것과 도는 것이 같다)
 *  ② 아슬아슬: 기력 막대가 보이고 하트는 사라진다 · 막대가 «실제로 줄어든다»
 *  ③ 아슬아슬: 기력이 바닥나면 위험 연출이 켜지고, 게이지 0 에서 판이 끝난다
 *  ④ 60초 질주: 판 시계가 보이고 줄어든다
 *  ⑤ 클래식: 기력 막대·판 시계가 «없다»(모드가 서로 새지 않는다)
 *  ⑥ 고른 모드가 다음 실행에도 남는다(localStorage)
 *
 *   node tools/qa-modes.mjs [--dir dist] [--port 8197]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { MODES } from '../src/core/balance.js';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8197));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

const fails = [];
const FAIL = (m) => fails.push(m);
const notes = [];
const NOTE = (m) => { notes.push(m); console.log('  · ' + m); };

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      // 학교 허브 중계가 없는 로컬 서버 — 키트 약속대로 «꺼짐»을 200 으로 알린다(404 면 콘솔 오류로 세진다)
      if (url.startsWith('/api/hub')) { rsp.writeHead(200, { 'Content-Type': 'application/json' }); rsp.end('{"offline":true}'); return; }
      const p = path.join(DIR, url === '/' ? 'index.html' : url);
      if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        rsp.writeHead(404).end('404'); return;
      }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

const boot = async (page) => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const t0 = Date.now();
    while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
    // 🔴 이 게이트들은 «이미 놀아 본 아이»를 잰다 — 첫 판 안내(D35)는 판을 멈춰 세우므로
    //    여기서 켜 두면 봇이 한 층도 못 오른다. 첫 판 경험 자체는 qa-howto.mjs 가 따로 잰다.
    window.__SMOKE__.app.data.seenHow = true;
  });
};

/** 화면에서 «보이는» 것만 읽는다 — hidden 이거나 크기가 0 이면 없는 것이다 */
const hud = () => {
  const vis = (sel) => {
    const e = document.querySelector(sel);
    if (!e || e.hidden) return null;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  };
  const fill = document.querySelector('#stamina-fill');
  const app = window.__SMOKE__.app;
  return {
    mode: app.core ? app.core.mode : null,
    stamina: !!vis('#hud-stamina'),
    staminaW: fill ? parseFloat(fill.style.width) || 0 : 0,
    hearts: !!vis('#hud-hearts'),
    clock: !!vis('#run-clock'),
    clockText: (document.querySelector('#run-clock') || {}).textContent || '',
    danger: !!vis('#danger'),
    phase: app.core ? app.core.phase : null,
    floor: app.core ? app.core.floor : -1,
  };
};

/** UI 로 모드를 고르고 판을 시작한다 — 내부 필드를 만지지 않는다(그러면 UI 를 안 재는 것이다) */
async function startVia(page, mode) {
  await page.evaluate(() => { window.__SMOKE__.app.go('title'); });
  // v2: 첫 화면에서 과목 칩 → 모드 카드를 누르면 그 모드로 «바로» 시작한다(범위 화면 없음)
  await page.click('.subject-chip >> nth=0');
  await page.click(`.gb-mode[data-id="${mode}"]`);
  await page.waitForFunction(() => {
    const a = window.__SMOKE__.app;
    return a.core && a.core.phase === 'question';
  }, null, { timeout: 15000 });
}

async function main() {
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => FAIL(`런타임 오류: ${e.message}`));
  await boot(page);

  console.log('\n── 모드가 화면에서도 모드인가 (D34) ──');

  // 모드 선택지가 코어의 모드 목록과 «같은 수»로 그려진다
  const opts = await page.$$eval('.gb-mode', (es) => es.map((e) => e.dataset.id));
  const missing = Object.keys(MODES).filter((m) => !opts.includes(m));
  if (missing.length) FAIL(`코어 모드 ${missing.join(',')} 의 카드가 없다 — 화면에 없는 모드는 없는 모드다`);
  if (!opts.includes('daily')) FAIL('오늘의 계단 카드가 없다');
  NOTE(`모드 카드 ${opts.length}개: ${opts.join(', ')}`);

  // ⑤ 클래식 — 기력·판 시계가 없다
  await startVia(page, 'classic');
  let h = await page.evaluate(hud);
  if (h.mode !== 'classic') FAIL(`클래식을 골랐는데 ${h.mode} 로 시작했다`);
  if (h.stamina) FAIL('클래식에 기력 막대가 보인다 — 모드가 서로 새고 있다');
  if (h.clock) FAIL('클래식에 판 시계가 보인다');
  if (!h.hearts) FAIL('클래식에 하트가 안 보인다');
  NOTE(`클래식: 하트 O · 기력 X · 시계 X`);

  // ② 아슬아슬 — 기력이 보이고 «줄어든다», 하트는 없다
  await startVia(page, 'thrill');
  h = await page.evaluate(hud);
  if (h.mode !== 'thrill') FAIL(`아슬아슬을 골랐는데 ${h.mode} 로 시작했다`);
  if (!h.stamina) FAIL('아슬아슬인데 기력 막대가 안 보인다');
  if (h.hearts) FAIL('아슬아슬에 하트가 보인다 — 생명선이 둘로 보이면 규칙이 흐려진다');
  const w0 = h.staminaW;
  await page.waitForTimeout(1200);
  const w1 = (await page.evaluate(hud)).staminaW;
  if (!(w1 < w0 - 1)) FAIL(`기력 막대가 1.2초 동안 ${w0.toFixed(1)}%→${w1.toFixed(1)}% — 줄지 않는다(HUD 가 죽어 있다)`);
  NOTE(`아슬아슬: 기력 O · 하트 X · 1.2초에 ${w0.toFixed(1)}%→${w1.toFixed(1)}%`);

  // ③ 바닥나면 위험 연출 → 판 종료
  await page.evaluate(() => { window.__SMOKE__.app.core.stamina = 0.2; window.__SMOKE__.app.updateHud(); });
  const low = await page.evaluate(hud);
  if (!low.danger) FAIL('기력이 위험 구간인데 아슬아슬 연출이 안 켜졌다');
  await page.evaluate(() => { window.__SMOKE__.app.core.stamina = 0.002; });
  await page.waitForFunction(() => window.__SMOKE__.app.core.phase === 'over', null, { timeout: 8000 })
    .catch(() => FAIL('기력이 0 이 됐는데 판이 끝나지 않는다'));
  const after = await page.evaluate(hud);
  if (after.danger) FAIL('판이 끝났는데 위험 연출이 남아 있다');
  NOTE('아슬아슬: 위험 연출 O · 기력 0 에서 판 종료 · 종료 후 연출 정리 O');

  // ④ 60초 질주 — 판 시계가 보이고 줄어든다
  await startVia(page, 'sprint');
  h = await page.evaluate(hud);
  if (h.mode !== 'sprint') FAIL(`60초 질주를 골랐는데 ${h.mode} 로 시작했다`);
  if (!h.clock) FAIL('60초 질주인데 판 시계가 안 보인다');
  if (h.stamina) FAIL('60초 질주에 기력 막대가 보인다');
  const t0 = parseFloat(h.clockText);
  await page.waitForTimeout(1200);
  const t1 = parseFloat((await page.evaluate(hud)).clockText);
  if (!(t1 < t0 - 0.5)) FAIL(`판 시계가 ${t0}→${t1} — 줄지 않는다`);
  NOTE(`60초 질주: 시계 O · 기력 X · 1.2초에 ${t0}→${t1}초`);

  // ⑦ 거울 계단 — 문제는 곱, 보기는 식(D48)
  await startVia(page, 'mirror');
  const mq = await page.evaluate(() => ({ mode: window.__SMOKE__.app.core.mode, q: document.querySelector('#qtext').textContent,
    ch: [...document.querySelectorAll('#choices .choice .txt')].map((e) => e.textContent) }));
  if (mq.mode !== 'mirror') FAIL(`거울 계단을 골랐는데 ${mq.mode} 로 시작했다`);
  if (!/^\d+$/.test(mq.q.trim())) FAIL(`거울 계단 문제가 곱(숫자)이 아니다: «${mq.q}»`);
  if (!mq.ch.length || !mq.ch.every((c) => /^\d × \d$/.test(c))) FAIL(`거울 계단 보기가 식이 아니다: ${mq.ch.join(' / ')}`);
  NOTE(`거울 계단: «${mq.q}» → ${mq.ch.join(' / ')}`);
  // 끝난 판이 아니면 다음 검사를 위해 저장 모드를 sprint 로 되돌린다
  await startVia(page, 'sprint');

  // ⑥ 고른 모드가 남는다
  // 🔴 저장 형식은 {version, data} 다 — 최상위에서 mode 를 찾으면 영원히 undefined 다(그렇게 틀렸다).
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('oreudap:progress')).data.mode);
  if (saved !== 'sprint') FAIL(`저장된 모드가 ${saved} — 마지막에 고른 sprint 여야 한다`);
  await boot(page);
  const restored = await page.$eval('.subject-chip', (e) => e && true) && await page.evaluate(() => window.__SMOKE__.app.mode);
  if (restored !== 'sprint') FAIL(`새로 켰을 때 모드가 ${restored} — 고른 모드를 기억하지 못한다`);
  NOTE('고른 모드가 새로 켜도 남는다');

  await browser.close();
  srv.close();

  if (fails.length) {
    console.error('\n❌ 모드 화면 게이트 FAIL');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log('\n✅ 모드 화면 PASS');
}

main().catch((e) => { console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e); process.exit(3); });
