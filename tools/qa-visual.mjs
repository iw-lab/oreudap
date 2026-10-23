#!/usr/bin/env node
/**
 * 시각 QA — 상태별 화면 전수 캡처(D15) + 잴 수 있는 불변식 단언(D16).
 *
 * 🔴 크기·위치만 재면 거짓 통과한다. 중심점 elementFromPoint 히트테스트가
 *    「누를 수 있다」의 유일한 증거다. 대비는 알파가 합성된 «실제 픽셀»로 잰다.
 *
 *   node tools/qa-visual.mjs [--dir dist] [--out qa/shots] [--port 8188]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행(도구가 죽음)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const OUT = path.resolve(opt('--out', 'qa/shots'));
const PORT = Number(opt('--port', 8188));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

const fails = [];
const notes = [];
const FAIL = (m) => fails.push(m);
const NOTE = (m) => notes.push(m);
const shots = [];

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

const lum = ([r, g, b]) => {
  const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const VIEWPORTS = {
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  small: { width: 360, height: 640, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  landscape: { width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  tall: { width: 540, height: 960, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};

/** 화면 안에서 가장 밝은 픽셀과 가장 어두운 픽셀로 대비를 잰다(알파 합성 결과) */
function contrastInRect(png, dpr, rect) {
  let bright = [0, 0, 0];
  let dark = [255, 255, 255];
  const at = (x, y) => {
    const i = (Math.round(y * dpr) * png.width + Math.round(x * dpr)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  for (let y = rect.top + 8; y < rect.top + rect.height - 8; y += 2) {
    for (let x = rect.left + 8; x < rect.left + rect.width - 8; x += 2) {
      const p = at(x, y);
      if (lum(p) > lum(bright)) bright = p;
      if (lum(p) < lum(dark)) dark = p;
    }
  }
  return { ratio: contrast(bright, dark), bright, dark };
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const browser = await chromium.launch();

  const withPage = async (vp, fn) => {
    const ctx = await browser.newContext({ ...VIEWPORTS[vp], locale: 'ko-KR' });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
    page.on('requestfailed', (r) => errs.push(`requestfailed: ${r.url()}`));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const t0 = Date.now();
      while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
      await window.__SMOKE__.ready;
    // 🔴 이 게이트들은 «이미 놀아 본 아이»를 잰다 — 첫 판 안내(D35)는 판을 멈춰 세우므로
    //    여기서 켜 두면 봇이 한 층도 못 오른다. 첫 판 경험 자체는 qa-howto.mjs 가 따로 잰다.
    window.__SMOKE__.app.data.seenHow = true;
    });
    try { await fn(page, vp); } finally { await ctx.close(); }
    return errs;
  };

  // 🔴 「화면에 소스가 찍혔는가」 — 실제로 났다(2026-09-05: 과목 설명이 함수인데 그대로 append 돼
  //    타이틀에 «()=>`3·4학년 기본 낱말 ${L.length}개`» 가 보였다). 캡처는 15장 남겼지만
  //    아무도 «글자 내용»을 읽지 않았으므로 게이트는 전부 초록불이었다.
  //    문자열화 사고의 지문 — 화면 글자에 이것들이 보이면 코드가 새어 나온 것이다.
  const CODE_LEAK = [/\$\{/, /=>/, /\[object /, /\bundefined\b/, /\bNaN\b/, /function\s*\(/];
  const scanText = async (page, name) => {
    const bad = await page.evaluate(() => {
      const out = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const el = n.parentElement;
        if (!el || el.closest('[hidden]') || !el.offsetParent) continue;
        const t = n.textContent.trim();
        if (t) out.push(t);
      }
      return out;
    });
    for (const t of bad) {
      for (const re of CODE_LEAK) {
        if (re.test(t)) { FAIL(`[${name}] 화면에 코드가 찍혔다: «${t.slice(0, 70)}»`); break; }
      }
    }
  };

  const snap = async (page, name) => {
    await scanText(page, name);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    shots.push(name);
  };

  const measureChoices = (page) => page.evaluate(() => {
    const cs = [...document.querySelectorAll('.choice')];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const card = document.querySelector('#qcard').getBoundingClientRect();
    return {
      n: cs.length,
      items: cs.map((c) => {
        const r = c.getBoundingClientRect();
        const txt = c.querySelector('.txt');
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          w: r.width, h: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          fs: parseFloat(getComputedStyle(txt).fontSize),
          // 🔴 «잘렸는가»를 직접 잰다. 예전엔 white-space:nowrap + ellipsis 라
          //    「필요하다」가 «필요하…» 로 나왔고, 그러면 문제가 성립하지 않는다.
          clipW: txt.scrollWidth - txt.clientWidth,
          clipH: txt.scrollHeight - txt.clientHeight,
          text: txt.textContent,
          text: txt.textContent.trim(),
          hit: !!(el && (el === c || c.contains(el))),
          clipped: txt.scrollWidth > txt.clientWidth + 1,
        };
      }),
      vw, vh, cardBottom: card.bottom,
      bodyScrollX: document.body.scrollWidth > vw + 1,
    };
  });

  const assertChoices = (m, tag) => {
    if (m.n < 2) { FAIL(`[${tag}] 선택지가 ${m.n}개 — 2개 이상이어야 한다(측정 무효)`); return; }
    m.items.forEach((c, i) => {
      if (c.h < 44) FAIL(`[${tag}] 선택지 ${i} 높이 ${c.h.toFixed(0)}px < 44px`);
      if (c.w < 44) FAIL(`[${tag}] 선택지 ${i} 너비 ${c.w.toFixed(0)}px < 44px`);
      if (c.fs < 28) FAIL(`[${tag}] 선택지 ${i} 글자 ${c.fs.toFixed(1)}px < 28px`);
      if (c.clipW > 1 || c.clipH > 1) {
        FAIL(`[${tag}] 선택지 «${c.text}» 가 상자에 잘렸다 (가로 ${c.clipW}px · 세로 ${c.clipH}px 넘침)`);
      }
      if (!c.text) FAIL(`[${tag}] 선택지 ${i} 텍스트가 비었다`);
      if (c.clipped) FAIL(`[${tag}] 선택지 ${i} 텍스트가 잘린다 ("${c.text}")`);
      if (!c.hit) FAIL(`[${tag}] 선택지 ${i} 중심점이 눌리지 않는다 — 보이지만 못 누른다`);
      if (c.left < 0 || c.top < 0 || c.right > m.vw || c.bottom > m.vh) {
        FAIL(`[${tag}] 선택지 ${i} 가 화면 밖으로 나갔다`);
      }
      if (c.top < m.cardBottom) FAIL(`[${tag}] 선택지 ${i} 가 문제 카드와 겹친다`);
    });
    if (m.bodyScrollX) FAIL(`[${tag}] 가로 스크롤이 생겼다`);
    NOTE(`[${tag}] 선택지 ${m.n}개 · 최소높이 ${Math.min(...m.items.map((c) => c.h)).toFixed(0)}px `
       + `· 최소글자 ${Math.min(...m.items.map((c) => c.fs)).toFixed(1)}px`);
  };

  // ── ① 세로 기본 화면: 상태 전수 + 측정 ─────────────────
  const mainErrs = await withPage('phone', async (page) => {
    await snap(page, '01-title');
    await page.click('.subject-chip >> nth=0');
    await page.waitForTimeout(150);
    await snap(page, '02-subject-gugudan');

    await page.click('#btn-play');   // v2: 첫 화면 주 단추(범위 화면 없음)
    // v3(한 번 틀리면 추락): 이 검사는 «모양»을 잰다. 스크린샷·대비 측정이 부하로 길어지면 시간초과 한 번에
    //    판이 추락해 창이 화면을 덮는다 — 하트를 넉넉히 줘서 판을 세워 둔다(추락 흐름은 qa-play·qa-modes 가 잰다)
    await page.evaluate(() => { window.__SMOKE__.app.core.hearts = 99; });
    await page.waitForTimeout(500);
    await snap(page, '03-play-2way');

    const m2 = await measureChoices(page);
    assertChoices(m2, '2갈래');

    // 대비 — 실제 렌더 픽셀
    const rect = await page.evaluate(() => {
      const r = document.querySelector('.choice').getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const buf = await page.screenshot();
    const png = PNG.sync.read(buf);
    const dpr = png.width / (await page.evaluate(() => window.innerWidth));
    const c1 = contrastInRect(png, dpr, rect);
    NOTE(`선택지 대비 ${c1.ratio.toFixed(2)}:1`);
    if (c1.ratio < 4.5) FAIL(`선택지 대비 ${c1.ratio.toFixed(2)}:1 < 4.5:1`);

    const qrect = await page.evaluate(() => {
      const r = document.querySelector('#qcard').getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const c2 = contrastInRect(png, dpr, qrect);
    NOTE(`문제 카드 대비 ${c2.ratio.toFixed(2)}:1`);
    if (c2.ratio < 4.5) FAIL(`문제 카드 대비 ${c2.ratio.toFixed(2)}:1 < 4.5:1`);

    const qfs = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.qtext')).fontSize));
    NOTE(`문제 글자 ${qfs.toFixed(1)}px`);
    if (qfs < 28) FAIL(`문제 글자 ${qfs.toFixed(1)}px < 28px`);

    const pause = await page.evaluate(() => {
      const r = document.querySelector('#btn-pause').getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    if (pause.w < 44 || pause.h < 44) FAIL(`일시정지 버튼 ${pause.w}×${pause.h} < 44px`);

    // 오답 하이라이트 — 문항이 «답할 수 있는» 상태일 때 누른다(호스트 부하로 앞 연출이 늦으면 입력이 무시돼 0개로 거짓 FAIL)
    // v3: 앞 장면을 찍는 동안 시간초과가 나면 «한 번 틀리면 추락»이라 다시 일어서기 창에서 멈춘다 — 일으켜 세운다
    await page.waitForFunction(() => { const a = window.__SMOKE__.app; const c = a.core; if (c.phase === 'down') a.revive(); return c.phase === 'question' && !c.answered; }, null, { timeout: 15000 });
    const wrongAt = await page.evaluate(() => {
      const app = window.__SMOKE__.app;
      // 🔴 앞 장면을 찍는 동안(부하 50+) 시간초과로 하트가 줄어 있으면 이 오답이 «게임 끝»이 되어 보기 자체가 사라진다 — 하이라이트를 재려는 것이지 하트를 재는 게 아니다
      app.core.hearts = 99;   // v3 하트 1개 — 찍는 동안의 시간초과로 판이 끝나지 않게 넉넉히
      const q = app.core.question;
      app.press((q.answerIndex + 1) % q.choices.length);
      return { phase: app.core.phase, last: app.core.lastResult && app.core.lastResult.type };
    });
    await page.waitForTimeout(300);
    // 🔴 재고 나서 찍는다 — 스크린샷이 부하에서 1초+ 걸리면 그사이 다음 문항이 떠 하이라이트가 «0개»로 거짓 FAIL(2026-10-13)
    const marked = await page.evaluate(() => ({
      correct: document.querySelectorAll('.choice.is-correct').length,
      wrong: document.querySelectorAll('.choice.is-wrong').length,
      feedback: document.querySelector('#feedback').textContent,
    }));
    await snap(page, '04-play-wrong-highlight');
    if (marked.correct !== 1) FAIL(`오답 뒤 정답 하이라이트가 ${marked.correct}개 — 1개여야 한다 (누른 직후 ${JSON.stringify(wrongAt)})`);
    if (!marked.feedback.includes('정답은')) FAIL(`오답 피드백에 정답이 안 보인다: "${marked.feedback}"`);

    // 3갈래
    await page.evaluate(() => {
      const app = window.__SMOKE__.app;
      app.core.floor = 61;
      app.core.hearts = 99;
      // 🔴 스크린샷·대비 측정이 길어 오답 해결 국면이 이미 지나 다음 문항(2갈래)이 떠 있을 수 있다 —
      //    «해결 국면이 지금 끝난다»로 명시해 층 61 기준의 새 문항을 «반드시» 만들게 한다(시간에 기대지 않는다)
      app.core.phase = 'resolve';
      app.core.answered = true;
      app.core.resolveUntil = app.core.t;
      app.step(20);
    });
    await page.waitForTimeout(350);
    const m3 = await measureChoices(page);
    if (m3.n !== 3) FAIL(`층 61에서 갈래가 ${m3.n}개 — 3개여야 한다`);
    else assertChoices(m3, '3갈래');
    await snap(page, '05-play-3way');

    // v3: 3갈래를 찍는 사이 시간초과로 추락했으면 일으켜 세운다(추락 창이 일시정지 단추를 덮는다)
    await page.waitForFunction(() => { const a = window.__SMOKE__.app; const c = a.core; if (c.phase === 'down') { if (c.revivesLeft <= 0) c.revivesLeft = 1; a.revive(); } return c.phase === 'question' || c.phase === 'resolve'; }, null, { timeout: 15000 });
    await page.click('#btn-pause');
    await page.waitForTimeout(180);
    await snap(page, '06-pause');
    await page.click('#btn-resume');
    await page.waitForTimeout(120);

    // 추락 → (다시 일어서기 창) → 결과 보기 → 결과
    await page.evaluate(() => {
      const app = window.__SMOKE__.app;
      app.core.hearts = 1;
      for (let i = 0; i < 8 && app.core.phase !== 'over'; i++) {
        if (app.core.phase === 'down') { app.giveUp(); break; }
        const q = app.core.question;
        if (q && app.core.phase === 'question') app.press((q.answerIndex + 1) % q.choices.length);
        app.step(1500);
      }
    });
    await page.waitForTimeout(350);
    await snap(page, '07-result');
    const onResult = await page.evaluate(() => document.querySelector('#screen-result').classList.contains('active'));
    if (!onResult) FAIL('추락해 «결과 보기»를 했는데 결과 화면이 뜨지 않았다');

    await page.click('#screen-result [data-go="title"]');
    await page.waitForTimeout(120);
    await page.click('[data-go="notes"]');
    await page.waitForTimeout(200);
    await snap(page, '08-notes');
    const noteRows = await page.evaluate(() => document.querySelectorAll('.note-row').length);
    if (noteRows === 0) FAIL('틀린 문제가 있는데 오답노트가 비었다');
    NOTE(`오답노트 ${noteRows}행`);

    await page.click('#screen-notes [data-go="title"]');
    await page.click('[data-go="collection"]');
    await page.waitForTimeout(400);
    await snap(page, '09-collection');
    const shopImgs = await page.evaluate(() => [...document.querySelectorAll('.shop-item img')]
      .map((i) => ({ ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') })));
    const broken = shopImgs.filter((i) => !i.ok);
    if (broken.length) FAIL(`컬렉션 이미지 ${broken.length}개가 안 뜬다: ${broken.slice(0, 2).map((b) => b.src).join(', ')}`);

    await page.click('#screen-collection [data-go="title"]');
    await page.click('[data-go="settings"]');
    await page.waitForTimeout(200);
    await snap(page, '10-settings');
    const switches = await page.evaluate(() => [...document.querySelectorAll('.switch')].map((s) => {
      const r = s.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }));
    for (const [i, s] of switches.entries()) {
      if (s.h < 44 || s.w < 44) FAIL(`설정 스위치 ${i} ${s.w}×${s.h} < 44px`);
    }
  });
  if (mainErrs.length) FAIL(`콘솔 에러 ${mainErrs.length}건: ${mainErrs.slice(0, 3).join(' | ')}`);

  // ── ② 다른 화면 크기 ────────────────────────────────────
  for (const vp of ['small', 'landscape', 'tall', 'desktop']) {
    const errs = await withPage(vp, async (page) => {
      await page.click('.subject-chip >> nth=0');
      await page.click('#btn-play');   // v2: 첫 화면 주 단추(범위 화면 없음)
      await page.waitForTimeout(500);
      await snap(page, `11-${vp}`);
      assertChoices(await measureChoices(page), vp);
    });
    if (errs.length) FAIL(`[${vp}] 콘솔 에러 ${errs.length}건: ${errs.slice(0, 2).join(' | ')}`);
  }

  // ── ③ 영단어 과목(긴 텍스트) ────────────────────────────
  const wordErrs = await withPage('small', async (page) => {
    await page.click('.subject-chip >> nth=2');
    await page.click('#btn-play');   // v2: 첫 화면 주 단추(범위 화면 없음)
    await page.waitForTimeout(500);
    await snap(page, '12-play-words');
    assertChoices(await measureChoices(page), '영단어');
  });
  if (wordErrs.length) FAIL(`[영단어] 콘솔 에러 ${wordErrs.length}건: ${wordErrs.slice(0, 2).join(' | ')}`);

  await browser.close();
  srv.close();

  console.log('\n── 시각 QA ──────────────────────────────────────');
  for (const n of notes) console.log('  · ' + n);
  console.log(`  · 캡처 ${shots.length}장 → ${path.relative(process.cwd(), OUT)}`);
  if (shots.length < 12) FAIL(`캡처 ${shots.length}장 — 상태 전수(12장 이상)에 못 미친다. 측정 무효`);
  if (fails.length) {
    console.log('\n❌ 시각 QA FAIL');
    for (const f of fails) console.log('  ✖ ' + f);
    process.exit(1);
  }
  console.log('\n✅ 시각 QA PASS');
}

main().catch((e) => {
  console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e);
  process.exit(3);
});
