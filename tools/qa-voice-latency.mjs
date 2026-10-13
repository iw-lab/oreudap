#!/usr/bin/env node
/**
 * 낭독 지연 게이트 (D32b) — 2026-10-13 사용자 «위로 올라갈수록 빨리 맞춰야 하는데 영어 낭독이 딜레이가 있어».
 * 그때그때 HTMLAudio 로 받던 시절 실측(모바일 왕복 120ms 가정): 낱말이 뜬 뒤 소리 시작까지 427~819ms, 3초 넘게 안 나는 것도 있었다
 * — 높은 층 제한시간 0.85초의 대부분이다. 처방 = 판 시작 뒤 과목 낱말을 받아 디코드해 두고(WebAudio) 문제가 뜨는 순간 튼다.
 *
 * 단언: 준비 시간(안내를 읽는 6초 · 판은 멈춘 채) 뒤 영어 문항(w2k) 20개 중 «디코드된 소리로 바로» 시작한 비율 ≥ 90%, 받기 실패 0.
 * 🔴 실제 Chrome 으로 잰다 — Playwright 기본 Chromium 엔 AAC(m4a) 디코더가 없어 전부 «실패»로 나온다(측정 무효).
 *
 *   node tools/qa-voice-latency.mjs [--dir dist] [--port 8293]     종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8293));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  if (u.startsWith('/api/')) { r.writeHead(200, { 'Content-Type': 'application/json' }); return r.end('{"offline":true}'); }
  const p = path.join(DIR, u === '/' ? 'index.html' : u);
  if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(r);
});

async function main() {
  await new Promise((res) => srv.listen(PORT, '127.0.0.1', res));
  let b;
  try { b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] }); }
  catch (e) { console.error('❌ 미실행: 실제 Chrome 이 필요하다(AAC 디코드) —', e.message.split('\n')[0]); srv.close(); process.exit(3); }
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  // 모바일 왕복 지연(120ms)을 흉내 낸다 — 로컬 서버는 너무 빨라 «그때그때 받기»도 빨라 보인다
  await p.route('**/assets/say/**', async (r) => { await new Promise((s) => setTimeout(s, 120)); r.continue(); });
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load' });
  await p.evaluate(async () => { await window.__SMOKE__.ready; const a = window.__SMOKE__.app; a.data.seenHow = true; a.subject = 'words34'; a.startRun(); a.paused = true; });
  await p.waitForTimeout(6000);   // 첫 판 안내를 읽는 시간(판은 멈춰 있다)
  const before = await p.evaluate(() => { const a = window.__SMOKE__.app; a.paused = false; a.lastFrame = performance.now(); return a.voice.report(); });
  let w2k = 0, instant = 0;
  for (let i = 0; i < 60 && w2k < 20; i++) {
    await p.waitForFunction(() => { const c = window.__SMOKE__.app.core; return c && c.phase === 'question' && !c.answered; }, null, { timeout: 10000 });
    const r = await p.evaluate(() => { const a = window.__SMOKE__.app; const q = a.core.question; const l = a.voice.report().last;
      return { dir: q.dir, word: q.word, ans: q.answerIndex, has: a.voice.has(q.word), l }; });
    if (r.dir === 'w2k' && r.has && r.l && r.l.word === String(r.word).toLowerCase()) { w2k += 1; if (r.l.instant) instant += 1; }
    await p.evaluate((i) => { const a = window.__SMOKE__.app; a.core.hearts = 3; a.press(i); }, r.ans);
    await p.waitForTimeout(450);
  }
  const rep = await p.evaluate(() => window.__SMOKE__.app.voice.report());
  await b.close(); srv.close();
  const fails = [];
  console.log(`  · 준비 6초 동안 디코드 ${before.decoded}개 · 끝에 ${rep.decoded}개 · 받기 실패 ${rep.failed.length}`);
  console.log(`  · 영어 문항 ${w2k}개 중 바로 시작 ${instant}개 (${w2k ? Math.round(instant / w2k * 100) : 0}%)`);
  if (w2k < 15) fails.push(`영어 문항 표본 ${w2k}개 < 15 — 측정 무효`);
  else if (instant / w2k < 0.9) fails.push(`낱말이 뜰 때 소리가 준비돼 있던 비율 ${Math.round(instant / w2k * 100)}% < 90% — 낭독이 늦게 시작한다`);
  if (rep.failed.length) fails.push(`낱말 소리 받기·디코드 실패 ${rep.failed.length}건 (${rep.failed.slice(0, 3).join(' · ')})`);
  if (errs.length) fails.push(`런타임 오류 ${errs.length}건: ${errs[0]}`);
  if (fails.length) { console.log('\n❌ 낭독 지연 게이트 FAIL'); for (const f of fails) console.log('  ✖ ' + f); process.exit(1); }
  console.log('\n✅ 낭독 지연 PASS (D32b)');
}
main().catch((e) => { console.error('❌ 도구가 죽었다(미실행):', e); try { srv.close(); } catch { /* */ } process.exit(3); });
