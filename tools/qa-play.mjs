#!/usr/bin/env node
/**
 * 플레이 가능성 QA — 헤드리스 시뮬이 «원리적으로» 못 보는 축(GDD 4-0b).
 *
 *  D13 끝단 입력  : 진짜 KeyboardEvent·포인터로 사람 오차를 실어 20회 이상. 판정 1회씩.
 *  D14 봇 플레이  : 실제 마우스 클릭으로 한 판을 끝까지. 런타임 오류 0.
 *  D21 개인정보   : 바깥으로 나가는 곳은 «등수 API 하나»뿐이고, 거기에도 실명이 실리지 않는다.
 *                   🔴 2026-09-04 규칙 변경: 예전 기준은 «외부 요청 0건 · 입력 필드 0개» 였다.
 *                      일일 등수가 들어오면서 그 대리 지표는 더 쓸 수 없다 — 대신 «지키려던 성질»을
 *                      직접 잰다: 실명을 넣고 한 판을 돌린 뒤, 나간 바이트 어디에도 그 글자가 없는가.
 *  D22 오디오     : 첫 입력에서 언락 → 효과음 디코드·재생.
 *
 * 🔴 표본이 모자라면 «측정 무효»로 실패시킨다. 8/8 은 100% 가 아니라 표본 없음이다.
 *   node tools/qa-play.mjs [--dir dist] [--port 8189] [--n 24]
 *   종료코드 0 PASS · 1 FAIL · 3 미실행
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const A = process.argv.slice(2);
const opt = (k, d) => { const i = A.indexOf(k); return i >= 0 ? A[i + 1] : d; };
const DIR = path.resolve(opt('--dir', 'dist'));
const PORT = Number(opt('--port', 8189));
const N = Number(opt('--n', 24));
const MIN_N = 20;

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

const jitter = () => (Math.random() * 180 - 90); // 사람 오차 ±90ms

async function main() {
  const srv = await serve();
  const url = `http://127.0.0.1:${PORT}/index.html`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    deviceScaleFactor: 2, locale: 'ko-KR',
  });
  const page = await ctx.newPage();

  const errors = [];
  const requests = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 어느 리소스가 문제인지까지 적는다 — 「ERR_CONNECTION_CLOSED」만으로는 원인을 못 찾는다.
    const loc = m.location && m.location();
    errors.push(loc && loc.url ? `${m.text()} @ ${loc.url}` : m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), type: r.resourceType(), post: r.postData() }));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const t0 = Date.now();
    while (!window.__SMOKE__ && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
    await window.__SMOKE__.ready;
    // 🔴 이 게이트들은 «이미 놀아 본 아이»를 잰다 — 첫 판 안내(D35)는 판을 멈춰 세우므로
    //    여기서 켜 두면 봇이 한 층도 못 오른다. 첫 판 경험 자체는 qa-howto.mjs 가 따로 잰다.
    window.__SMOKE__.app.data.seenHow = true;
  });

  const startRun = async (subject = 0) => {
    await page.evaluate(() => {
      const app = window.__SMOKE__.app;
      if (app.screen !== 'title') app.go('title');
    });
    await page.click(`.subject-card >> nth=${subject}`);
    await page.click('#scope-start');
    await page.waitForFunction(() => window.__SMOKE__.app.core && window.__SMOKE__.app.core.phase === 'question');
    await page.evaluate(() => { window.__SMOKE__.app.qaLog = []; });
  };

  const waitQuestion = () => page.waitForFunction(
    () => { const c = window.__SMOKE__.app.core; return c && c.phase === 'question' && !c.answered; },
    null, { timeout: 8000 },
  );

  const state = () => page.evaluate(() => {
    const c = window.__SMOKE__.app.core;
    return { phase: c.phase, hearts: c.hearts, floor: c.floor, answered: c.answered,
             k: c.question ? c.question.choices.length : 0, ans: c.question ? c.question.answerIndex : -1,
             asked: c.stats.asked };
  });

  // ── D13-a: 진짜 키 입력, 문항 창 «안»에서 사람 오차 ───────
  await startRun(0);
  let keyTrials = 0;
  for (let i = 0; i < N; i++) {
    try { await waitQuestion(); } catch { break; }
    const s = await state();
    if (s.phase !== 'question') break;
    const delay = Math.max(60, 420 + jitter());
    await page.waitForTimeout(delay);
    const still = await state();
    if (still.phase !== 'question' || still.answered) continue;
    const key = still.ans === 0 ? 'ArrowLeft' : (still.k === 3 && still.ans === 1 ? 'ArrowUp' : 'ArrowRight');
    await page.keyboard.press(key);
    keyTrials += 1;
    await page.waitForTimeout(60);
    if (still.hearts <= 1) { await startRun(0); }
  }
  const keyLog = await page.evaluate(() => window.__SMOKE__.app.qaLog.filter((r) => r.source === 'key'));
  NOTE(`끝단 키 입력 ${keyTrials}회 시도 · 기록 ${keyLog.length}건`);
  if (keyLog.length < MIN_N) FAIL(`키 입력 표본 ${keyLog.length} < ${MIN_N} — 측정 무효`);
  const keyBad = keyLog.filter((r) => r.type !== 'correct');
  if (keyBad.length) FAIL(`정답 키를 눌렀는데 ${keyBad.length}건이 정답 처리되지 않았다 (${keyBad.slice(0, 3).map((b) => b.type).join(',')})`);
  const keyDouble = keyLog.filter((r) => Math.abs(r.heartsDelta) + Math.abs(r.floorDelta) > 1);
  if (keyDouble.length) FAIL(`키 입력 1회에 상태가 2 이상 바뀐 건 ${keyDouble.length}건 — 판정 1회 원칙 위반`);

  // ── D13-b: 타임아웃 «이후» 입력은 무시된다 ─────────────
  await startRun(0);
  let toTrials = 0;
  let extraJudgements = 0;
  for (let i = 0; i < MIN_N + 4; i++) {
    try { await waitQuestion(); } catch { break; }
    const s = await state();
    if (s.phase !== 'question') break;
    const wait = await page.evaluate(() => window.__SMOKE__.app.core.timeLeftMs);
    await page.waitForTimeout(wait + 200 + jitter() * 0.5);
    const beforeHearts = (await state()).hearts;
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(40);
    const afterHearts = (await state()).hearts;
    if (beforeHearts !== afterHearts) extraJudgements += 1;
    toTrials += 1;
    if (afterHearts <= 0) await startRun(0);
  }
  NOTE(`타임아웃 이후 입력 ${toTrials}회 · 추가 판정 ${extraJudgements}건`);
  if (toTrials < MIN_N) FAIL(`타임아웃 이후 입력 표본 ${toTrials} < ${MIN_N} — 측정 무효`);
  if (extraJudgements > 0) FAIL(`타임아웃 이후 입력이 ${extraJudgements}건 추가 판정됐다 — 무시돼야 한다`);

  // ── D13-b2: 키를 «누르고 있어도» 다음 문항이 자동 판정되지 않는다 ──
  await startRun(0);
  {
    await waitQuestion();
    const before = await state();
    await page.keyboard.down('ArrowLeft');       // 손을 떼지 않는다 → keydown 자동 반복
    await page.waitForTimeout(3000);             // 문항 2~3개를 넘길 시간
    await page.keyboard.up('ArrowLeft');
    const log = await page.evaluate(() => window.__SMOKE__.app.qaLog.filter((r) => r.source === 'key'));
    const judged = log.filter((r) => r.type === 'correct' || r.type === 'wrong').length;
    NOTE(`키 홀드 3초 · 판정된 입력 ${judged}건 (기록 ${log.length}건)`);
    if (judged > 1) FAIL(`키를 누르고 있는 동안 ${judged}건이 판정됐다 — 자동 반복이 다음 문항을 대신 푼다`);
    const after = await state();
    if (before.hearts - after.hearts > 1 && judged <= 1) {
      NOTE('하트 감소는 시간초과분이다(자동 반복 판정 아님)');
    }
  }

  // ── 오답노트는 «틀린» 문제만 담는다 ─────────────────────
  await startRun(0);
  {
    // 🔴 오답노트는 판을 넘어 «영속»이다 — 절대 개수를 재면 이전 판의 오답까지 세게 된다.
    //    이 판(전부 정답)에서 «늘어나지 않는가»를 재야 한다.
    const before = await page.evaluate(() => window.__SMOKE__.app.notes.list().length);
    for (let i = 0; i < 8; i++) {
      try { await waitQuestion(); } catch { break; }
      const s = await state();
      if (s.phase !== 'question') break;
      await page.waitForTimeout(250);
      const still = await state();
      if (still.phase !== 'question' || still.answered) continue;
      await page.evaluate((idx) => window.__SMOKE__.app.press(idx, 'pointer'), still.ans);
      await page.waitForTimeout(80);
    }
    const after = await page.evaluate(() => window.__SMOKE__.app.notes.list().length);
    NOTE(`전부 정답 8문항 · 오답노트 ${before}행 → ${after}행`);
    if (after > before) FAIL(`한 번도 안 틀렸는데 오답노트가 ${after - before}행 늘었다`);
  }

  // ── D13-c: 진짜 포인터 탭 — 좌표 변환까지 검증 ──────────
  await startRun(0);
  let tapTrials = 0;
  const tapWrong = [];
  for (let i = 0; i < N; i++) {
    try { await waitQuestion(); } catch { break; }
    const s = await state();
    if (s.phase !== 'question') break;
    const target = await page.evaluate((idx) => {
      const c = document.querySelectorAll('.choice')[idx];
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, s.ans);
    if (!target) { FAIL('선택지 DOM 을 못 찾았다'); break; }
    await page.waitForTimeout(Math.max(60, 300 + jitter()));
    const still = await state();
    if (still.phase !== 'question' || still.answered) continue;
    await page.mouse.click(target.x, target.y);
    tapTrials += 1;
    await page.waitForTimeout(60);
    const after = await state();
    if (after.floor !== still.floor + 1) tapWrong.push({ want: still.floor + 1, got: after.floor });
    if (after.hearts <= 1) await startRun(0);
  }
  const tapLog = await page.evaluate(() => window.__SMOKE__.app.qaLog.filter((r) => r.source === 'pointer'));
  NOTE(`포인터 탭 ${tapTrials}회 · 기록 ${tapLog.length}건`);
  if (tapLog.length < MIN_N) FAIL(`포인터 탭 표본 ${tapLog.length} < ${MIN_N} — 측정 무효`);
  if (tapWrong.length) FAIL(`정답 발판을 탭했는데 층이 안 올랐다 ${tapWrong.length}건 — 좌표 변환·히트영역 문제`);

  // ── D22: 오디오 언락·디코드 ─────────────────────────────
  const audio = await page.evaluate(() => {
    const app = window.__SMOKE__.app;
    return { report: app.sound.report(), unlocked: app.sound.unlocked, played: app.sound.play('correct') };
  });
  NOTE(`오디오 디코드 ${audio.report.decoded}/${audio.report.expected} · 언락 ${audio.unlocked} · 재생 ${audio.played}`);
  if (audio.report.decoded < audio.report.expected) {
    FAIL(`오디오 ${audio.report.expected - audio.report.decoded}개가 디코드되지 않았다 — 배포 후 무음`);
  }
  if (!audio.unlocked) FAIL('첫 입력 이후에도 AudioContext 가 언락되지 않았다');
  if (audio.report.failed.length) FAIL(`오디오 실패 ${audio.report.failed.length}건: ${audio.report.failed.slice(0, 2).join(' | ')}`);

  // ── D14: 봇이 한 판을 끝까지 (실제 클릭) ───────────────
  // 🔴 「한 판」은 운에 맡길 수 없다. 정답률 70% 봇은 하트 3개를 4번 만에 잃기도 한다(실측 4회·층 1)
  //    — 그러면 «측정 무효»로 빨간불이 켜지는데, 코드는 멀쩡하다. 무작위로 빨간불이 켜지는 게이트는
  //    사람이 게이트를 안 믿게 만든다. 그래서 클릭 수가 찰 때까지 판을 «다시 시작»한다.
  //    덤으로 재시작 경로(GameObject 전수 리셋)를 매번 밟게 된다.
  const NEED_CLICKS = 12;
  await startRun(0);
  let clicks = 0;
  let runs = 1;
  let guard = 0;
  while (guard++ < 900) {
    const s = await state();
    if (s.phase === 'over') {
      if (clicks >= NEED_CLICKS || runs >= 5) break;
      runs += 1;
      await page.click('#btn-again');
      await page.waitForFunction(() => {
        const c = window.__SMOKE__.app.core;
        return c && c.phase === 'question';
      }, null, { timeout: 8000 });
      continue;
    }
    if (s.phase !== 'question' || s.answered) { await page.waitForTimeout(60); continue; }
    // 정답률 70% 봇 — 틀리기도 해야 오답 경로(하이라이트·오답노트)가 실행된다
    const pick = Math.random() < 0.7 ? s.ans : Math.floor(Math.random() * s.k);
    const target = await page.evaluate((idx) => {
      const c = document.querySelectorAll('.choice')[idx];
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, pick);
    if (!target) { await page.waitForTimeout(60); continue; }
    await page.waitForTimeout(Math.max(60, 350 + jitter()));
    const still = await state();
    if (still.phase !== 'question' || still.answered) continue;
    await page.mouse.click(target.x, target.y);
    clicks += 1;
    await page.waitForTimeout(80);
  }
  const final = await page.evaluate(() => ({
    onResult: document.querySelector('#screen-result').classList.contains('active'),
    floor: document.querySelector('#result-floor').textContent,
    qa: window.__SMOKE__.qa(),
  }));
  NOTE(`봇 플레이테스트 클릭 ${clicks}회 · 판 ${runs}회 · 결과화면 ${final.onResult} · 층 ${final.floor}`);
  if (clicks < NEED_CLICKS) FAIL(`봇이 판 ${runs}회 동안 ${clicks}회만 눌렀다 — 입력이 먹지 않는다(측정 무효)`);
  if (!final.onResult) FAIL('봇이 하트를 다 잃었는데 결과 화면이 뜨지 않았다');
  if (final.qa.zombieTweens > 0) FAIL(`파괴된 대상을 도는 트윈 ${final.qa.zombieTweens}개 — 생명주기 누수`);
  if (final.qa.loadErrors.length) FAIL(`에셋 로드 실패 ${final.qa.loadErrors.length}건: ${final.qa.loadErrors.join(', ')}`);

  // ── D21: 개인정보 — 네트워크 전수 ───────────────────────
  const origin = `http://127.0.0.1:${PORT}`;
  // blob:<origin>/… 와 data: 는 «네트워크로 나가는 요청»이 아니다(브라우저 내부 객체).
  // 그걸 외부로 세면 게이트가 진짜 외부 전송을 가리는 잡음이 된다.
  const isLocal = (u) => u.startsWith(origin) || u.startsWith(`blob:${origin}`) || u.startsWith('data:');
  const RANK_HOST = 'https://oreudap-rank.simssijjang-a04.workers.dev';
  const isRank = (u) => u.startsWith(`${RANK_HOST}/api/rank`);
  const blobs = requests.filter((r) => r.url.startsWith('blob:'));
  const rank = requests.filter((r) => isRank(r.url));
  const external = requests.filter((r) => !isLocal(r.url) && !isRank(r.url));
  NOTE(`네트워크 요청 ${requests.length}건 · 내부 blob ${blobs.length} · 등수 API ${rank.length} · 그 밖의 외부 ${external.length}`);

  // ① 바깥으로 나가는 곳은 등수 API 하나뿐이다
  if (external.length) FAIL(`허용되지 않은 외부 요청 ${external.length}건: ${external.slice(0, 3).map((r) => r.url).join(', ')}`);

  // ② 자체 도메인 요청은 여전히 «본문 없는 GET» 이어야 한다
  const localBad = requests.filter((r) => isLocal(r.url) && (r.method !== 'GET' || r.post));
  if (localBad.length) FAIL(`자체 도메인으로 데이터를 보내는 요청 ${localBad.length}건`);

  // ③ 🔴 실명이 기기를 벗어나지 않는가 — 이 게이트의 핵심.
  //    직접 지은 이름을 넣고 한 판을 정산시킨 뒤, 나간 «모든» 바이트에서 그 글자를 찾는다.
  const SECRET = '김철수';
  await page.evaluate((n) => { localStorage.setItem('oreudap:nick', n); }, SECRET);
  const sent = [];
  page.on('request', (r) => { if (isRank(r.url())) sent.push({ url: r.url(), body: r.postData() || '' }); });
  await page.evaluate(() => { window.__SMOKE__.app.go('title'); });
  const runInfo = await page.evaluate(async () => {
    const app = window.__SMOKE__.app;
    app.subject = 'gugudan';
    app.scope = null;
    app.startRun();
    const seen = [];
    for (let i = 0; i < 6; i++) {
      const c = app.core;
      seen.push(c ? c.phase : 'nocore');
      if (!c || c.phase !== 'question' || c.answered) { await new Promise((r) => setTimeout(r, 200)); continue; }
      app.press(c.question.answerIndex, 'pointer');
      await new Promise((r) => setTimeout(r, 280));
    }
    const floor = app.core ? app.core.floor : -1;
    const settled = app.settled;
    // 🔴 «오늘 이미 올린 최고» 를 여기서 지운다 — 시작 시점에 지우면 앞 시험의 봇이
    //    아직 돌고 있다가 더 높은 기록을 올려 이 런이 «최고가 아님»으로 건너뛰어진다(실측).
    try { localStorage.removeItem('oreudap:sent'); } catch { /* 무시 */ }
    const sentRaw = null;
    app.quitRun();
    return { floor, settled, phases: seen.join('>'), subject: app.subject, sentRaw };
  });
  await page.waitForTimeout(2000);
  NOTE(`등수 제출용 런: ${runInfo.floor}층 · ${runInfo.subject} · settled ${runInfo.settled} · sent ${runInfo.sentRaw}`);

  const leaked = sent.filter((r) => `${r.url}${r.body}`.includes(SECRET));
  if (leaked.length) FAIL(`직접 지은 이름 "${SECRET}" 이 그대로 전송됐다 ${leaked.length}건 — 보내기 전에 가려야 한다`);
  const posts = sent.filter((r) => r.body);
  if (!posts.length) {
    FAIL(`등수 제출이 한 건도 안 나갔다 — 측정 무효. 런 ${runInfo.floor}층 · settled ${runInfo.settled} · 흐름 ${runInfo.phases}`);
  }
  for (const p of posts) {
    let body = null;
    try { body = JSON.parse(p.body); } catch { FAIL('등수 제출 본문이 JSON 이 아니다'); continue; }
    // 🔴 기기 밖으로 나가는 필드는 «늘어날 때마다» 여기서 명시적으로 승인돼야 한다.
    //    m(모드) 은 2026-09-05 에 추가했다 — 세 값 중 하나인 열거형이라 자유 입력이 아니다.
    //    이 목록을 「대충 통과」시키면 D29 는 그날로 죽는다.
    const keys = Object.keys(body).sort().join(',');
    // t(봇 표시)는 2026-09-05 에 추가했다. 이 게이트는 자동화 브라우저에서 도므로 «반드시» 붙어 있어야 한다.
    if (keys !== 'm,n,s,sub,t') FAIL(`등수 제출에 예상 밖 필드: ${keys} (m,n,s,sub,t 만 보내야 한다)`);
    // 🔴 봇 표시가 빠지면 게이트가 매일 아이들 등수판에 가짜 기록을 쌓는다(2026-09-05 에 실제로 6줄 쌓였다).
    //    표시는 클라이언트가 navigator.webdriver 로 스스로 판단한다 — 게이트마다 플래그를 심지 않으므로
    //    앞으로 게이트가 몇 개 늘어도 자동으로 걸린다. 그 배선이 살아 있는지를 여기서 잰다.
    if (body.t !== 1) FAIL('봇 표시(t)가 제출 본문에 없다 — 게이트 기록이 아이들 판에 올라간다');
    if (!['classic', 'thrill', 'sprint'].includes(body.m)) {
      FAIL(`모드 필드가 «${body.m}» — 정해진 세 값이 아니면 자유 입력이 새는 통로가 된다`);
    }
    if (typeof body.n !== 'string' || !body.n.includes('*')) {
      FAIL(`제출된 이름 "${body.n}" 에 별표가 없다 — 직접 지은 이름은 가려서 보내야 한다`);
    }
  }
  NOTE(`등수 제출 ${posts.length}건 · 실명 유출 0 · 보낸 이름 예: ${posts[0] ? JSON.parse(posts[0].body).n : '-'}`);

  // ④ 입력 칸은 «이름 하나»뿐이고, 개인정보를 받는 종류가 아니다
  const inputInfo = await page.evaluate(() => {
    const all = [...document.querySelectorAll('input, textarea, [contenteditable="true"]')];
    return all.map((e) => ({
      id: e.id, tag: e.tagName.toLowerCase(), type: (e.getAttribute('type') || '').toLowerCase(),
      max: Number(e.getAttribute('maxlength')) || 0,
    }));
  });
  const BANNED = ['email', 'tel', 'date', 'password', 'number', 'url', 'month', 'week'];
  for (const f of inputInfo) {
    if (BANNED.includes(f.type)) FAIL(`개인정보를 받는 입력 종류 "${f.type}" 이 있다 (#${f.id})`);
    if (f.tag !== 'input') FAIL(`자유 서술 입력(${f.tag})이 있다 — 아이가 무엇이든 쓸 수 있는 칸은 두지 않는다`);
  }
  const nickFields = inputInfo.filter((f) => f.id === 'nick');
  if (inputInfo.length !== 1 || nickFields.length !== 1) {
    FAIL(`입력 칸이 ${inputInfo.length}개 — 허용은 이름 칸(#nick) 하나뿐이다`);
  } else if (!(nickFields[0].max > 0 && nickFields[0].max <= 8)) {
    FAIL(`이름 칸 maxlength=${nickFields[0].max} — 1~8 이어야 한다(길면 '5학년3반김철수' 가 들어간다)`);
  }
  NOTE(`입력 칸 ${inputInfo.length}개 (이름 칸만, maxlength ${nickFields[0] ? nickFields[0].max : '-'})`);

  const stored = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = (localStorage.getItem(k) || '').length;
    }
    return out;
  });
  const keys = Object.keys(stored);
  NOTE(`localStorage 키 ${keys.length}개: ${keys.join(', ')}`);
  if (keys.some((k) => !k.startsWith('oreudap:'))) FAIL(`네임스페이스 밖 저장 키: ${keys.filter((k) => !k.startsWith('oreudap:')).join(', ')}`);

  if (errors.length) FAIL(`콘솔·런타임 오류 ${errors.length}건: ${errors.slice(0, 3).join(' | ')}`);

  await browser.close();
  srv.close();

  console.log('\n── 플레이 가능성 QA ────────────────────────────');
  for (const n of notes) console.log('  · ' + n);
  if (fails.length) {
    console.log('\n❌ 플레이 QA FAIL');
    for (const f of fails) console.log('  ✖ ' + f);
    process.exit(1);
  }
  console.log('\n✅ 플레이 QA PASS (D13 · D14 · D21 · D22 · D29 · D36)');
}

main().catch((e) => {
  console.error('❌ 도구가 죽었다(미실행 — 통과도 실패도 아니다):', e);
  process.exit(3);
});
