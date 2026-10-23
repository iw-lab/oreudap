#!/usr/bin/env node
/**
 * 「처음 온 아이가 방법을 아는가」 게이트 (D35).
 *
 * 🔴 왜 있나: 21개 게이트가 초록불인 채로, 처음 들어온 아이에게 «발판을 누르라»는 말이
 *    어디에도 없는 빌드가 배포됐다(사용자 지적 2026-09-05). 아무도 「설명이 있는가」를
 *    재지 않았기 때문이다 — 재지 않는 것은 지켜지지 않는다.
 *
 *  ① 첫 판에서 안내가 «저절로» 뜬다
 *  ② 안내가 떠 있는 동안 판이 멈춰 있다(읽는 동안 기력·시간이 흐르면 읽자마자 죽는다)
 *  ③ 닫으면 판이 다시 흐른다(멈춘 채로 남지 않는다)
 *  ④ 두 번째 판에는 다시 뜨지 않는다
 *  ⑤ 「?」 버튼으로 언제든 다시 볼 수 있고, 닫으면 판이 이어진다
 *  ⑥ 기기에 맞는 말이 적힌다(터치 기기에 「방향키」만 적히면 없는 키를 찾게 된다)
 *  ⑦ 모드에 맞는 말이 적힌다(아슬아슬엔 하트가 없다)
 *
 *   node tools/qa-howto.mjs [--dir dist] [--port 8198]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8198));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

const fails = [];
const FAIL = (m) => fails.push(m);
const NOTE = (m) => console.log('  · ' + m);

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

const state = () => {
  const how = document.querySelector('#overlay-how');
  const a = window.__SMOKE__.app;
  const vis = how && !how.hidden && how.getBoundingClientRect().height > 0;
  return {
    open: !!vis,
    text: vis ? how.innerText.replace(/\s+/g, ' ').trim() : '',
    paused: !!a.paused,
    floor: a.core ? a.core.floor : -1,
    stamina: a.core ? a.core.stamina : null,
    screen: a.screen,
  };
};

const boot = async (page) => {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const t0 = Date.now();
    while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
  });
};

const startVia = async (page, mode) => {
  await page.evaluate(() => { window.__SMOKE__.app.go('title'); });
  // v2: 과목 칩 → 모드 카드(누르면 바로 시작)
  await page.click('.subject-chip >> nth=0');
  await page.click(`.gb-mode[data-id="${mode}"]`);
  await page.waitForTimeout(400);
};

async function run(device, label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => FAIL(`[${label}] 런타임 오류: ${e.message}`));
  await boot(page);

  // ① 첫 판 — 안내가 저절로 뜬다
  await startVia(page, 'thrill');
  let s = await page.evaluate(state);
  if (!s.open) { FAIL(`[${label}] 첫 판에 놀이 방법 안내가 뜨지 않는다`); await browser.close(); return; }

  // ⑥⑦ 기기·모드에 맞는 말
  const touch = !!device.hasTouch;
  if (touch && !/누르|눌러|탭/.test(s.text)) FAIL(`[${label}] 터치 기기 안내에 «누르기» 말이 없다: ${s.text.slice(0, 60)}`);
  if (!touch && !/키/.test(s.text)) FAIL(`[${label}] 데스크톱 안내에 «키» 안내가 없다: ${s.text.slice(0, 60)}`);
  if (/하트/.test(s.text)) FAIL(`[${label}] 아슬아슬 모드 안내에 «하트»가 적혀 있다 — 그 모드엔 하트가 없다`);
  if (!/기력/.test(s.text)) FAIL(`[${label}] 아슬아슬 모드 안내에 «기력» 설명이 없다`);

  // ② 읽는 동안 판이 멈춰 있다
  if (!s.paused) FAIL(`[${label}] 안내가 떠 있는데 판이 흐른다 — 읽는 사이에 기력이 준다`);
  const st0 = s.stamina;
  await page.waitForTimeout(1500);
  const st1 = (await page.evaluate(state)).stamina;
  if (st0 != null && st1 != null && st1 < st0 - 0.02) {
    FAIL(`[${label}] 안내를 읽는 1.5초 동안 기력이 ${st0.toFixed(2)}→${st1.toFixed(2)} 로 줄었다`);
  }

  // ③ 닫으면 판이 다시 흐른다
  await page.click('#btn-how-start');
  s = await page.evaluate(state);
  if (s.open) FAIL(`[${label}] 닫기를 눌러도 안내가 남아 있다`);
  if (s.paused) FAIL(`[${label}] 안내를 닫았는데 판이 멈춘 채다 — 아이는 게임이 고장 난 줄 안다`);
  await page.waitForTimeout(1200);
  const st2 = (await page.evaluate(state)).stamina;
  if (st1 != null && st2 != null && !(st2 < st1)) FAIL(`[${label}] 닫은 뒤에도 기력이 흐르지 않는다(판이 죽어 있다)`);

  // ④ 두 번째 판에는 안 뜬다
  await page.evaluate(() => window.__SMOKE__.app.quitRun());
  await startVia(page, 'classic');
  s = await page.evaluate(state);
  if (s.open) FAIL(`[${label}] 두 번째 판에도 안내가 다시 뜬다 — 매번 막히면 성가시다`);

  // ⑤ 「?」 로 다시 보기 → 닫으면 이어진다
  await page.click('#btn-how');
  s = await page.evaluate(state);
  if (!s.open) FAIL(`[${label}] «?» 버튼으로 안내를 다시 볼 수 없다`);
  // v3: 클래식은 «한 번 틀리면 추락» — 안내가 그걸 말하고, 다시 일어서기도 알려야 한다
  if (!/떨어/.test(s.text)) FAIL(`[${label}] 클래식 안내에 «틀리면 떨어진다» 설명이 없다`);
  if (!/다시 일어/.test(s.text)) FAIL(`[${label}] 클래식 안내에 «다시 일어서기» 설명이 없다`);
  if (/하트/.test(s.text)) FAIL(`[${label}] 클래식 안내에 «하트»가 적혀 있다 — 하트는 이제 없다`);
  await page.click('#btn-how-start');
  s = await page.evaluate(state);
  if (s.open || s.paused) FAIL(`[${label}] «?» 로 열었다 닫은 뒤 판이 이어지지 않는다`);

  NOTE(`[${label}] 첫 판 자동 노출 O · 읽는 동안 멈춤 O · 닫으면 재개 O · 두 번째 판 미노출 O · «?» 재열람 O`);
  await browser.close();
}

async function main() {
  const srv = await serve();
  console.log('\n── 처음 온 아이가 방법을 아는가 (D35) ──');
  await run({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, '모바일');
  await run({ viewport: { width: 1280, height: 800 } }, '데스크톱');
  srv.close();

  if (fails.length) {
    console.error('\n❌ 놀이 방법 게이트 FAIL');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log('\n✅ 놀이 방법 PASS');
}

main().catch((e) => { console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e); process.exit(3); });
