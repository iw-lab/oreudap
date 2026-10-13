#!/usr/bin/env node
/**
 * 「가장 긴 보기가 화면에 들어가는가」 게이트 (D43).
 *
 * 🔴 뽑기 운에 맡기지 않는다. 한 판을 돌려 보는 방식으로는 12자짜리 뜻풀이가 3갈래로 뽑히는
 *    조합이 좀처럼 안 나온다 — 40판을 돌렸더니 가장 긴 보기가 7자였다(실측). 그래서 데이터에서
 *    «가장 긴 것»을 직접 골라 최악의 조합을 만들어 렌더한다. 이 게이트가 통과하면 그보다 나쁜
 *    조합은 데이터에 존재하지 않는다.
 *
 * 🔴 왜 필요해졌나: 국어 어휘가 들어오면서 보기 길이의 성격이 바뀌었다.
 *    영단어 뜻은 1,207개 중 98%가 4자 이하(최장 9자)인데, 국어 뜻풀이는 평균 9자·최장 12자다.
 *    발판 위 절대배치라 보기가 두 줄이 되면 아래 칸과 겹친다 — 겹침은 «보기가 안 눌리는» 결함이 된다.
 *
 * 재는 것: ① 보기끼리 겹치지 않는가 ② 화면 밖으로 나가지 않는가 ③ 탭 타깃 44px 이상인가
 *
 *   node tools/qa-choice-fit.mjs [--dir dist] [--port 8232]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { SUBJECTS, poolOf } from '../src/core/questions.js';
import { CHOICE_FIT } from '../src/core/balance.js';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8232));
const TAP_MIN = 44;

// 🔴 360px 하나만 잰다 — 이 프로젝트가 지원한다고 선언한 가장 좁은 폭이고(qa-visual 의 small),
//    가장 좁은 곳이 통과하면 넓은 곳은 통과한다. 320px 를 여기 넣으면 «지원한 적 없는 폭»에서
//    빨간불이 켜져 게이트가 신뢰를 잃는다 — 상한을 넓히려면 지원 선언을 먼저 바꿔야 한다.
const VIEWPORTS = [{ w: 360, h: 740 }];

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };

const fails = [];
const FAIL = (m) => fails.push(m);

/**
 * 과목마다 «그 과목에서 가장 긴 보기»를 뽑는다.
 * 🔴 전체에서 최장 몇 개만 뽑으면 안 된다 — 그러면 라틴 문자 14자(responsibility)가 목록을
 *    독차지하고 한글은 한 번도 안 그려진다. 한글은 전각이라 12자가 라틴 14자보다 **넓다**.
 *    「가장 긴 글자수」와 「가장 넓은 보기」는 다른 것이고, 재야 하는 건 뒤쪽이다.
 */
function longestBySubject(n) {
  const out = [];
  for (const s of Object.keys(SUBJECTS)) {
    const pool = poolOf(s);
    if (!pool) continue;
    const texts = [...new Set(pool.flatMap((e) => [e.k, e.w]))].sort((a, b) => b.length - a.length);
    out.push({ subject: s, texts: texts.slice(0, n) });
  }
  return out;
}

function serve() {
  return new Promise((res) => {
    const srv = http.createServer((req, rsp) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      // 학교 허브 중계가 없는 로컬 서버 — 키트 약속대로 «꺼짐»을 200 으로 알린다(404 면 콘솔 오류로 세진다)
      if (url.startsWith('/api/hub')) { rsp.writeHead(200, { 'Content-Type': 'application/json' }); rsp.end('{"offline":true}'); return; }
      const p = path.join(DIR, url === '/' ? 'index.html' : url);
      if (!p.startsWith(DIR) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    });
    srv.listen(PORT, () => res(srv));
  });
}

async function main() {
  if (!fs.existsSync(path.join(DIR, 'index.html'))) {
    console.error(`❌ ${DIR}/index.html 이 없다 — 먼저 npm run build`);
    process.exit(3);
  }
  const groups = longestBySubject(3);
  for (const g of groups) console.log(`  · ${SUBJECTS[g.subject].label}: ${g.texts.map((t) => `«${t}»${t.length}자`).join(' ')}`);

  const srv = await serve();
  const browser = await chromium.launch();
  let measured = 0;

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}/?smoke=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__SMOKE__ && window.__SMOKE__.app, null, { timeout: 20000 });
    // 판이 돌고 있어야 발판·레이아웃이 있다
    await page.evaluate(() => { const a = window.__SMOKE__.app; a.data.seenHow = true; a.subject = 'korean34'; a.startRun(); });
    await page.waitForFunction(() => {
      const c = window.__SMOKE__.app.core; return c && c.phase === 'question';
    }, null, { timeout: 20000 });

    for (const { subject: sub, texts } of groups) {
    for (const branches of [2, 3]) {
      // 가장 긴 것들만 모아 최악의 문항을 «만든다»
      const choices = texts.slice(0, branches);
      const boxes = await page.evaluate(({ choices, branches }) => {
        window.__SMOKE__.app.buildChoices({ choices, answerIndex: 0, subject: 'korean34' });
        return [...document.querySelectorAll('.choice')].map((n) => {
          const t = n.querySelector('.txt');
          const r = t.getBoundingClientRect();
          const nr = n.getBoundingClientRect();
          const st = getComputedStyle(t);
          const lh = parseFloat(st.lineHeight) || parseFloat(st.fontSize) * 1.12;
          const inner = r.height - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom);
          return { text: t.textContent, x: r.x, y: r.y, w: r.width, h: r.height,
                   tapW: nr.width, tapH: nr.height, cls: n.className,
                   font: Math.round(parseFloat(st.fontSize)), lines: Math.max(1, Math.round(inner / lh)) };
        });
      }, { choices, branches });

      if (boxes.length !== branches) {
        FAIL(`${vp.w}px ${sub} ${branches}갈래: 보기가 ${boxes.length}개만 그려졌다 — 측정 무효`);
        continue;
      }
      measured += 1;
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]; const b = boxes[j];
          if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
            FAIL(`${vp.w}px ${sub} ${branches}갈래: «${a.text}»(${a.text.length}자)와 «${b.text}» 가 겹친다 — 아래 보기가 안 눌린다`);
          }
        }
      }
      for (const b of boxes) {
        if (b.x < -0.5 || b.x + b.w > vp.w + 0.5) {
          FAIL(`${vp.w}px ${sub} ${branches}갈래: «${b.text}»(${b.text.length}자) 가 화면 밖으로 ${Math.round(Math.max(-b.x, b.x + b.w - vp.w))}px 나갔다`);
        }
        // 🔴 줄 수가 이 게이트의 핵심이다. 겹침만 보면 세 줄짜리 상자가 «보기끼리는 안 겹친 채»
        //    발판을 통째로 덮는 상태를 통과시킨다(실제로 통과시켰다 — 스크린샷으로 발견).
        if (b.lines > CHOICE_FIT.MAX_LINES) {
          FAIL(`${vp.w}px ${sub} ${branches}갈래: «${b.text}»(${b.text.length}자)가 ${b.lines}줄 — ${CHOICE_FIT.MAX_LINES}줄을 넘으면 글자 상자가 발판을 덮는다. 뜻풀이를 줄여야 한다`);
        }
        if (b.font < CHOICE_FIT.MIN_PX) {
          FAIL(`${vp.w}px ${sub} ${branches}갈래: «${b.text}» 글자 ${b.font}px — ${CHOICE_FIT.MIN_PX}px 미만은 저학년이 못 읽는다`);
        }
        if (b.tapH < TAP_MIN || b.tapW < TAP_MIN) {
          FAIL(`${vp.w}px ${sub} ${branches}갈래: «${b.text}» 탭 타깃 ${Math.round(b.tapW)}×${Math.round(b.tapH)} — ${TAP_MIN}px 미만`);
        }
      }
      console.log(`  · ${vp.w}px ${sub} ${branches}갈래 — ${Math.max(...boxes.map((b) => b.lines))}줄 · ${boxes[0].font}px · 높이 ${Math.round(Math.max(...boxes.map((b) => b.h)))}px`);
    }
    }
    await page.close();
  }

  await browser.close();
  srv.close();

  console.log('\n── 보기가 화면에 들어간다 (D43) ──');
  const want = VIEWPORTS.length * groups.length * 2;
  if (measured !== want) FAIL(`측정 ${measured}건 — ${want}건이어야 한다(측정 무효)`);
  if (fails.length) {
    console.error('\n❌ 보기 맞춤 게이트 FAIL');
    for (const f of fails) console.error('  · ' + f);
    process.exit(1);
  }
  console.log(`✅ 최악의 조합에서도 ${CHOICE_FIT.MAX_LINES}줄 이내 · 글자 ${CHOICE_FIT.MIN_PX}px 이상 · 겹침 0 · 화면 밖 0 · 탭 타깃 ${TAP_MIN}px 이상`);
}

main().catch((e) => { console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e); process.exit(3); });
