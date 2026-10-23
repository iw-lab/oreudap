#!/usr/bin/env node
/**
 * 「영어를 읽어 준다」 게이트 (D32).
 *
 * 🔴 두 가지가 동시에 참이어야 한다 — 하나만 보면 반대쪽이 조용히 깨진다.
 *  ① 영어→뜻 문제는 낱말을 «보여 주면서» 읽어 준다(파일이 실제로 전송된다).
 *  ② 뜻→영어 문제는 «풀기 전에» 절대 읽지 않는다 — 읽으면 정답을 그대로 알려 주는 것이다.
 *     이건 D29(실명 유출)와 같은 종류의 검사다: 새면 안 되는 것이 새는가를 직접 잰다.
 *  ③ 파일이 없는 264개 낱말은 브라우저 음성으로 넘어간다(무음이 되지 않는다).
 *  ④ 낱말 파일은 첫 문제 전에 받지 않는다(온디맨드가 온디맨드로 남아 있는가 — D25 와 짝).
 *  ⑤ [D32b] 국어 어휘는 «한국어로» 읽고, 영어 낱말 파일 경로를 절대 타지 않는다.
 *
 *   node tools/qa-voice.mjs [--dir dist] [--port 8195]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SAY_WORDS } from '../src/data/say-index.js';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8195));
const ROUNDS = Number(opt('--rounds', 24));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

const fails = [];
const FAIL = (m) => fails.push(m);

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

async function main() {
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => FAIL(`런타임 오류: ${e.message}`));

  const said = [];
  const sayReqs = [];
  page.on('request', (r) => { if (r.url().includes('/assets/say/')) sayReqs.push(r.url().split('/').pop()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const t0 = Date.now();
    while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
    // 🔴 이 게이트들은 «이미 놀아 본 아이»를 잰다 — 첫 판 안내(D35)는 판을 멈춰 세우므로
    //    여기서 켜 두면 봇이 한 층도 못 오른다. 첫 판 경험 자체는 qa-howto.mjs 가 따로 잰다.
    window.__SMOKE__.app.data.seenHow = true;
  });

  // ④ 첫 문제 전에는 낱말 파일이 오지 않는다
  if (sayReqs.length) FAIL(`타이틀에서 낱말 파일을 ${sayReqs.length}건 받았다 — 온디맨드가 아니다`);

  // 🔴 speechSynthesis 는 headless 에 없다 — 있는 척 심어서 «불렸는가»를 잰다.
  //    없는 채로 두면 fallback 경로가 실행되지 않아 ③ 을 영영 못 재고, 그게 «통과»로 위장된다.
  // 🔴 `window.speechSynthesis = ...` 는 조용히 «무시된다» — Window 의 읽기 전용 접근자라
  //    비엄격 모드에서 대입이 예외 없이 실패한다. 그래서 defineProperty 로 덮는다.
  //    이걸 몰랐을 때 「폴백이 끊겼다」는 오진이 나왔다 — 끊긴 것은 계측기였다.
  await page.evaluate(() => {
    window.__TTS__ = [];
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true, writable: true, value: function (t) { this.text = t; },
    });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      // 🔴 텍스트뿐 아니라 «언어»도 담는다. 한글을 영어 음성으로 읽는 결함은 소리를 들어야만
      //    알 수 있고, 게이트는 소리를 못 듣는다 — u.lang 이 그 결함의 유일한 기계 관측점이다.
      value: { speak: (u) => window.__TTS__.push({ t: u.text, lang: u.lang }), cancel: () => {} },
    });
    if (window.speechSynthesis.speak.toString().includes('__TTS__') === false) {
      throw new Error('speechSynthesis 를 덮지 못했다 — 폴백 측정이 불가능하다');
    }
  });

  // 🔴 startRun 은 인자를 받지 않는다 — 과목은 app.subject 다. 인자를 주면 조용히 무시되고
  //    기본 과목(구구단)이 돌아 «영어 문항 0개»인 채로 측정이 성립한 척한다(실제로 그랬다).
  await page.evaluate(() => { window.__SMOKE__.app.subject = 'words34'; window.__SMOKE__.app.startRun(); /* v3: 발음을 재는 검사 — 부하로 시간초과가 나도 «한 번 틀리면 추락»으로 표본이 끊기지 않게 */ window.__SMOKE__.app.core.hearts = 99; });
  await page.waitForFunction(() => {
    const a = window.__SMOKE__.app;
    return a.core && a.core.phase === 'question';
  }, null, { timeout: 15000 });

  for (let i = 0; i < ROUNDS; i++) {
    await page.waitForFunction(() => {
      const c = window.__SMOKE__.app.core;
      return c && c.phase === 'question' && !c.answered;
    }, null, { timeout: 8000 }).catch(() => {});
    const st = await page.evaluate(() => {
      const a = window.__SMOKE__.app;
      const c = a.core;
      if (!c || c.phase !== 'question') return null;
      if (!c.question.word) throw new Error('문항에 word 가 없다 — 영어 과목이 아니거나 배선이 끊겼다');
    return { word: c.question.word, dir: c.question.dir, ans: c.question.answerIndex,
               beforeLast: a.voice.report().last, tts: window.__TTS__.length };
    });
    if (!st) break;
    await page.waitForTimeout(120);
    const mid = await page.evaluate(() => ({
      last: window.__SMOKE__.app.voice.report().last, tts: window.__TTS__.slice(),
    }));
    said.push({ ...st, spoken: mid.last, ttsAll: mid.tts });

    await page.evaluate((idx) => {
      const c = document.querySelectorAll('.choice')[idx];
      c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      c.click();
    }, st.ans);
    await page.waitForTimeout(320);
  }

  const w2k = said.filter((s) => s.dir === 'w2k');
  const k2w = said.filter((s) => s.dir === 'k2w');
  if (!w2k.length || !k2w.length) FAIL(`방향 표본 부족(w2k ${w2k.length} · k2w ${k2w.length}) — 측정 무효`);

  // ① 영어를 보여 주는 문제는 그 자리에서 읽는다
  for (const s of w2k) {
    if (!s.spoken || s.spoken.word !== String(s.word).toLowerCase()) {
      FAIL(`«${s.word}» 를 보여 주면서 읽지 않았다(마지막 발음: ${s.spoken ? s.spoken.word : '없음'})`);
      break;
    }
  }
  // ② 뜻→영어 문제는 풀기 전에 읽지 않는다
  for (const s of k2w) {
    const leaked = s.spoken && s.spoken.word === String(s.word).toLowerCase()
      && (!s.beforeLast || s.beforeLast.word !== s.spoken.word);
    if (leaked) { FAIL(`«${s.word}» 를 풀기 전에 읽었다 — 정답을 알려 주는 것이다`); break; }
  }
  // ③ 파일 없는 낱말은 브라우저 음성으로
  const viaFile = said.filter((s) => s.spoken && s.spoken.via === 'file').length;
  const viaTts = said.filter((s) => s.spoken && s.spoken.via === 'tts').length;
  const noFile = said.filter((s) => !SAY_WORDS.has(String(s.word).toLowerCase()));
  const noFileSilent = noFile.filter((s) => s.dir === 'w2k' && (!s.spoken || s.spoken.via !== 'tts'));
  if (noFileSilent.length) {
    FAIL(`파일 없는 낱말 ${noFileSilent.length}개가 무음이었다(예: ${noFileSilent[0].word}) — 폴백이 끊겼다`);
  }
  if (!sayReqs.length) FAIL('낱말 파일이 한 건도 전송되지 않았다 — 파일 경로가 죽어 있다(측정 무효)');

  console.log('\n── 영어를 읽어 준다 (D32) ──');
  console.log(`  · 문항 ${said.length}개 (영어→뜻 ${w2k.length} · 뜻→영어 ${k2w.length})`);
  console.log(`  · 파일 발음 ${viaFile}회 · 브라우저 음성 ${viaTts}회 · 전송된 낱말 파일 ${new Set(sayReqs).size}개`);
  console.log(`  · 파일 없는 낱말 ${noFile.length}개 — 무음 0`);
  console.log(`  · 뜻→영어 문제에서 «풀기 전 발음» 0건`);
  console.log(`  · 낱말 파일은 타이틀에서 0건 — 필요할 때만 받는다`);

  // ── D32b: 국어 어휘는 한국어로 읽는다 ─────────────────────────
  //
  // 🔴 유닛 테스트는 «문항이 lang:'ko' 를 달고 나오는가»까지만 본다. 그 값을 app.js 가
  //    voice.speak 에 실제로 넘기는지는 배선이고, 배선은 브라우저에서만 관측된다 —
  //    인자를 빠뜨리면 기본값 'en' 이 조용히 먹어 한글을 영어 음성으로 읽는다(고장이 아니라 오답).
  const koBefore = sayReqs.length;
  await page.evaluate(() => {
    const a = window.__SMOKE__.app;
    a.quitRun();
    window.__TTS__.length = 0;
    a.subject = 'korean34';
    a.startRun(); /* v3: 발음을 재는 검사 — 부하로 시간초과가 나도 «한 번 틀리면 추락»으로 표본이 끊기지 않게 */ window.__SMOKE__.app.core.hearts = 99;
  });
  await page.waitForFunction(() => {
    const a = window.__SMOKE__.app;
    return a.core && a.core.phase === 'question';
  }, null, { timeout: 15000 }).catch(() => {});

  const koSaid = [];
  for (let i = 0; i < 10; i++) {
    const st = await page.evaluate(() => {
      const c = window.__SMOKE__.app.core;
      if (!c || c.phase !== 'question') return null;
      return { word: c.question.word, dir: c.question.dir, lang: c.question.lang, ans: c.question.answerIndex };
    });
    if (!st) break;
    await page.waitForTimeout(120);
    const mid = await page.evaluate(() => ({
      last: window.__SMOKE__.app.voice.report().last, tts: window.__TTS__.slice(),
    }));
    koSaid.push({ ...st, spoken: mid.last, ttsAll: mid.tts });
    await page.evaluate((idx) => {
      const c = document.querySelectorAll('.choice')[idx];
      if (c) c.click();
    }, st.ans);
    await page.waitForTimeout(300);
  }

  if (koSaid.length < 5) {
    FAIL(`국어 어휘 문항 ${koSaid.length}개 — 표본 부족으로 한국어 발음을 측정하지 못했다`);
  } else {
    if (koSaid.some((s) => s.lang !== 'ko')) FAIL('국어 문항이 lang:"ko" 를 달고 나오지 않는다');
    const utter = koSaid.flatMap((s) => s.ttsAll);
    const wrongLang = utter.filter((u) => u && u.lang !== 'ko-KR');
    if (!utter.length) FAIL('국어 어휘를 한 번도 읽지 않았다 — 무음이면 낱말 학습이 반쪽이다');
    if (wrongLang.length) FAIL(`국어 낱말 ${wrongLang.length}건을 «${wrongLang[0].lang}» 로 읽었다 — 한글을 영어 음성으로 읽는다`);
    if (koSaid.some((s) => s.spoken && s.spoken.via === 'file')) FAIL('국어 낱말이 영어 발음 파일 경로를 탔다');
    const koReq = sayReqs.slice(koBefore);
    if (koReq.length) FAIL(`국어 판에서 낱말 파일 ${koReq.length}건을 받았다(예: ${koReq[0]}) — 있을 리 없는 요청이다`);
    console.log(`  · 국어 어휘 ${koSaid.length}문항 · 발화 ${utter.length}회 전부 ko-KR · 낱말 파일 요청 0건`);
  }

  await browser.close();
  srv.close();

  if (fails.length) {
    console.error('\n❌ 발음 게이트 FAIL');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log('\n✅ 발음 PASS');
}

main().catch((e) => { console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e); process.exit(3); });
