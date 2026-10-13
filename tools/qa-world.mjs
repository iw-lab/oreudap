#!/usr/bin/env node
/**
 * 세계·캐릭터 게이트 (GDD-v2 D51 · D52) — 브라우저에서 «보이는 것»만 잰다.
 *
 *  D52 세계 = 여정 구간 — 실제 정답 입력으로 오르며 1·21·51·91층에서 배경 텍스처가 zone-forest·cloud·space·lava 이고,
 *      경계를 넘은 뒤 1.2초 안에 겹침 장(bgC·bgD)이 숨는다(두 장이 겹친 채 멈추지 않는다).
 *  D51 리그 캐릭터 — 고른 캐릭터가 아틀라스 스프라이트(rig-<id>)로 그려지고, 서 있을 땐 idle 이 «돌고»(프레임이 바뀐다),
 *      정답 = jump · 오답 = sad · 연속 = cheer 애니가 실제로 재생된다. 아틀라스의 액션 줄은 서로 다른 그림이다(픽셀 해시).
 *
 *   node tools/qa-world.mjs [--dir dist] [--port 8211]     종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8211));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const fails = [];
const FAIL = (m) => fails.push(m);
const NOTE = (m) => console.log('  · ' + m);

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url.startsWith('/api/hub')) { rsp.writeHead(200, { 'Content-Type': 'application/json' }); rsp.end('{"offline":true}'); return; }
      const p = path.join(DIR, url === '/' ? 'index.html' : url);
      if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404).end('404'); return; }
      rsp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(PORT, '127.0.0.1', () => res(srv));
  });
}

/** 아틀라스 줄(액션)마다 «서로 다른 그림인가» — 첫 프레임 픽셀 해시 */
function atlasRowsDistinct(id) {
  const js = path.join(DIR, 'assets/rig', `${id}.json`);
  const png = path.join(DIR, 'assets/rig', `${id}.png`);
  if (!fs.existsSync(js) || !fs.existsSync(png)) return null;
  const meta = JSON.parse(fs.readFileSync(js, 'utf8'));
  const img = PNG.sync.read(fs.readFileSync(png));
  const hashes = {};
  for (const [name, frames] of Object.entries(meta.meta.anims || {})) {
    const f = meta.frames[frames[Math.floor(frames.length / 2)]].frame;   // 액션 가운데 프레임
    const h = crypto.createHash('sha1');
    for (let y = f.y; y < f.y + f.h; y++) h.update(img.data.subarray((y * img.width + f.x) * 4, (y * img.width + f.x + f.w) * 4));
    hashes[name.slice(name.lastIndexOf('_') + 1)] = h.digest('hex').slice(0, 10);
  }
  return hashes;
}

async function main() {
  const man = JSON.parse(fs.readFileSync(path.join(DIR, 'assets/manifest.json'), 'utf8'));
  const srv = await serve();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => FAIL(`런타임 오류: ${e.message}`));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load' });
  await page.evaluate(async () => { await window.__SMOKE__.ready; window.__SMOKE__.app.data.seenHow = true; });
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__SMOKE__.app.core && window.__SMOKE__.app.core.phase === 'question', null, { timeout: 15000 });

  // ── D51 리그 캐릭터 ───────────────────────────────────────
  const skin = await page.evaluate(() => window.__SMOKE__.app.data.skin);
  const hasRig = !!(man.rig || {})[skin];
  if (!hasRig) FAIL(`고른 캐릭터 ${skin} 의 리그 아틀라스가 매니페스트에 없다`);
  else {
    const a0 = await page.evaluate(() => window.__SMOKE__.app.scene.charAnim());
    await page.waitForTimeout(500);
    const a1 = await page.evaluate(() => window.__SMOKE__.app.scene.charAnim());
    if (a0.rig !== skin) FAIL(`캐릭터가 리그 스프라이트가 아니다(${JSON.stringify(a0)})`);
    if (a0.anim !== `${skin}-idle`) FAIL(`서 있는데 idle 애니가 아니다: ${a0.anim}`);
    if (a0.frame === a1.frame) FAIL(`idle 이 멈춰 있다(0.5초 동안 프레임 ${a0.frame} 그대로)`);
    NOTE(`리그 ${skin}: idle ${a0.frame} → ${a1.frame}`);
    // 정답 → jump
    const jump = await page.evaluate(async () => {
      const app = window.__SMOKE__.app; app.press(app.core.question.answerIndex);
      await new Promise((r) => setTimeout(r, 60)); return app.scene.charAnim().anim;
    });
    if (jump !== `${skin}-jump`) FAIL(`정답 직후 애니가 jump 가 아니다: ${jump}`);
    await page.waitForFunction(() => { const c = window.__SMOKE__.app.core; return c.phase === 'question' && !c.answered; }, null, { timeout: 8000 });
    // 오답 → sad
    const sad = await page.evaluate(async () => {
      const app = window.__SMOKE__.app; const q = app.core.question; app.press((q.answerIndex + 1) % q.choices.length);
      await new Promise((r) => setTimeout(r, 60)); return app.scene.charAnim().anim;
    });
    if (sad !== `${skin}-sad`) FAIL(`오답 직후 애니가 sad 가 아니다: ${sad}`);
    // 연속 축하 → cheer
    const cheer = await page.evaluate(async () => { const app = window.__SMOKE__.app; app.scene.celebrate(); await new Promise((r) => setTimeout(r, 40)); return app.scene.charAnim().anim; });
    if (cheer !== `${skin}-cheer`) FAIL(`연속 축하 때 애니가 cheer 가 아니다: ${cheer}`);
    NOTE(`정답 ${jump} · 오답 ${sad} · 연속 ${cheer}`);
    for (const id of Object.keys(man.rig || {})) {
      const h = atlasRowsDistinct(id);
      if (!h) { FAIL(`${id}: 아틀라스 파일 없음`); continue; }
      const vals = Object.values(h);
      if (new Set(vals).size !== vals.length) FAIL(`${id}: 액션 줄끼리 같은 그림이 있다 ${JSON.stringify(h)}`);
      for (const act of ['idle', 'jump', 'cheer', 'sad']) if (!h[act]) FAIL(`${id}: ${act} 액션이 아틀라스에 없다`);
    }
    NOTE(`아틀라스 ${Object.keys(man.rig || {}).length}종 — 액션 줄 서로 다름 검사`);
  }

  // ── D52 세계 = 여정 구간 ───────────────────────────────────
  const zones = ['forest', 'cloud', 'space', 'lava'].filter((z) => man.images[`zone-${z}`]);
  if (zones.length < 4) FAIL(`구간 배경이 ${zones.length}/4장 — ${['forest', 'cloud', 'space', 'lava'].filter((z) => !zones.includes(z)).join(',')} 없음`);
  await page.evaluate(() => { const app = window.__SMOKE__.app; app.go('title'); });
  await page.click('#btn-play');
  await page.waitForFunction(() => window.__SMOKE__.app.core && window.__SMOKE__.app.core.phase === 'question', null, { timeout: 15000 });
  const seen = {};
  for (const target of [1, 21, 51, 91]) {
    // 경계 바로 앞까지는 층을 옮기고, 경계는 «진짜 정답 입력»으로 넘는다(입력 → setZone 배선을 잰다)
    await page.evaluate((t) => { const c = window.__SMOKE__.app.core; c.floor = t - 1; c.hearts = 3; }, target);
    await page.waitForFunction(() => { const c = window.__SMOKE__.app.core; return c.phase === 'question' && !c.answered; }, null, { timeout: 8000 });
    await page.evaluate(() => { const app = window.__SMOKE__.app; app.press(app.core.question.answerIndex); });
    await page.waitForTimeout(1300);
    const st = await page.evaluate(() => { const s = window.__SMOKE__.app.scene; return { floor: window.__SMOKE__.app.core.floor, zone: s.zone, tex: s.bgA.texture.key, over: s.bgC.visible || s.bgD.visible }; });
    seen[target] = st;
    const want = target <= 20 ? 'forest' : target <= 50 ? 'cloud' : target <= 90 ? 'space' : 'lava';
    if (st.zone !== want) FAIL(`${st.floor}층 구간이 ${st.zone} — ${want} 여야 한다`);
    if (zones.includes(want) && st.tex !== `zone-${want}`) FAIL(`${st.floor}층 배경 텍스처 ${st.tex} — zone-${want} 여야 한다`);
    if (st.over) FAIL(`${st.floor}층: 겹침 장이 1.3초 뒤에도 보인다 — 두 세계가 겹친 채 멈췄다`);
  }
  NOTE(`구간: ${Object.values(seen).map((s) => `${s.floor}층=${s.tex}`).join(' · ')}`);

  await browser.close();
  srv.close();
  if (fails.length) { console.log('\n❌ 세계·캐릭터 게이트 FAIL'); for (const f of fails) console.log('  ✖ ' + f); process.exit(1); }
  console.log('\n✅ 세계·캐릭터 PASS (D51 · D52)');
}
main().catch((e) => { console.error('❌ 도구가 죽었다(미실행):', e); process.exit(3); });
