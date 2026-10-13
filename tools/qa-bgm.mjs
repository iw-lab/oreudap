#!/usr/bin/env node
/**
 * 「올라갈수록 조여드는 BGM」 게이트 (D31).
 *
 * 🔴 왜 있나: 사용자 요구는 «긴장되고 빠르게» 두 축이다. 둘 중 하나만 살아 있어도
 *    코드는 멀쩡히 돌고 콘솔은 조용하다 — 재지 않으면 조용히 죽는 종류의 기능이다.
 *
 *  ① 한 단계 «안»에서 재생속도가 층에 따라 오른다(= 빠르게)
 *  ② 단계 경계(balance.TIER_FLOORS)에서 트랙이 실제로 바뀐다(= 긴장) — 파일이 도착했는가까지
 *  ③ 경계에서 속도는 1.0 으로 되돌아가고, 어디서도 상한을 넘지 않는다(피치 치핑 방지)
 *  ④ 트랙을 갈아 끼운 뒤에도 소리가 «계속» 난다(크로스페이드가 무음을 만들지 않는다)
 *  ⑤ 강도 트랙은 첫 문제 전에는 받지 않는다(D25 전송량 예산 보호)
 *
 *   node tools/qa-bgm.mjs [--dir dist] [--port 8193]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { TIER_FLOORS } from '../src/core/balance.js';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8193));
const TOP = TIER_FLOORS[TIER_FLOORS.length - 1] + 3;
const RATE_MAX = 1.12;   // src/ui/sound.js 와 같은 값 — 어긋나면 ③ 이 먼저 잡는다

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
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  page.on('pageerror', (e) => { FAIL(`런타임 오류: ${e.message}`); console.error('PAGEERROR', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE', m.text()); });

  const audioReqs = [];
  page.on('request', (r) => { if (/\/assets\/audio\//.test(r.url())) audioReqs.push(r.url()); });

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const t0 = Date.now();
    while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
    // 🔴 이 게이트들은 «이미 놀아 본 아이»를 잰다 — 첫 판 안내(D35)는 판을 멈춰 세우므로
    //    여기서 켜 두면 봇이 한 층도 못 오른다. 첫 판 경험 자체는 qa-howto.mjs 가 따로 잰다.
    window.__SMOKE__.app.data.seenHow = true;
  });

  // ⑤ 판을 시작하기 «전»에는 강도 트랙이 한 바이트도 오지 않아야 한다
  const earlyLazy = audioReqs.filter((u) => /bgm-(tense|rush)/.test(u));
  if (earlyLazy.length) FAIL(`첫 문제 전에 강도 BGM 을 ${earlyLazy.length}건 받았다 — preload 에 새어 들어갔다`);

  await page.evaluate(() => { window.__SMOKE__.app.startRun('gugudan'); });
  await page.waitForFunction(() => {
    const a = window.__SMOKE__.app;
    return a.core && a.core.phase === 'question' && a.scene && a.scene.layout;
  }, null, { timeout: 15000 });

  const read = () => page.evaluate(() => {
    const a = window.__SMOKE__.app;
    return { floor: a.core ? a.core.floor : -1, ...a.sound.intensity() };
  });

  const trace = [await read()];
  let retries = 0;
  for (let i = 0; i < TOP; i++) {
    await page.waitForFunction(() => {
      const c = window.__SMOKE__.app.core;
      return c && c.phase === 'question' && !c.answered;
    }, null, { timeout: 8000 }).catch(async (e) => {
      const st = await page.evaluate(() => {
        const a = window.__SMOKE__.app;
        return { phase: a.core && a.core.phase, floor: a.core && a.core.floor,
                 hearts: a.core && a.core.hearts, screen: a.screen, snd: a.sound.failed.slice(0, 3) };
      });
      throw new Error(`${e.message} · 상태 ${JSON.stringify(st)}`);
    });
    // 🔴 «답할 수 있나» 확인과 누르기를 한 번에 한다 — 따로 왕복하면 부하(50+)에서 그 사이에 시간초과가 나
    //    정답 28회인데 27층(측정 무효)이 됐다(2026-10-13). 못 눌렀으면 이번 회차는 세지 않고 다시.
    const pressed = await page.evaluate(() => {
      const c = window.__SMOKE__.app.core;
      if (!c || c.phase !== 'question' || c.answered) return false;
      const el = document.querySelectorAll('.choice')[c.question.answerIndex];
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      el.click();
      return true;
    });
    if (!pressed) { i -= 1; if (++retries > 40) break; continue; }
    await page.waitForTimeout(320);
    trace.push(await read());
  }
  const top = trace[trace.length - 1];
  if (top.floor < TOP) FAIL(`정답 ${TOP}회인데 ${top.floor}층 — 층이 오르지 않음(측정 무효)`);

  const at = (f) => trace.filter((t) => t.floor === f).pop();

  // ① 단계 안에서 속도가 오른다
  for (let i = 0; i <= TIER_FLOORS.length; i++) {
    const from = i === 0 ? 1 : TIER_FLOORS[i - 1];
    const to = (TIER_FLOORS[i] ? TIER_FLOORS[i] - 1 : TOP);
    const a = at(from); const b = at(to);
    if (!a || !b) continue;
    if (!(b.rate > a.rate + 0.005)) {
      FAIL(`${i + 1}단계 ${from}→${to}층 재생속도 ${a.rate.toFixed(3)}→${b.rate.toFixed(3)} — 빨라지지 않는다`);
    }
  }

  // ② 경계에서 트랙이 «실제로» 바뀐다
  const KEYS = ['bgm', 'bgm-tense', 'bgm-rush'];
  const before = at(1);
  if (before && before.key !== 'bgm') FAIL(`1층 트랙이 ${before.key} — 시작은 잔잔한 곡이어야 한다`);
  for (let i = 0; i < TIER_FLOORS.length; i++) {
    const f = TIER_FLOORS[i];
    const s = at(f) || at(f + 1);
    if (!s) { FAIL(`${f}층 상태를 못 읽음 — 측정 무효`); continue; }
    if (s.tier !== i + 1) FAIL(`${f}층 강도 단계 ${s.tier} — ${i + 1} 이어야 한다`);
    if (s.key !== KEYS[i + 1]) {
      FAIL(`${f}층 트랙이 ${s.key} — «${KEYS[i + 1]}» 이어야 한다(지연 로드가 제때 도착하지 못했다)`);
    }
  }

  // ③ 경계에서 속도 초기화 · 상한 준수
  for (const f of TIER_FLOORS) {
    const s = at(f);
    if (s && s.rate > 1.02) FAIL(`${f}층 진입 속도 ${s.rate.toFixed(3)} — 경계에서 1.0 으로 돌아와야 한다`);
  }
  const fastest = Math.max(...trace.map((t) => t.rate));
  if (fastest > RATE_MAX + 1e-6) FAIL(`최고 재생속도 ${fastest.toFixed(3)} > 상한 ${RATE_MAX} — 피치가 우스워진다`);

  // ④ 갈아 끼운 뒤에도 소리가 계속 난다
  const silent = trace.slice(1).filter((t) => !t.playing);
  if (silent.length) FAIL(`재생이 끊긴 지점 ${silent.length}건(층 ${silent.map((t) => t.floor).join(',')})`);

  console.log('\n── 올라갈수록 조여드는 BGM (D31) ──');
  for (const f of [1, ...TIER_FLOORS.map((x) => x - 1), ...TIER_FLOORS, top.floor]) {
    const s = at(f);
    if (s) console.log(`  · ${String(f).padStart(3)}층  ${String(s.key).padEnd(10)} ×${s.rate.toFixed(3)}`);
  }
  console.log(`  · 강도 트랙 전송 시점 = 판 시작 이후 (첫 문제 전 0건)`);

  await browser.close();
  srv.close();

  if (fails.length) {
    console.error('\n❌ BGM 강도 게이트 FAIL');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log('\n✅ BGM 강도 PASS');
}

main().catch((e) => { console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e); process.exit(3); });
