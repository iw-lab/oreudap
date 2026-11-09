#!/usr/bin/env node
// 주소 이사 때 아이의 저장 기록이 따라오는지 — 옛 주소 페이지(tools/old-address)와 새 주소(move-in.js)를 진짜 두 출처로 띄워 잰다.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require_ = createRequire('/Users/sim-insu/.claude/skills/game-builder/');
const puppeteer = require_('puppeteer');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OLD = 'https://oreudap.vercel.app', NEW = 'https://muhan-61w.pages.dev';
const oldHtml = readFileSync(join(ROOT, 'tools/old-address/index.html'), 'utf8');
const moveIn = readFileSync(join(ROOT, 'public/move-in.js'), 'utf8');
const realIndex = readFileSync(join(ROOT, 'index.html'), 'utf8');
const stubNew = `<!doctype html><script>${realIndex.includes('move-in.js') ? moveIn : ''}</script>new`;
let fails = 0; const ok = (name, pass, got) => { console.log(`${pass ? '✅' : '❌'} ${name}${pass ? '' : ` — ${got}`}`); if (!pass) fails++; };
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
async function page() {
  const p = await (await browser.createBrowserContext()).newPage();
  await p.setRequestInterception(true);
  p.on('request', (r) => {
    const u = r.url();
    if (u.startsWith(OLD)) return r.respond({ contentType: 'text/html; charset=utf-8', body: new URL(u).pathname === '/seed' ? 'seed' : oldHtml });
    if (u.startsWith(NEW)) return r.respond({ contentType: 'text/html; charset=utf-8', body: new URL(u).pathname === '/seed' ? 'seed' : stubNew });
    r.abort();
  });
  return p;
}
const set = (p, o) => p.evaluate((x) => { for (const k in x) localStorage.setItem(k, x[k]); }, o);
const dump = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
const SAVE = JSON.stringify({ version: 1, data: { coins: 120 } });
{ // ① 기록이 있는 기기
  const p = await page();
  await p.goto(`${OLD}/seed`); await set(p, { 'oreudap:progress': SAVE, 'oreudap.hub.v1': '{"did":"x"}', 'oreudap.hub.v1.quiz': '{"s":"math"}', other: 'nope' });
  await p.goto(`${NEW}/seed`); await set(p, { 'oreudap.hub.v1.quiz': '{"s":"eng"}' });
  await p.goto(`${OLD}/?ref=ssam`); await p.waitForFunction((n) => location.origin === n, {}, NEW);
  await p.waitForFunction(() => !location.hash);
  const d = await dump(p);
  ok('진행 저장이 그대로 온다', d['oreudap:progress'] === SAVE, d['oreudap:progress']);
  ok('학교·기기 표식이 온다', d['oreudap.hub.v1'] === '{"did":"x"}', JSON.stringify(d));
  ok('새 주소에 이미 있는 값은 안 덮는다', d['oreudap.hub.v1.quiz'] === '{"s":"eng"}', d['oreudap.hub.v1.quiz']);
  ok('다른 열쇠는 안 옮긴다', !('other' in d), d.other);
  ok('? 뒤 주소가 이어지고 # 은 지워진다', p.url() === `${NEW}/?ref=ssam`, p.url());
}
{ // ② 기록이 없는 기기
  const p = await page();
  await p.goto(`${OLD}/some/path`); await p.waitForFunction((n) => location.origin === n, {}, NEW);
  ok('기록이 없으면 # 없이 옮긴다', p.url() === `${NEW}/`, p.url());
}
{ // ③ 손으로 만든 링크
  const p = await page();
  await p.goto(`${NEW}/#gbmove=${encodeURIComponent(JSON.stringify({ evil: 'x', 'oreudap.hub.v1.quiz': '1', 'oreudap:progress': 5 }))}`);
  const d = await dump(p);
  ok('링크로 다른 열쇠·문자열 아닌 값을 못 심는다', !('evil' in d) && !('oreudap:progress' in d) && d['oreudap.hub.v1.quiz'] === '1', JSON.stringify(d));
  await p.goto(`${NEW}/x#gbmove=%E0%A4%A`); ok('깨진 링크에도 안 죽는다', (await dump(p)).evil === undefined, '');
}
await browser.close();
console.log(fails ? `❌ 주소 이사 FAIL ${fails}` : '✅ 주소 이사 통과');
process.exit(fails ? 1 : 0);
