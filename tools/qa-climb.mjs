#!/usr/bin/env node
/**
 * 「올라가는 느낌」 게이트 (D28).
 *
 * 🔴 이 게이트가 왜 있나: 14개 게이트가 전부 초록불인 채로 «점프하고 제자리»인 게임이 배포됐다.
 *    아무도 «세계가 실제로 움직이는가»를 재지 않았기 때문이다. 재지 않는 것은 지켜지지 않는다.
 *
 *  ① 캐릭터는 화면에 붙박여 있다 — 움직이는 것은 «세계»다
 *  ② 지나온 계단이 캐릭터 아래에 2개 이상 보인다(높이 체감의 물증)
 *  ③ 계단은 깊이 순으로 «서로 다른 높이»에 있다(겹쳐 있으면 계단이 아니다)
 *  ④ 배경 시차가 층마다 유의미하게 흐른다(46px/3500px = 안 보이던 옛 값 재발 방지)
 *  ⑤ 10층 «금 발판»이 실제로 남는다
 *  ⑥ 도약 «중»에는 점프 자세 그림으로, 착지하면 서 있는 자세로 바뀐다
 *
 *   node tools/qa-climb.mjs [--dir dist] [--port 8191] [--floors 12]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8191));
const FLOORS = Number(opt('--floors', 12));

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

const snapshot = () => {
  const app = window.__SMOKE__.app;
  const sc = app.scene;
  if (!sc || !sc.layout) return null;
  return {
    floor: app.core ? app.core.floor : -1,
    charScreenY: sc.world.y + sc.char.y,
    stairs: sc.stack.map((p) => ({
      y: +(sc.world.y + p.y).toFixed(1), vis: p.visible,
      tint: p.tintTopLeft, a: +p.alpha.toFixed(2),
    })),
    visibleStairs: sc.visibleStairs(),
    // 캐릭터 머리와 «올라갈 발판» 아랫단 사이의 여유 — 음수면 캐릭터가 발판에 파묻힌다
    headroom: (() => {
      if (!sc.row.length) return null;
      const top = Math.min(...sc.row.map((p) => p.y + p.displayHeight / 2));
      const head = sc.char.y - sc.char.displayHeight;
      return +(head - top).toFixed(1);
    })(),
    pose: sc.charTextureKey(),
    scrollY: +sc.targetScrollY.toFixed(1),
    floorH: +sc.layout.floorH.toFixed(1),
    h: sc.layout.h,
  };
};

async function main() {
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
  page.on('pageerror', (e) => FAIL(`런타임 오류: ${e.message}`));

  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(async () => {
    const t0 = Date.now();
    while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
    // 🔴 이 게이트들은 «이미 놀아 본 아이»를 잰다 — 첫 판 안내(D35)는 판을 멈춰 세우므로
    //    여기서 켜 두면 봇이 한 층도 못 오른다. 첫 판 경험 자체는 qa-howto.mjs 가 따로 잰다.
    window.__SMOKE__.app.data.seenHow = true;
  });
  await page.evaluate(() => { window.__SMOKE__.app.startRun('gugudan'); });
  await page.waitForFunction(() => {
    const a = window.__SMOKE__.app;
    return a.core && a.core.phase === 'question' && a.scene && a.scene.layout;
  }, null, { timeout: 15000 });

  const shots = [];
  const midPoses = [];
  const first = await page.evaluate(snapshot);
  if (!first) { FAIL('씬 상태를 읽지 못함 — 측정 무효'); }
  shots.push(first);

  for (let i = 0; i < FLOORS; i++) {
    await page.waitForFunction(() => {
      const c = window.__SMOKE__.app.core;
      return c && c.phase === 'question' && !c.answered;
    }, null, { timeout: 8000 });
    const ans = await page.evaluate(() => window.__SMOKE__.app.core.question.answerIndex);
    await page.evaluate((idx) => {
      const c = document.querySelectorAll('.choice')[idx];
      c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
      c.click();
    }, ans);
    await page.waitForTimeout(70);           // 도약 «중» — 점프 자세여야 한다
    const mid = await page.evaluate(() => window.__SMOKE__.app.scene.charTextureKey());
    if (mid) midPoses.push(mid);
    await page.waitForTimeout(280);          // 착지 연출이 끝나기를 기다린다
    const s = await page.evaluate(snapshot);
    if (s) shots.push(s);
  }

  const last = shots[shots.length - 1];
  const climbed = last.floor;
  if (climbed < FLOORS) FAIL(`정답 ${FLOORS}회인데 ${climbed}층 — 층이 오르지 않음(측정 무효)`);

  // ① 캐릭터는 붙박여 있다
  const ys = shots.slice(1).map((s) => s.charScreenY);
  const spread = Math.max(...ys) - Math.min(...ys);
  if (spread > 3) FAIL(`캐릭터 화면 높이가 ${spread.toFixed(1)}px 흔들림 — 세계가 아니라 캐릭터가 움직이고 있다`);

  // ② 지나온 계단이 아래에 쌓인다
  const settled = shots.slice(3);
  const minStairs = Math.min(...settled.map((s) => s.visibleStairs));
  if (minStairs < 2) FAIL(`화면에 보이는 지나온 계단 최소 ${minStairs}개 — 2개 미만이면 높이가 체감되지 않는다`);

  // ③ 계단이 서로 다른 높이에 있다
  for (const s of settled) {
    const vis = s.stairs.filter((p) => p.vis && p.y < s.h + 40).map((p) => p.y);
    for (let i = 1; i < vis.length; i++) {
      const gap = vis[i] - vis[i - 1];
      if (gap < s.floorH * 0.8) { FAIL(`계단 간격 ${gap.toFixed(0)}px < 한 층 ${s.floorH.toFixed(0)}px 의 80% — 계단이 겹쳐 있다`); break; }
    }
  }

  // ③b 캐릭터가 «올라갈 발판»에 가려지지 않는다
  const rooms = shots.map((s) => s.headroom).filter((v) => v != null);
  const worst = rooms.length ? Math.min(...rooms) : null;
  if (worst == null) FAIL('여유 높이를 재지 못함 — 측정 무효');
  // 0px 는 «닿기 직전»이다 — 조금만 흔들려도 파묻힌다. 눈에 보이는 여유를 요구한다.
  else if (worst < 8) FAIL(`캐릭터 머리와 위 발판 사이 여유가 ${worst.toFixed(0)}px — 8px 미만이면 붙어 보인다`);

  // ⑥ 도약 중에는 점프 자세, 착지 뒤에는 서 있는 자세
  const jumpFrames = midPoses.filter((k) => k && k.endsWith('-jump')).length;
  if (!midPoses.length) FAIL('도약 중 자세를 재지 못함 — 측정 무효');
  else if (jumpFrames < midPoses.length * 0.8) {
    FAIL(`도약 ${midPoses.length}회 중 점프 자세는 ${jumpFrames}회 — 그림이 안 바뀐다(자세 한 장이 빠졌거나 배선이 끊겼다)`);
  }
  const landedIdle = settled.filter((s) => s.pose && !s.pose.endsWith('-jump')).length;
  if (landedIdle < settled.length) FAIL(`착지 뒤에도 점프 자세로 남은 장면 ${settled.length - landedIdle}건`);

  // ④ 배경 시차가 층마다 유의미하다
  const perFloor = (last.scrollY - shots[0].scrollY) / Math.max(1, climbed);
  if (perFloor < last.floorH * 0.4) {
    FAIL(`배경이 층당 ${perFloor.toFixed(1)}px 만 흐름 (한 층 ${last.floorH.toFixed(0)}px 의 40% 미만) — 화면 높이 대비 보이지 않는 양이다`);
  }

  // ⑤ 10층 금 발판
  if (climbed >= 10) {
    const gold = last.stairs.some((p) => p.tint === 0xffcf6a);
    const seen = shots.some((s) => s.stairs.some((p) => p.tint === 0xffcf6a));
    if (!seen) FAIL('10층 «금 발판»이 남지 않았다 — 고도 표지가 없다');
    else if (!gold) console.log('  · 금 발판은 이미 화면 아래로 내려감(정상)');
  }

  await browser.close();
  srv.close();

  console.log('── 올라가는 느낌 (D28) ──');
  console.log(`  · ${climbed}층 상승 · 캐릭터 화면높이 흔들림 ${spread.toFixed(1)}px`);
  console.log(`  · 보이는 지나온 계단 최소 ${minStairs}개 · 한 층 ${last.floorH.toFixed(0)}px`);
  console.log(`  · 캐릭터 머리 여유 최소 ${worst == null ? '?' : worst.toFixed(0)}px`);
  console.log(`  · 배경 시차 층당 ${perFloor.toFixed(1)}px`);
  console.log(`  · 점프 자세 ${jumpFrames}/${midPoses.length}회 · 착지 후 서 있는 자세 ${landedIdle}/${settled.length}`);
  if (fails.length) { console.log(''); for (const f of fails) console.log(`  ❌ ${f}`); process.exit(1); }
  console.log('\n✅ 올라가는 느낌 PASS');
}

main().catch((e) => { console.error('미실행:', e.message); process.exit(3); });
