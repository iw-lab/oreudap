#!/usr/bin/env node
/**
 * 성능·번들 게이트 (D25).
 *
 * 🔴 합격선은 «등급»으로 읽는다 — P95 프레임 간격은 vsync 배수(16.7/33.3)로 스냅되므로
 *    16.7ms 로 적으면 영구 미달이다(데스크톱 ≤17.5ms · 모바일 ≤34ms).
 * 🔴 「최악 장면에서 쟀다」를 주장이 아니라 로그로 남긴다 — 조용한 장면을 재고 빠르다고 말하지 않게.
 * ⚠️ 이 도구는 «구조 경고선»과 «번들»을 판정한다. 최종 성능 합격은 실기기에서 다시 잰다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { PERF } from '../src/core/balance.js';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8190));
const FRAMES = Number(opt('--frames', 420));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

const fails = [];
const notes = [];
const FAIL = (m) => fails.push(m);
const NOTE = (m) => notes.push(m);

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      // 학교 허브 중계가 없는 로컬 서버 — 키트 약속대로 «꺼짐»을 200 으로 알린다(404 면 콘솔 오류로 세진다)
      if (url.startsWith('/api/hub')) { rsp.writeHead(200, { 'Content-Type': 'application/json' }); rsp.end('{"offline":true}'); return; }
      const p = path.join(DIR, url === '/' ? 'index.html' : url);
      if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
        rsp.writeHead(404).end('404');
        return;
      }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
  const p = path.join(dir, d.name);
  return d.isDirectory() ? walk(p) : [p];
});

async function main() {
  // ── ① 번들 크기 ────────────────────────────────────────
  const files = walk(DIR);
  const isOndemand = (f) => PERF.ONDEMAND_DIRS.some((d) => path.relative(DIR, f).startsWith(d));
  const sum = (fs_) => fs_.reduce((a, f) => a + fs.statSync(f).size, 0);
  const bundle = sum(files.filter((f) => !isOndemand(f)));
  const ondemand = sum(files.filter(isOndemand));
  const MB = (n) => (n / 1024 / 1024).toFixed(2);
  NOTE(`번들 ${MB(bundle)}MB · 파일 ${files.length - files.filter(isOndemand).length}개`);
  NOTE(`온디맨드(${PERF.ONDEMAND_DIRS.join(', ')}) ${MB(ondemand)}MB · 파일 ${files.filter(isOndemand).length}개`);
  if (bundle > PERF.TOTAL_BYTES) FAIL(`번들 ${MB(bundle)}MB > ${(PERF.TOTAL_BYTES / 1024 / 1024).toFixed(0)}MB`);
  if (ondemand > PERF.ONDEMAND_BYTES) FAIL(`온디맨드 ${MB(ondemand)}MB > ${(PERF.ONDEMAND_BYTES / 1024 / 1024).toFixed(0)}MB`);

  const srv = await serve();
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // 첫 화면 → 첫 문제까지 실제로 «전송된» 바이트(gzip 기준)
  let transferred = 0;
  const seen = new Set();
  page.on('response', async (r) => {
    if (seen.has(r.url())) return;
    seen.add(r.url());
    try {
      const body = await r.body();
      const enc = r.headers()['content-encoding'];
      transferred += enc ? body.length : zlib.gzipSync(body).length;
    } catch { /* 본문 없는 응답 */ }
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const t0 = Date.now();
    while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
  });
  await page.click('.subject-chip >> nth=0');
  await page.click('#btn-play');   // v2: 첫 화면 주 단추(범위 화면 없음)
  await page.waitForFunction(() => window.__SMOKE__.app.core && window.__SMOKE__.app.core.phase === 'question');
  await page.waitForTimeout(600);

  NOTE(`첫 문제까지 전송량(gzip) ${(transferred / 1024).toFixed(0)}KB`);
  // 🔴 온디맨드가 «온디맨드로 남아 있는가»를 직접 잰다 — 어딘가에서 preload 로 새면
  //    분리 예산은 그 순간 거짓말이 된다.
  const leaked = [...seen].filter((u) => PERF.ONDEMAND_DIRS.some((d) => u.includes(`/${d}/`)));
  if (leaked.length) FAIL(`첫 문제 전에 온디맨드 파일을 ${leaked.length}건 받았다 — preload 로 새고 있다: ${leaked[0]}`);
  else NOTE(`온디맨드 파일은 첫 문제 전에 0건 — 필요할 때만 받는다`);
  if (transferred > PERF.INITIAL_GZIP_BYTES) {
    FAIL(`초기 전송량 ${(transferred / 1024 / 1024).toFixed(2)}MB > ${(PERF.INITIAL_GZIP_BYTES / 1024 / 1024).toFixed(0)}MB`);
  }

  // ── ② 최악 장면 P95 ────────────────────────────────────
  // 🔴 한 번만 재면 안 된다 — 호스트 부하가 섞여 «코드를 안 바꿨는데» 32~66ms 사이를 오간다.
  //    노이즈는 시간을 «더하기만» 하므로, 여러 번 재서 **가장 빠른 회차**가 코드의 실제 비용에
  //    가장 가깝다(벤치마킹 표준). 판정은 그 값으로 하고, 흔들림 폭은 로그에 남겨 눈으로 본다.
  const measure = () => page.evaluate(async (frames) => {
    const app = window.__SMOKE__.app;
    const world = app.scene;
    // 🔴 최악 장면을 «만든다» — 층 전환 + 3갈래 등장 + 파티클 + 하늘 전환 + HUD 갱신 동시.
    app.core.floor = 61;
    const marks = [];
    let worstScene = false;
    let maxDraw = 0;
    const renderer = window.__SMOKE__.game.renderer;

    // 🔴 renderer.drawCount 는 «Canvas 렌더러 전용»이다(라이브러리 소스 확인).
    //    WebGL 에서는 항상 undefined → 0 이 되어 «검사 0건»이 «통과»로 위장된다.
    //    그래서 GL 호출을 직접 센다. 이건 어느 렌더러에서도 참인 계측이다.
    let glCalls = 0;
    const gl = renderer.gl;
    let restore = null;
    if (gl && typeof gl.drawElements === 'function') {
      const de = gl.drawElements.bind(gl);
      const da = gl.drawArrays.bind(gl);
      gl.drawElements = (...a) => { glCalls += 1; return de(...a); };
      gl.drawArrays = (...a) => { glCalls += 1; return da(...a); };
      restore = () => { gl.drawElements = de; gl.drawArrays = da; };
    }

    await new Promise((resolve) => {
      let n = 0;
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        marks.push(now - last);
        last = now;
        // 매 프레임 부하를 실제로 건다
        world.showRow(3);
        world.celebrate();
        world.stumble(0, 2);
        world.targetScrollY += 46;
        app.updateHud();
        app.updateTimer();
        worstScene = true;
        if (glCalls > maxDraw) maxDraw = glCalls;
        glCalls = 0;
        if (++n >= frames) resolve(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    if (restore) restore();
    marks.sort((a, b) => a - b);
    const p = (f) => marks[Math.min(marks.length - 1, Math.floor(marks.length * f))];
    return { worstScene, frames: marks.length, p50: p(0.5), p95: p(0.95), max: marks[marks.length - 1], maxDraw, glInstrumented: !!restore };
  }, FRAMES);

  const runs = [];
  for (let i = 0; i < 3; i++) runs.push(await measure());
  const perf = runs.reduce((a, b) => (b.p95 < a.p95 ? b : a));
  // 🔴 드로우콜은 «최악»을 봐야 한다 — 시간과 달리 노이즈가 아니라 구조라서, 최속 회차만 보면
  //    다른 회차에서 튄 값을 놓친다. 시간은 최속, 개수는 최대 — 축이 다르면 집계도 달라야 한다.
  perf.maxDraw = Math.max(...runs.map((r) => r.maxDraw));
  const spread = `${Math.min(...runs.map((r) => r.p95)).toFixed(1)}~${Math.max(...runs.map((r) => r.p95)).toFixed(1)}ms`;

  // 「최악 장면에서 쟀다」를 먼저 단언한다
  if (!perf.worstScene) FAIL('최악 장면 플래그가 안 찍혔다 — 조용한 장면을 잰 것이다(측정 무효)');
  if (perf.frames < FRAMES * 0.9) FAIL(`프레임 표본 ${perf.frames} < ${Math.floor(FRAMES * 0.9)} — 측정 무효`);
  NOTE(`최악 장면 worst-scene=true · 프레임 ${perf.frames} · P50 ${perf.p50.toFixed(1)}ms · P95 ${perf.p95.toFixed(1)}ms(3회 중 최속, 관측 폭 ${spread}) · 최대 ${perf.max.toFixed(1)}ms`);
  NOTE(`드로우콜(GL draw 호출) 프레임 최대 ${perf.maxDraw}`);
  // 「0 이라서 통과」를 막는다 — 계측이 안 붙었으면 그건 검사 0건이지 통과가 아니다.
  if (!perf.glInstrumented) FAIL('GL 드로우 계측을 붙이지 못했다 — 드로우콜 검사 미실행(측정 무효)');
  else if (perf.maxDraw === 0) FAIL('드로우콜이 0으로 측정됐다 — 아무것도 안 그렸거나 계측이 새고 있다');

  // headless(SwiftShader)는 실기기가 아니다 — 여기서는 «구조 경고선»만 본다.
  if (perf.p95 > PERF.P95_MOBILE_MS * 2) {
    FAIL(`headless P95 ${perf.p95.toFixed(1)}ms > ${(PERF.P95_MOBILE_MS * 2).toFixed(0)}ms — 구조적으로 무거운 프레임이 있다`);
  }
  if (perf.maxDraw > PERF.DRAWCALL_WARN) {
    FAIL(`드로우콜 ${perf.maxDraw} > 경고선 ${PERF.DRAWCALL_WARN}`);
  }

  await browser.close();
  srv.close();

  console.log('\n── 성능·번들 게이트 (D25) ───────────────────────');
  for (const n of notes) console.log('  · ' + n);
  console.log('  ⚠️ headless 프레임 시간은 실기기 성능이 아니다 — 최종 P95 는 참조 기기에서 다시 잰다(GDD §1-9).');
  // 🔴 P95 를 «실행 간 비교»에 쓰지 마라. 2026-09-04 실측: 코드를 한 줄도 안 바꾸고 같은 커밋을
  //    반복 측정했더니 32.3 / 43.7 / 48.8ms 였고, 예전 로그의 17.8ms 도 같은 코드였다.
  //    이 값은 호스트 부하를 재는 것에 가깝다 — 회귀로 읽으면 없는 버그를 쫓게 된다(실제로 쫓았다).
  //    그래서 3회 재서 최속 회차로 판정한다. 한 번만 재던 시절엔 66.1ms 가 나와 한계선 68ms 를
  //    스칠 뻔했다 — 무작위로 빨간불이 켜지는 게이트는 사람이 게이트를 안 믿게 만든다.
  //    실행 간 비교가 가능한 것은 P50(16.7ms 로 안정)과 드로우콜뿐이다.
  console.log('  ⚠️ P95 절대값은 호스트 부하를 같이 잰다 — 실행 간 비교 금지. 비교는 P50·드로우콜로.');
  if (fails.length) {
    console.log('\n❌ 성능·번들 게이트 FAIL');
    for (const f of fails) console.log('  ✖ ' + f);
    process.exit(1);
  }
  console.log('\n✅ 성능·번들 게이트 PASS');
}

main().catch((e) => {
  console.error('❌ 도구가 죽었다(미실행):', e);
  process.exit(3);
});
