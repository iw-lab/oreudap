// 앱 컨트롤러 — 화면 전환, 코어 구동, DOM 갱신.
// 코어(src/core/*)는 DOM 을 모르고, 이 파일이 유일한 다리다.

import { GameCore, PHASE } from './core/game.js';
import { PersistentNotes } from './core/srs.js';
import { SUBJECTS, describeId } from './core/questions.js';
import { load, save, emptySave } from './core/storage.js';
import { applyRun, buy, equip, todayMissions } from './core/economy.js';
import { SHOP, HEART, SRS, TIMING, MODES, DEFAULT_MODE, STAMINA, TIER_FLOORS, CHOICE_FIT, tierIndexFor, tierStartFor } from './core/balance.js';
import { computeLayout, columns } from './ui/layout.js';
import { Sound } from './ui/sound.js';
import { Say } from './ui/say.js';
import { createJuice } from './ui/juice.js';
import { SAY_WORDS } from './data/say-index.js';
import { makeRng } from './core/rng.js';
import { poolOf } from './core/questions.js';
import { icon, iconEl, SUBJECT_ICON, MODE_ICON } from './ui/icons.js';
// game-builder 기본틀(키트 — 고치지 않는다): 학교 순위 · 판 관문(이용권 없음 = free-play) · 전체화면 · 모드 카드
import './gb/gb-ui.css';
import { configureHub } from './gb/hubnet.js';
import { configureSchool, mountSchoolRank, refreshSchoolRank, gbGate, gbFinish, gbLeave, shortSchool } from './gb/gb-school.js';
import { bindFullscreenButton } from './gb/gb-fullscreen.js';
import { renderModeCards, setModeBest } from './gb/gb-modes.js';
import { journeyOf, currentZone, nextZoneGap, zoneIndexFor } from './core/journey.js';
import { ZONES } from './core/balance.js';
import { planForNow, starsFor, recordFlag, todayStars, flagSummary } from './core/daily.js';
import { applyPerId, masteryList, weakest, stampToday, weekView } from './core/mastery.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/**
 * 보기 하나가 MAX_LINES 줄에 들어가는 글자 크기(px).
 * 한글은 전각이라 한 글자가 거의 1em 을 먹고, 라틴은 그 절반쯤이다 — 같은 «글자수»라도 폭이 다르다.
 * 🔴 하한(18px)에 걸리면 그건 «데이터가 너무 길다»는 신호다. 여기서 더 줄이지 않고
 *    D43 게이트가 줄 수로 잡아 준다 — 화면 코드가 데이터 문제를 감춰 버리면 안 된다.
 */
function fitFontPx(longest, colW, choices) {
  const hangul = choices.some((t) => /[가-힣]/.test(String(t)));
  const em = hangul ? 1.0 : 0.58;            // 글자 하나가 먹는 폭(글꼴 실측 근사)
  const usable = Math.max(40, colW - 24);    // 좌우 패딩 10 + 테두리 2씩
  const perLine = Math.max(1, Math.ceil(longest / CHOICE_FIT.MAX_LINES));
  const px = Math.floor(usable / (perLine * em));
  return Math.max(CHOICE_FIT.MIN_PX, Math.min(CHOICE_FIT.MAX_PX, px));
}

// 반응(주스) — 맞히기·연속·층 돌파·틀리기 하나하나에 «과하게» 반응한다(game-builder tools/check-juice.mjs).
// 🔴 slowmo·hitstop·combo·kick 은 일부러 안 썼다: 이 게임은 advance(dtMs) 가 기력·시간제한·판정
//    타이머를 «그 dt 그대로» 흘린다(core/game.js) — 렌더와 분리된 dt 가 없어 J.time() 을 걸면
//    정답 직후 연출 한 번마다 기력 드레인·판 제한시간이 늦게 간다(오늘의 계단·등수에 들어가는 자원).
//    combo 는 게임이 이미 streak 로 센다 — J 의 내부 콤보와 두 집계가 겹치면 배너가 두 번 뜬다.
export const JUICE = {
  correct: ['sfx', 'pop', 'punch'],                       // 발판 밟기 — 작게, 매번
  wrong: ['sfx', 'flash', 'punch', 'haptic'],              // 오답·시간초과
  streak: ['sfx', 'burst', 'banner', 'punch', 'haptic'],   // 연속 정답(하트 회복)
  milestone: ['sfx', 'banner', 'flash', 'punch', 'haptic'], // 10층마다 금 발판
  land: ['sfx', 'punch', 'haptic'],                        // 정답 발판에 «쿵» 착지(점프 220ms 뒤)
  coin: ['sfx', 'pop', 'punch'],                           // 연속 보너스 코인 +5
  heart: ['sfx', 'pop', 'punch', 'haptic'],                // 하트 회복
  record: ['sfx', 'banner', 'burst', 'flash'],             // 판 도중 최고 기록을 넘는 순간(한 판에 한 번)
  school: ['sfx', 'banner', 'pop', 'punch'],               // 결과 — 우리 학교 +N점
};

const SUBJECT_META = {
  gugudan: { short: '구구단' },
  words34: { short: '영단어 3·4' },
  words56: { short: '영단어 5·6' },
  korean34: { short: '국어 3·4' },
  korean56: { short: '국어 5·6' },
};

// 모드 카드 — 키트 kind 에 맞춘다(classic·time·survival + rule·daily). 카드를 누르면 그 모드로 «바로» 시작한다.
const MODE_CARDS = [
  { id: 'classic', kind: 'classic', desc: '하트 3개로 끝까지' },
  { id: 'sprint', kind: 'time', desc: '1분 안에 몇 층?' },
  { id: 'thrill', kind: 'survival', desc: '기력이 계속 줄어요' },
  { id: 'mirror', kind: 'rule', desc: '56 → 7 × 8 찾기' },
  { id: 'daily', kind: 'daily', desc: '오늘의 판 · 별 3개' },
];
/** 학교 점수 «끝까지 감» 기준 — 10층(첫 금 발판)을 넘었거나 오늘의 계단 별을 받았으면 */
const CLEAR_FLOOR = 10;

export class App {
  constructor({ scene, seedFn }) {
    this.scene = scene;
    this.seedFn = seedFn;
    this.data = load();
    this.mode = MODES[this.data.mode] ? this.data.mode : DEFAULT_MODE;
    this.notes = new PersistentNotes(this.data.notes);
    this.core = null;
    this.subject = 'gugudan';
    this.scope = null;
    this.daily = null;        // 오늘의 계단으로 시작했으면 그 설계도(아니면 null)
    this.screen = 'title';
    this.choiceNodes = [];
    this.lastFrame = 0;
    this.rafId = 0;
    this.paused = false;
    this.smokeMode = false;
    this.smokeRun = 0;
    this.layout = computeLayout(window.innerWidth, window.innerHeight);
    this.sound = new Sound(() => this.data.settings.sound, scene, []);
    // 영어 낱말은 귀로도 만난다 — 파일 943개, 없는 낱말은 브라우저 음성.
    this.voice = new Say(() => this.data.settings.sound, SAY_WORDS);
    this.autoBot = null;      // 스모크·플레이테스트 전용
    // 반응(주스) — 소리는 기존 Sound 로(이중 재생 방지), 진동은 소리 설정을 그대로 따른다.
    this.ticket = null;       // 이번 판 학교 점수 영수증(gbGate) — 허브가 없으면 null
    this.starting = false;
    this.J = createJuice({
      table: JUICE,
      host: document.body,
      haptics: () => this.data.settings.sound !== false,
      sfx: (name, o) => this.sound.play(name, 0.65 * ((o && o.vol) || 1)),
      burst: () => { if (this.scene) this.scene.celebrate(); },
      punch: { correct: '#hud-floor', wrong: '#hud-hearts', streak: '#streak-chip', milestone: '#hud-floor', land: '#hud-floor', coin: '#streak-chip', heart: '#hud-hearts', school: '#result-school' },
    });
  }

  init() {
    configureHub({ key: 'oreudap.hub.v1' });
    configureSchool({ freePlay: true, playWord: '오르기', sfx: { tick: () => this.sound.play('button'), win: () => this.sound.play('streak') } });
    mountSchoolRank($('#schoolRank'));
    bindFullscreenButton($('#btnFull'));
    bindFullscreenButton($('#btnFullPlay'));
    this.paintIcons();
    this.bindStaticButtons();
    this.renderTitle();
    this.applyBodyFlags();
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.onResize(), 60));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'play' && !this.paused) this.pause();
    });
    document.addEventListener('keydown', (e) => this.onKey(e));
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ── 화면 ────────────────────────────────────────────────
  go(name) {
    this.screen = name;
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
    const target = $(`#screen-${name}`);
    if (target) target.classList.add('active');
    if (name === 'title') { this.renderTitle(); refreshSchoolRank(); }
    if (name === 'notes') this.renderNotes();
    if (name === 'collection') this.renderCollection();
    if (name === 'settings') this.renderSettings();
    document.body.classList.toggle('in-play', name === 'play');
  }

  bindStaticButtons() {
    for (const b of document.querySelectorAll('[data-go]')) {
      b.addEventListener('click', () => this.go(b.dataset.go));
    }
    $('#btn-pause').addEventListener('click', () => this.pause());
    $('#btn-resume').addEventListener('click', () => this.resume());
    $('#btn-quit').addEventListener('click', () => { this.quitRun(); });
    // 주 단추 — 고른 과목·고른 모드로 바로. 🔴 gbGate 는 클릭 «안에서 바로» 불러야 자동 전체화면이 된다.
    $('#btn-play').addEventListener('click', () => this.play(() => this.startMode(this.mode)));
    $('#btn-how-home').addEventListener('click', () => this.showHow(true));
    // 🔴 전체화면 요청은 «클릭 핸들러 안»에서만 한다. startRun 에 넣었더니 봇·스모크가 부르는
    //    경로에서도 요청이 나가 「user gesture 없이 호출」 콘솔 경고가 떴다(D18 이 잡았다).
    //    제스처가 있는 자리는 여기지 startRun 이 아니다.
    // 🔴 오늘의 계단을 하던 중이면 «같은 판»으로 다시 간다. 무작위로 돌려보내면
    //    아이는 방금 아쉬웠던 그 판을 다시 만날 수 없고, 별을 올릴 길도 사라진다.
    $('#btn-again').addEventListener('click', () => {
      const daily = !!this.daily;
      this.play(() => (daily ? this.startDaily(this.subject) : this.startRun()));
    });
    $('#btn-how-start').addEventListener('click', () => { this.sound.unlock(); this.hideHow(); });
    // 🔴 pause() 를 부르면 «잠깐 멈춤» 카드가 안내 위를 덮어 버튼을 못 누른다(D35 가 잡았다).
    //    시계만 세우고 카드는 띄우지 않는다 — 멈춤 해제는 hideHow 가 한다.
    $('#btn-how').addEventListener('click', () => {
      if (this.screen === 'play') { this.paused = true; this.sound.stopBgm(); this.voice.stop(); }
      this.showHow(true);
    });
    // 🔴 한 번 듣고 놓치는 아이가 반드시 있다 — 문제 카드를 누르면 다시 읽어 준다.
    //    선택지가 아니라 «문제»를 누르는 것이라 오답 위험이 없다.
    $('#qcard').addEventListener('click', () => {
      const q = this.core && this.core.question;
      if (q && q.word && (q.dir === 'w2k' || this.core.answered)) this.voice.speak(q.word, q.lang);
    });
  }

  /** 아이콘 칠하기(이모지 대신 SVG) — 정적 단추들 */
  paintIcons() {
    $('#logo-mark').innerHTML = icon('logo');
    $('#coin-ico').innerHTML = icon('coin');
    $('#btn-settings').innerHTML = icon('gear');
    $('#btn-how').innerHTML = icon('help');
    $('#btn-pause').innerHTML = icon('pause');
    for (const b of document.querySelectorAll('.back-btn')) b.innerHTML = icon('back');
    for (const c of document.querySelectorAll('.coin-ico')) c.innerHTML = icon('coin');
  }

  /**
   * 판 시작 관문(키트 README §연결) — 학교 점수 영수증을 받고 시작한다. 이 게임은 이용권이 없다(free-play).
   * 🔴 잠금은 «시작 준비»까지만 덮는다 — 두 번 누름이 판 두 개·영수증 두 장이 되지 않게.
   */
  play(start) {
    if (this.starting) return;
    this.starting = true;
    let launched = false;
    // 이전 판 영수증이 남아 있으면(결과 화면에서 «바로 다시») 이미 정산됐다 — 새 판은 새 영수증
    this.ticket = null;
    gbGate((ref) => {
      launched = true;
      this.ticket = ref;
      Promise.resolve().then(start).catch(() => {
        if (this.ticket === ref) { gbLeave(ref); this.ticket = null; }
        this.go('title');
      }).finally(() => { this.starting = false; });
    }, { kind: 'run' }).finally(() => { if (!launched) this.starting = false; });
  }

  /** 모드 카드·주 단추가 부른다 */
  startMode(id) {
    if (id === 'daily') { this.mode = 'classic'; this.startDaily(this.subject); return; }
    if (!MODES[id]) id = DEFAULT_MODE;
    this.mode = id;
    this.data.mode = id;          // 다음 판에도 고른 모드를 기억한다
    save(this.data);
    this.startRun();
  }

  applyBodyFlags() {
    document.body.classList.toggle('color-safe', !!this.data.settings.colorSafe);
    if (this.scene) this.scene.reduced = !!this.data.settings.reducedMotion;
  }

  persist() {
    this.data.notes = this.notes.data;
    save(this.data);
  }

  // ── 타이틀 ──────────────────────────────────────────────
  renderTitle() {
    $('#title-coin-n').textContent = this.data.coins;
    const grid = $('#subject-grid');
    grid.textContent = '';
    for (const key of Object.keys(SUBJECTS)) {
      const chip = el('button', 'subject-chip');
      chip.type = 'button';
      chip.setAttribute('role', 'radio');
      chip.setAttribute('aria-checked', String(key === this.subject));
      chip.dataset.subject = key;
      chip.append(iconEl(SUBJECT_ICON[key], 'chip-ic'));
      chip.append(el('span', 'chip-name', SUBJECT_META[key].short));
      chip.addEventListener('click', () => {
        if (this.subject === key) return;
        this.subject = key;
        this.scope = null;
        this.sound.play('button');
        this.renderTitle();
      });
      grid.append(chip);
    }
    this.renderDanRow();
    this.renderModes();
    const m = MODES[this.mode] || MODES.classic;
    $('#btn-play').innerHTML = `${icon('logo', 'play-ic')}<span>${SUBJECT_META[this.subject].short} · ${m.label} 시작</span>`;
    this.renderJourney();
    this.renderDaily();
  }

  /** 구구단만 — 단 고르기를 첫 화면 안에서(예전엔 화면 하나를 더 거쳤다: 3탭 → 2탭) */
  renderDanRow() {
    const row = $('#dan-row');
    row.textContent = '';
    row.hidden = this.subject !== 'gugudan';
    if (row.hidden) return;
    const chosen = new Set(this.scope || []);
    const mk = (label, dan) => {
      const b = el('button', 'dan-chip', label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(dan === 'all' ? chosen.size === 0 : chosen.has(dan)));
      b.addEventListener('click', () => {
        if (dan === 'all') chosen.clear();
        else if (chosen.has(dan)) chosen.delete(dan); else chosen.add(dan);
        this.scope = chosen.size ? [...chosen].sort((x, y) => x - y) : null;
        this.sound.play('button');
        this.renderDanRow();
      });
      row.append(b);
    };
    mk('전체', 'all');
    for (let d = 2; d <= 9; d++) mk(`${d}단`, d);
  }

  /** 모드 카드(키트 틀) — 카드마다 «지금 고른 과목»의 최고 기록 */
  renderModes() {
    const box = $('#modeGrid');
    const plan = planForNow(this.subject);
    const stars = todayStars(this.data.flags, plan);
    renderModeCards(box, MODE_CARDS.map((c) => {
      const label = c.id === 'daily' ? '오늘의 계단' : MODES[c.id].label;
      const best = c.id === 'daily'
        ? (stars ? `오늘 별 ${stars}개` : '')
        : ((this.data.best[this.bestKey(this.subject, c.id)] || 0) ? `최고 ${this.data.best[this.bestKey(this.subject, c.id)]}층` : '');
      return { id: c.id, kind: c.kind, icon: icon(MODE_ICON[c.id]), label, desc: c.desc, best };
    }), (id) => this.play(() => this.startMode(id)));
    for (const b of box.querySelectorAll('.gb-mode')) b.classList.toggle('is-current', b.dataset.id === this.mode);
  }

  // ── 여정 ────────────────────────────────────────────────
  /**
   * 🔴 «지금 고른 과목»의 여정만 보여 준다. 셋을 한꺼번에 늘어놓으면 그건 여정이 아니라 표가 된다.
   * 🔴 잠긴 구간도 «이름을 보여 준다». 조사에서 빈 도감 실루엣이 자이가르닉 효과를 만든다고
   *    갈렸다 — 뭐가 있는지 모르면 가고 싶지도 않다. 다만 조건은 정직하게 적는다.
   */
  renderJourney() {
    const ul = $('#zone-list');
    if (!ul) return;
    ul.textContent = '';
    $('#journey-subject').textContent = SUBJECTS[this.subject] ? SUBJECTS[this.subject].label : '';
    const best = this.data.best[this.bestKey()] || 0;
    const zones = journeyOf(best);
    zones.forEach((z, i) => {
      const li = el('li', 'zone' + (z.done ? ' done' : '') + (z.locked ? ' locked' : ''));
      const zi = el('span', 'zone-icon');
      zi.innerHTML = icon(z.locked ? 'lock' : z.icon);
      li.append(zi);
      const box = el('span', 'zone-box');
      box.append(el('b', 'zone-name', z.name));
      const range = Number.isFinite(z.to) ? `${z.from}~${z.to}층` : `${z.from}층~`;
      box.append(el('span', 'zone-range', range));
      li.append(box);
      const state = el('span', 'zone-state');
      if (z.locked) {
        state.textContent = `${zones[i - 1].name} 완주하면`;
      } else if (z.done) {
        state.textContent = '완주';
        state.classList.add('is-done');
      } else if (Number.isFinite(z.to)) {
        state.textContent = `${Math.max(0, best - z.from + 1)} / ${z.span}`;
      } else {
        state.textContent = best >= z.from ? `${best}층` : '';
      }
      li.append(state);
      ul.append(li);
    });
  }

  // ── 오늘의 계단 ─────────────────────────────────────────
  renderDaily() {
    const plan = planForNow(this.subject);
    const stars = todayStars(this.data.flags, plan);
    $('#daily-day').textContent = plan.day.slice(5).replace('-', '월 ') + '일';
    $('#daily-goal').textContent = `목표 ${plan.goal}층`;
    $('#daily-rule').textContent = plan.rule ? plan.rule.label : '오늘은 특별한 규칙이 없어요';
    $('#daily-stars').textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
    // 🔴 이미 별 3개를 받았어도 «잠그지» 않는다(모드 카드로 언제든 다시). 다만 «다 했다»를 알려 종료점을 만든다(D40 취지).
    $('#daily-stars').setAttribute('aria-label', stars >= 3 ? '오늘 별 3개 — 다 모았어요' : `오늘 별 ${stars}개`);

    const wv = weekView(this.data.week, Date.now());
    const marks = $('#week-marks');
    marks.textContent = '';
    ['월', '화', '수', '목', '금', '토', '일'].forEach((d, i) => {
      const li = el('li', 'week-mark' + (wv.marks[i] ? ' on' : ''));
      li.textContent = d;
      marks.append(li);
    });
    // 🔴 «남은 날»을 세지 않는다(D39). 찍은 칸만 말한다.
    $('#week-count').textContent = wv.done ? `${wv.count}일 · 황금 계단` : `${wv.count}일`;
  }

  // ── 런 ──────────────────────────────────────────────────
  /**
   * 오늘의 계단으로 한 판.
   * 🔴 시드를 «날짜에서» 받는다 — 그래서 서버 없이도 전국이 같은 판이 된다(D37).
   *    일반 런의 seedFn(무작위)과 섞이지 않게 startRun 에 넘겨 준다.
   */
  startDaily(subject) {
    this.subject = subject;
    this.daily = planForNow(subject);
    this.scope = this.daily.scope;      // 오늘의 규칙(구구단 단 제한). 영단어면 null.
    this.startRun({ seed: this.daily.seed });
  }

  startRun(opts = {}) {
    this.endRun(true);
    // 🔴 오늘의 계단이 아니면 daily 를 «반드시» 끈다. 안 끄면 다음 일반 런의 결과가
    //    오늘의 깃발로 기록된다 — 상태가 새는 전형적인 자리다(smokeMode 와 같은 이유).
    if (opts.seed === undefined) this.daily = null;
    const seed = opts.seed !== undefined ? opts.seed : this.seedFn();
    // 스모크 상태가 일반 런으로 새면 봇이 대신 플레이한다 — 진입할 때마다 명시적으로 끈다.
    this.autoBot = null;
    this.smokeMode = false;
    this.smokeRun = 0;
    this.settled = false;
    this._recordFired = false;
    this.core = new GameCore({ seed, subject: this.subject, scope: this.scope, mode: this.mode, notes: this.notes });
    this.runStartCoins = this.data.coins;
    this.paused = false;
    $('#overlay-pause').hidden = true;
    this.go('play');
    this.onResize();
    if (this.scene) {
      this.scene.resetWorld();
      this.scene.setSkin(this.data.skin);
      this.scene.setTheme(this.data.theme);
    }
    // 🔴 처음이면 안내를 먼저 띄우고 «판을 멈춘 채» 기다린다. 안내를 읽는 동안 시간이
    //    흐르면(특히 아슬아슬 모드는 기력이 줄면) 읽자마자 죽는다.
    if (this.showHow()) this.paused = true;
    this.sound.unlock();
    this.sound.setBoundaries(TIER_FLOORS);
    this.sound.resetIntensity();
    this.sound.startBgm();
    this.core.start();
    this.onQuestion();
    this.lastFrame = performance.now();
  }

  endRun(silent) {
    if (this.scene) {
      this.scene.finished = true;      // 예약된 트윈·이펙트가 결과 화면을 덮지 않게 한다
      this.scene.stopAllMotion();
    }
    this.sound.stopBgm();
    this.voice.stop();
    this.updateDanger(false);
    if (!silent && this.core) this.showResult();
    this.clearChoices();
  }

  /** 중간에 그만두기 — 이번 판에서 번 것은 «잃지 않고» 정산한다 */
  quitRun() {
    // 중간에 나감 — 판이 끝나기 전이면 영수증을 «나감»으로 닫는다(90초 안이면 환불, 넘으면 끝까지 못 감)
    if (this.ticket && this.core && !this.settled) { void gbLeave(this.ticket); this.ticket = null; }
    this.paused = false;
    $('#overlay-pause').hidden = true;
    if (this.core && !this.settled) this.showResult();
    else this.endRun(true);
    this.go('title');
  }

  pause() {
    if (this.screen !== 'play' || !this.core || this.core.phase === PHASE.OVER) return;
    this.paused = true;
    this.sound.stopBgm();
    this.voice.stop();
    this.updateDanger(false);
    $('#overlay-pause').hidden = false;
  }

  resume() {
    this.paused = false;
    this.sound.startBgm();
    $('#overlay-pause').hidden = true;
    this.lastFrame = performance.now();
  }

  // ── 입력 ────────────────────────────────────────────────
  onKey(e) {
    if (this.screen !== 'play' || !this.core) return;
    if (e.key === 'Escape') { this.paused ? this.resume() : this.pause(); return; }
    if (this.paused) return;
    // 🔴 키를 누르고 있으면 keydown 이 자동 반복된다 — 막지 않으면 손을 안 떼도 다음 문항이 계속 풀린다.
    if (e.repeat) { e.preventDefault(); return; }
    const k = this.core.question ? this.core.question.choices.length : 2;
    const map = k === 3
      ? { ArrowLeft: 0, a: 0, A: 0, ArrowUp: 1, w: 1, W: 1, ArrowRight: 2, d: 2, D: 2 }
      : { ArrowLeft: 0, a: 0, A: 0, ArrowRight: 1, d: 1, D: 1 };
    const idx = map[e.key];
    if (idx == null) return;
    e.preventDefault();
    this.press(idx, 'key');
  }

  press(index, source = 'app') {
    if (!this.core || this.paused) return;
    const before = { answered: this.core.answered, hearts: this.core.hearts, floor: this.core.floor };
    const phase = this.core.phase;
    const offset = this.core.t - this.core.activeAt;
    const res = this.core.input(index);
    if (res.type === 'correct' || res.type === 'wrong' || res.type === 'timeout') this.onResolve(res);
    // QA 훅: 입력이 «어떤 상태에서 몇 ms 에» 들어와 «몇 번» 판정됐는지 기록한다.
    // 배열을 심어 둔 검사만 기록하며, 평상시에는 아무 비용이 없다.
    if (Array.isArray(this.qaLog)) {
      this.qaLog.push({
        source, index, phase, offset, timerMs: this.core.timerMs,
        type: res.type, wasAnswered: before.answered,
        heartsDelta: this.core.hearts - before.hearts,
        floorDelta: this.core.floor - before.floor,
      });
    }
    return res;
  }

  // ── 코어 이벤트 → 화면 ──────────────────────────────────
  onQuestion() {
    const q = this.core.question;
    if (!q) return;
    $('#qtext').textContent = q.prompt;
    $('#qsub').textContent = q.promptSub || '';
    this.buildChoices(q);
    // 🔴 영어→뜻 문제는 낱말을 «보여 주면서» 읽어 준다. 뜻→영어 문제에서 미리 읽으면
    //    정답을 그대로 알려 주는 것이라, 그쪽은 푼 뒤에 읽는다(onResolve).
    if (q.word) {
      if (q.dir === 'w2k') this.voice.speak(q.word, q.lang);
      else if (q.lang !== 'ko') this.voice.prefetch(q.word);   // 답을 낼 때 끊기지 않게 미리 받아만 둔다
    }
    if (this.scene) this.scene.showRow(q.choices.length);
    this.updateHud();
  }

  onResolve(res) {
    const q = this.core.question;
    const fb = $('#feedback');
    if (res.type === 'correct') {
      const floorPos = $('#hud-floor').getBoundingClientRect();
      this.J.fire('correct', { x: floorPos.left + floorPos.width / 2, y: floorPos.top + floorPos.height / 2, text: '+1', color: '#7ff8ee' });
      if (q.word && q.dir === 'k2w') this.voice.speak(q.word, q.lang);
      // 계단이 오를수록 음악이 조여든다 — 층 경계는 코어(balance)가 정하고 UI 는 받아 쓴다.
      this.sound.setIntensity(res.floor, tierIndexFor(res.floor), tierStartFor(res.floor));
      if (this.scene) this.scene.jumpTo(q.answerIndex, res.floor);
      // 세계가 구간을 따라 바뀐다(숲 → 구름 → 우주 → 용암) — 여정 이름과 보이는 세계가 같다(D52)
      if (this.scene) this.scene.setZone(ZONES[zoneIndexFor(res.floor)].id);
      this.markChoice(q.answerIndex, 'is-correct');
      // 착지 — 점프 트윈(220ms)이 끝나는 순간. 판이 그 사이 끝났으면 울리지 않는다.
      const runAt = this.core;
      clearTimeout(this._landTimer);
      this._landTimer = setTimeout(() => { if (this.core === runAt && this.screen === 'play') this.J.fire('land', { vol: 0.8 }); }, TIMING.JUMP_MS || 220);
      if (res.bonus) {
        this.J.fire('streak', { title: `${this.core.streak}연속!`, color: '#ffe066' });
        this.flashStreak(this.core.streak, res.healed);
        const sp = $('#hud-floor').getBoundingClientRect();
        this.J.fire('coin', { x: sp.left + sp.width / 2, y: sp.bottom + 24, text: '+5', color: '#ffd24a' });
        if (res.healed) {
          const hp = $('#hud-hearts').getBoundingClientRect();
          this.J.fire('heart', { x: hp.left + hp.width / 2, y: hp.bottom + 18, text: '+1', color: '#ff7a8a' });
        }
      }
      // 최고 기록을 «넘는 순간» — 결과 화면까지 기다리지 않고 판 안에서 축하한다(한 판에 한 번)
      const prevBest = this.data.best[this.bestKey()] || 0;
      if (!this._recordFired && prevBest > 0 && res.floor === prevBest + 1 && !this.smokeMode) {
        this._recordFired = true;
        this.J.fire('record', { title: '신기록!', color: '#ffd24a' });
      }
      // 10층마다 «금 발판» — 아래로 흘러가는 계단이 그대로 고도계가 된다.
      if (res.floor % 10 === 0) {
        this.J.fire('milestone', { sfx: 'coin', title: `${res.floor}층 돌파!`, color: '#ffcf6a' });
        this.say(fb, `${res.floor}층 돌파!`, 'good');
      } else if (res.boxState === 'graduated') this.say(fb, '이제 완전히 내 거!', 'good');
      else if (res.graduated === 'graduated') this.say(fb, '오늘은 이 문제 통과!', 'good');
    } else {
      this.J.fire('wrong', { sfx: res.type === 'timeout' ? 'timeout' : 'wrong', color: '#ff6b6b' });
      if (this.scene) this.scene.stumble(res.chose, q.answerIndex);
      if (res.chose != null) this.markChoice(res.chose, 'is-wrong');
      this.markChoice(q.answerIndex, 'is-correct');
      this.say(fb, res.type === 'timeout' ? `시간 초과! 정답은 ${res.answerText}` : `정답은 ${res.answerText}`, 'bad');
      if (q.word && q.dir === 'k2w') this.voice.speak(q.word, q.lang);
    }
    this.updateHud();
  }

  say(node, text, kind) {
    node.textContent = text;
    node.className = `feedback show ${kind}`;
    clearTimeout(this._sayTimer);
    this._sayTimer = setTimeout(() => { node.className = 'feedback'; }, 900);
  }

  flashStreak(streak, healed) {
    const chip = $('#streak-chip');
    chip.hidden = false;
    chip.innerHTML = `${icon('flame')}<span>${healed ? `${streak}연속! 하트 +1` : `${streak}연속!`}</span>`;
    clearTimeout(this._streakTimer);
    this._streakTimer = setTimeout(() => { chip.hidden = true; }, 1200);
  }

  // ── 선택지 버튼(DOM) ────────────────────────────────────
  clearChoices() {
    const box = $('#choices');
    box.textContent = '';
    this.choiceNodes = [];
  }

  buildChoices(q) {
    this.clearChoices();
    const box = $('#choices');
    const cols = columns(this.layout, q.choices.length);
    const longest = Math.max(...q.choices.map((t) => String(t).length));
    const sizeClass = longest >= 10 ? 'len-xl' : longest >= 7 ? 'len-l' : longest >= 4 ? 'len-m' : '';
    // 🔴 긴 보기는 «칸 폭»에서 글자 크기를 계산한다. 글자수만 보는 사다리는 2갈래와 3갈래의
    //    칸 폭 차이(163px vs 105px)를 모르고, 그래서 3갈래에서 조용히 세 줄이 됐다(실측).
    //    짧은 보기(구구단 숫자·영단어 뜻 대부분)는 지금 크기가 이미 맞아서 건드리지 않는다.
    const fitPx = longest >= CHOICE_FIT.FROM_LEN ? fitFontPx(longest, cols[0].w, q.choices) : 0;
    q.choices.forEach((text, i) => {
      // 🔴 뜻 길이에 따라 글자 등급을 준다 — 자르지 않고 «작게 해서 넣는다».
      //    문항 폭은 «가장 긴 선택지»가 정한다: 하나만 길어도 셋 다 같은 등급을 써야
      //    크기가 들쭉날쭉해 보이지 않는다.
      const b = el('button', `choice ${sizeClass}`);
      b.type = 'button';
      b.dataset.index = String(i);
      b.setAttribute('aria-label', `${i + 1}번 선택지 ${text}`);
      b.append(el('span', 'mark', ''));
      const txt = el('span', 'txt', text);
      if (fitPx) txt.style.fontSize = `${fitPx}px`;
      b.append(txt);
      const c = cols[i];
      b.style.left = `${c.x}px`;
      b.style.top = `${c.y}px`;
      b.style.width = `${c.w}px`;
      b.style.height = `${c.h}px`;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.press(i, 'pointer'); });
      b.addEventListener('click', (e) => { e.preventDefault(); });
      box.append(b);
      this.choiceNodes.push(b);
    });
  }

  markChoice(index, cls) {
    const node = this.choiceNodes[index];
    if (!node) return;
    node.classList.add(cls);
    const mark = node.querySelector('.mark');
    if (mark) mark.textContent = cls === 'is-correct' ? '✓' : '✗';
  }

  updateHud() {
    const c = this.core;
    if (!c) return;
    $('#hud-floor').textContent = c.floor;
    const hearts = $('#hud-hearts');
    const useHearts = c.rules.hearts > 0;
    hearts.hidden = !useHearts;
    if (useHearts) {
      const n = c.rules.hearts;
      if (hearts.childElementCount !== n) {
        hearts.textContent = '';
        for (let i = 0; i < n; i++) { const h = el('span', 'heart'); h.innerHTML = icon('heart'); hearts.append(h); }
      }
      [...hearts.children].forEach((h, i) => h.classList.toggle('lost', i >= c.hearts));
    }

    // 기력 게이지 — 채워진 양과 «찰 수 있는 최대치»를 같이 그린다.
    const bar = $('#hud-stamina');
    bar.hidden = c.stamina == null;
    if (c.stamina != null) {
      $('#stamina-fill').style.width = `${(c.stamina * 100).toFixed(1)}%`;
      $('#stamina-cap').style.width = `${(c.staminaCap * 100).toFixed(1)}%`;
      bar.classList.toggle('is-low', c.lowStamina);
    }

    // 판 전체 시계(60초 질주)
    const clock = $('#run-clock');
    clock.hidden = c.runEndsAt <= 0;
    if (c.runEndsAt > 0) {
      const left = c.runLeftMs / 1000;
      clock.textContent = `${left.toFixed(1)}초`;
      clock.classList.toggle('is-low', left <= 10);
    }

    this.updateDanger(c.lowStamina);
    this.updateSide();
  }

  /** PC 옆 패널 — 화면이 좁으면 CSS 가 숨긴다(값은 늘 채운다) */
  updateSide() {
    const c = this.core;
    if (!c) return;
    const best = this.data.best[this.bestKey()] || 0;
    $('#ps-subject').textContent = SUBJECTS[this.subject] ? SUBJECTS[this.subject].label : '';
    $('#ps-mode').textContent = this.daily ? '오늘의 계단' : (MODES[this.mode] || MODES.classic).label;
    $('#ps-best').textContent = `${Math.max(best, c.floor)}층`;
    $('#ps-gap').textContent = c.floor > best ? '신기록 진행 중!' : (best ? `최고까지 ${best - c.floor}층` : '');
    const zi = zoneIndexFor(Math.max(1, c.floor));
    const z = ZONES[zi];
    const from = zi === 0 ? 1 : ZONES[zi - 1].end + 1;
    $('#ps-zone').textContent = z.name;
    $('#ps-zone-bar').style.width = Number.isFinite(z.end) ? `${Math.min(100, Math.max(0, (c.floor - from + 1) / (z.end - from + 1) * 100)).toFixed(0)}%` : '100%';
    $('#ps-streak').textContent = String(c.streak);
    $('#ps-acc').textContent = c.stats.asked ? `${Math.round(c.accuracy * 100)}%` : '-';
  }

  /**
   * 아슬아슬 연출 — 가장자리가 붉게 맥동하고 심장이 뛴다.
   * 🔴 상태가 «바뀔 때만» 손댄다. 매 프레임 hidden 을 쓰면 애니메이션이 계속 처음부터 다시 돈다.
   */
  updateDanger(on) {
    if (on === this._danger) return;
    this._danger = on;
    $('#danger').hidden = !on;
    clearInterval(this._beat);
    this._beat = 0;
    if (!on) return;
    // 🔴 한 번만 울리면 «놀람»이고, 계속 울려야 «긴장»이다. 가장자리 맥동(720ms)과 같은 주기로 맞춘다.
    this.sound.play('heartbeat', 0.55);
    this._beat = setInterval(() => {
      if (!this._danger || this.paused) return;
      this.sound.play('heartbeat', 0.55);
    }, 720);
  }

  /**
   * 매 프레임 도는 HUD. 🔴 기력·판 시계는 «문항 사이에도» 흐르므로 여기 있어야 한다 —
   *    updateHud(문항 단위)에 두었더니 막대가 1.2초 동안 100%에 멈춰 있었다(D34 가 잡았다).
   */
  updateTimer() {
    const c = this.core;
    const fill = $('#timer-fill');
    if (!c) { fill.style.transform = 'scaleX(0)'; return; }

    if (c.stamina != null) {
      $('#stamina-fill').style.width = `${(c.stamina * 100).toFixed(1)}%`;
      $('#stamina-cap').style.width = `${(c.staminaCap * 100).toFixed(1)}%`;
      $('#hud-stamina').classList.toggle('is-low', c.lowStamina);
      this.updateDanger(c.lowStamina && c.phase !== PHASE.OVER);
    }
    if (c.runEndsAt > 0) {
      const left = c.runLeftMs / 1000;
      const clock = $('#run-clock');
      clock.textContent = `${left.toFixed(1)}초`;
      clock.classList.toggle('is-low', left <= 10);
    }

    if (c.phase !== PHASE.QUESTION || c.timerMs <= 0) { fill.style.transform = 'scaleX(0)'; return; }
    const r = c.timeRatio;
    fill.style.transform = `scaleX(${r.toFixed(4)})`;
    fill.className = `timer-fill${r < 0.25 ? ' danger' : r < 0.5 ? ' warn' : ''}`;
  }

  // ── 결과 ────────────────────────────────────────────────
  /**
   * 놀이 방법 안내. 🔴 처음 들어온 아이는 «어떻게 답하는지»를 모른다 —
   *    문제만 뜨고 발판이 보이는데, 그걸 누르라는 말이 어디에도 없었다(사용자 지적 2026-09-05).
   * 🔴 기기마다 다르게 적는다. 폰에서 「방향키」라고 쓰면 없는 키를 찾게 되고,
   *    PC 에서 「손가락으로」라고 쓰면 우스워진다. 둘 다 되는 기기는 둘 다 적는다.
   * 🔴 모드마다 «틀리면 무슨 일이 일어나는지»가 다르다 — 아슬아슬은 하트가 아예 없다.
   */
  showHow(force = false) {
    if (!force && this.data.seenHow) return false;
    const touch = matchMedia('(any-pointer: coarse)').matches;
    const keys = matchMedia('(any-hover: hover) and (any-pointer: fine)').matches;
    $('#how-input').textContent = touch && keys
      ? '정답이 적힌 발판을 누르거나 ← → 키를 눌러요'
      : touch ? '정답이 적힌 발판을 손가락으로 눌러요'
        : '정답이 적힌 발판을 누르거나 ← → 키를 눌러요';
    const rules = MODES[this.mode];
    $('#how-life').textContent = rules.stamina ? '기력이 확 줄어요' : `하트가 하나 줄어요 (${rules.hearts}개)`;
    $('#how-tip').textContent = rules.stamina
      ? '기력은 가만히 있어도 계속 줄어요. 빨리 맞힐수록 더 채워져요.'
      : rules.runMs ? '1분 동안 몇 층까지 오르는지 겨뤄요.'
        : '10층마다 금빛 발판이 남아요. 어디까지 올라갈 수 있을까요?';
    $('#overlay-how').hidden = false;
    return true;
  }

  hideHow() {
    $('#overlay-how').hidden = true;
    if (!this.data.seenHow) { this.data.seenHow = true; this.persist(); }
    // 🔴 안내를 띄우려고 멈춰 놨으므로 닫을 때 반드시 풀어 준다 — 안 풀면 판이 영영 멈춘다.
    //    (판 중에 «?» 로 열었을 때도 같은 자리로 돌아온다.)
    if (this.screen === 'play') {
      this.paused = false;
      $('#overlay-pause').hidden = true;
      this.lastFrame = performance.now();
    }
  }

  /** 최고 기록 키 — 모드마다 층수의 뜻이 다르므로 «과목:모드» 로 센다 */
  bestKey(subject = this.subject, mode = this.mode) { return `${subject}:${mode}`; }

  /** 왜 끝났는가 — 「그냥 끝났다」와 「기력이 바닥났다」는 다음 판의 각오가 다르다 */
  causeText() {
    if (this.lastCause === 'stamina') return '기력이 바닥났다';
    if (this.lastCause === 'time') return '1분 종료';
    return '';
  }

  showResult() {
    const c = this.core;
    if (!c || this.settled) { this.go('result'); return; }   // 정산은 런당 정확히 1회
    this.settled = true;
    const prevBest = this.data.best[this.bestKey()] || 0;
    const isBest = c.floor > prevBest;
    this.data.best[this.bestKey()] = Math.max(prevBest, c.floor);
    this.data.coins += c.coins;
    this.data.totals.runs += 1;
    this.data.totals.correct += c.stats.correct;
    this.data.totals.asked += c.stats.asked;
    const missions = applyRun(this.data, {
      correct: c.stats.correct, bestStreak: c.bestStreak, reviewCorrect: c.stats.reviewCorrect,
    }, Date.now());

    // ── 여기서부터 v4 축 ─────────────────────────────────────
    const now = Date.now();
    // 숙련도 — 이번 판에 «판정된» 문항만. 안 푼 문항은 세지 않는다.
    this.data.mastery = applyPerId(this.data.mastery, this.subject, c.stats.perId);
    // 이번 주 도장 — 연속이 아니라 누적(하루 빠져도 앞 도장이 남는다)
    const stamp = stampToday(this.data.week, now);
    this.data.week = stamp.week;
    // 오늘의 계단이었다면 깃발
    let dailyStars = 0;
    if (this.daily) {
      dailyStars = starsFor(this.daily, { floor: c.floor, accuracy: c.accuracy });
      this.data.flags = recordFlag(this.data.flags, this.daily, dailyStars);
    }
    this.persist();

    $('#result-title').textContent = isBest ? '새 기록!' : '기록';
    $('#result-floor').textContent = c.floor;
    $('#result-acc').textContent = `${Math.round(c.accuracy * 100)}%`;
    $('#result-coin').textContent = c.coins + (missions.gained || 0);
    $('#result-best').textContent = this.data.best[this.bestKey()];
    // 🔴 왜 끝났는가. 「그냥 끝났다」와 「기력이 바닥났다」는 다음 판의 각오가 다르다.
    //    causeText() 는 예전에 «정의만 되고 불리지 않아» 화면에 뜬 적이 없었다(2026-09-06 발견).
    $('#result-cause').textContent = this.causeText();

    // 🔴 «0층에서 0층 남았다»고 말하지 않는다. 아직 기록이 없는 아이에게 남은 거리를
    //    들이밀면 그건 목표가 아니라 잔소리다 — 첫 판은 그냥 첫 판이라고 말한다.
    $('#result-gap').textContent = isBest
      ? (prevBest > 0 ? '최고 기록을 넘었어요!' : '첫 기록을 세웠어요!')
      : (c.floor === 0 ? '한 층만 올라도 기록이 돼요' : `최고 기록까지 ${prevBest - c.floor}층 남았어요`);

    this.renderGoals(c, dailyStars);

    // 학교 점수 정산 — 개인 등수판은 없다(2026-10-13 사용자 «학교랭킹으로 하자»). 아이 이름은 어디에도 안 나간다.
    //    «끝까지 감» = 첫 금 발판(10층)을 넘었거나 오늘의 계단 별을 받았을 때. 실패해도 게임 흐름은 그대로(있으면 좋은 것).
    const sch = $('#result-school');
    sch.hidden = true;
    const ref = this.ticket;
    this.ticket = null;
    if (ref) {
      gbFinish(ref, c.floor >= CLEAR_FLOOR || dailyStars > 0).then((r) => {
        if (!r || !r.added || !r.school) return;
        sch.innerHTML = `${icon('school')}<span>${shortSchool(r.school)} <b>+${r.added}점</b></span>`;
        sch.hidden = false;
        this.J.fire('school', { title: `${shortSchool(r.school)} +${r.added}점`, color: '#8fe3c0' });
      }).catch(() => { /* 오프라인 — 조용히 넘어간다 */ });
    }

    const miss = $('#result-miss');
    miss.textContent = '';
    // 🔴 놓친 문제를 «전부» 보여 준다. 예전에는 첫 1개만 쓰고 나머지를 버렸다 —
    //    세 개를 틀렸는데 하나만 알려 주면 나머지 둘은 아이가 틀린 줄도 모른 채 지나간다.
    const wrong = [...new Set(c.stats.wrongIds || [])].map(describeId).filter(Boolean);
    if (wrong.length) {
      miss.append(el('div', null, `이번에 놓친 문제 ${wrong.length}개`));
      const b = el('div', 'miss-items');
      wrong.slice(0, 6).forEach((d) => b.append(el('b', null, `${d.q} → ${d.a}`)));
      miss.append(b);
      if (wrong.length > 6) miss.append(el('div', 'hint', `그리고 ${wrong.length - 6}개 더`));
      miss.append(el('div', null, '다음 판에서 다시 나와요. 이번엔 맞혀 봐요!'));
    // 🔴 «틀린 게 없다»와 «맞힌 게 있다»는 다르다. 한 문제도 못 맞히고 기력이 바닥난 판에
    //    「틀린 문제가 하나도 없었어요. 대단해요!」라고 칭찬하던 결함이 있었다(2026-09-06 발견).
    //    답하지 못한 문항은 오답으로 세지 않으므로(game.js:254) wrongIds 가 비는데,
    //    그걸 «완벽»으로 읽으면 아이는 자기가 뭘 잘했는지 모른 채 거짓 칭찬을 받는다.
    } else if (c.stats.correct > 0) {
      miss.append(el('div', null, '틀린 문제가 하나도 없었어요. 대단해요!'));
    }
    if (missions.gained) {
      miss.append(el('div', null, `오늘의 미션 달성으로 코인 +${missions.gained}`));
    }
    this.go('result');
  }

  /**
   * 결과 화면의 «미완성 목표» 목록.
   *
   * 🔴 목표가 하나뿐이면 그것을 넘은 순간 갈 곳이 없어진다. 그래서 성격이 다른 것을 겹친다 —
   *    ① 아케이드(최고 기록) ② 수집(구간·깃발) ③ 학습(숙련도). 조사에서 이 셋이 각각
   *    Doodle Jump · Infinite Stairs · Khan Academy 의 축이었다(docs/RESEARCH-retention.md).
   *
   * 🔴 «압박»이 아니라 «남은 거리»만 말한다. 「안 하면 사라져요」류 문구를 쓰지 않는다(D39).
   *    이미 이룬 것은 목표로 다시 내걸지 않는다 — 끝없는 사슬을 만들지 않기 위해서다.
   */
  renderGoals(core, dailyStars) {
    const ul = $('#result-goals');
    if (!ul) return;
    ul.textContent = '';
    const add = (name, text) => {
      const li = el('li', 'goal');
      const gi = el('span', 'goal-icon');
      gi.innerHTML = icon(name);
      li.append(gi);
      li.append(el('span', 'goal-text', text));
      ul.append(li);
    };

    const best = this.data.best[this.bestKey()] || 0;

    // ① 구간 — 지금 오르는 곳과 다음 구간까지
    const gap = nextZoneGap(best);
    if (gap && gap.gap > 0) {
      add(gap.zone.icon, `${gap.zone.name} 완주까지 ${gap.gap}층`);
    } else if (gap) {
      add(gap.zone.icon, `${gap.zone.name} 완주!`);
    }

    // ② 숙련도 — 가장 약한 칸 하나만. 여덟 개를 늘어놓으면 못하는 곳의 목록이 된다.
    const weak = weakest(this.data.mastery, this.subject);
    if (weak) add('chart', `${weak.label} ${weak.pct}%`);

    // ③ 오늘의 계단 — 했으면 별, 안 했으면 있다는 사실만
    if (this.daily) {
      add('calendar', `오늘의 계단 ${'★'.repeat(dailyStars)}${'☆'.repeat(3 - dailyStars)}`);
    } else {
      const t = todayStars(this.data.flags, planForNow(this.subject));
      if (!t) add('calendar', '오늘의 계단이 기다려요');
    }

    // ④ 이번 주 도장 — 달성했으면 축하만, 아니면 «몇 칸 찍었는지»만 말한다(남은 날 압박 금지)
    const wv = weekView(this.data.week, Date.now());
    if (wv.done) add('week', `이번 주 ${wv.count}일 — 황금 계단 열림`);
    else add('week', `이번 주 ${wv.count}일 놀았어요`);
  }

  // ── 오답노트 ────────────────────────────────────────────
  renderNotes() {
    const list = $('#notes-list');
    list.textContent = '';
    const rows = this.notes.list();
    if (!rows.length) {
      list.append(el('p', 'hint', '아직 담긴 문제가 없어요. 게임을 하다 틀리면 여기에 모여요.'));
      return;
    }
    for (const row of rows.slice(0, 60)) {
      const d = describeId(row.id);
      if (!d) continue;
      const node = el('div', 'note-row');
      const left = el('div');
      left.append(el('div', 'note-q', d.q));
      left.append(el('div', 'note-a', `→ ${d.a}`));
      node.append(left);
      const dots = '●'.repeat(row.box) + '○'.repeat(Math.max(0, SRS.MAX_BOX - row.box));
      node.append(el('div', 'note-box', dots));
      list.append(node);
    }
  }

  // ── 컬렉션 ──────────────────────────────────────────────
  renderCollection() {
    $('#coll-coins').textContent = this.data.coins;
    const mk = (kind, item, listNode) => {
      const owned = (kind === 'skin' ? this.data.ownedSkins : this.data.ownedThemes).includes(item.id);
      const active = (kind === 'skin' ? this.data.skin : this.data.theme) === item.id;
      const b = el('button', `shop-item${owned ? '' : ' locked'}`);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(active));
      const man = (this.scene && this.scene.manifest) || {};
      if (kind === 'skin') {
        const rig = (man.rig || {})[item.id];
        if (rig) {
          // 리그 아틀라스의 첫 프레임(서 있는 자세)을 CSS 로 잘라 보여 준다 — 미리보기 그림을 따로 만들지 않는다
          const th = el('div', 'rig-thumb');
          th.setAttribute('role', 'img');
          th.setAttribute('aria-label', item.name);
          th.style.backgroundImage = `url(./assets/rig/${rig.png})`;
          th.style.backgroundSize = `${(rig.size[0] / rig.frame[0]) * 100}% ${(rig.size[1] / rig.frame[1]) * 100}%`;
          th.style.backgroundPosition = '0 0';
          b.append(th);
        } else {
          const img = document.createElement('img');
          img.src = `./assets/images/char-${item.id}.webp`;
          img.alt = item.name;
          img.loading = 'lazy';
          b.append(img);
        }
      } else {
        // v2: 배경은 여정 구간이 정한다 — 여기서 고르는 것은 «발판 모양»이다
        const sw = el('div', 'sw sw-plat');
        const plat = (man.themePlatform || {})[item.id] || 'stone';
        sw.style.backgroundImage = `url(./assets/images/platform-${plat}.webp)`;
        b.append(sw);
      }
      b.append(el('div', 's-name', item.name));
      b.append(el('div', 's-price', owned ? (active ? '사용 중' : '고르기') : `● ${item.price}`));
      b.addEventListener('click', () => {
        if (owned) {
          equip(this.data, kind, item.id);
          this.sound.play('button');
        } else {
          const r = buy(this.data, kind, item.id);
          if (!r.ok) { this.sound.play('wrong'); return; }
          equip(this.data, kind, item.id);
          this.sound.play('streak');
        }
        this.persist();
        if (this.scene) {
          if (kind === 'skin') this.scene.setSkin(this.data.skin);
          else this.scene.setTheme(this.data.theme);
        }
        this.renderCollection();
      });
      listNode.append(b);
    };
    const sl = $('#skin-list'); sl.textContent = '';
    for (const s of SHOP.SKINS) mk('skin', s, sl);
    const tl = $('#theme-list'); tl.textContent = '';
    for (const t of SHOP.THEMES) mk('theme', t, tl);
  }

  // ── 설정 ────────────────────────────────────────────────
  renderSettings() {
    const list = $('#settings-list');
    list.textContent = '';
    const toggles = [
      ['sound', '소리'],
      ['reducedMotion', '흔들림 줄이기'],
      ['colorSafe', '색약 모드 (✓·✗ 함께 보이기)'],
    ];
    for (const [key, label] of toggles) {
      const row = el('div', 'setting-row');
      const id = `set-${key}`;
      const lab = el('label', null, label);
      lab.setAttribute('for', id);
      row.append(lab);
      const sw = el('button', 'switch');
      sw.type = 'button';
      sw.id = id;
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(!!this.data.settings[key]));
      sw.setAttribute('aria-label', label);
      sw.addEventListener('click', () => {
        this.data.settings[key] = !this.data.settings[key];
        sw.setAttribute('aria-checked', String(this.data.settings[key]));
        this.applyBodyFlags();
        this.sound.syncEnabled();
        this.persist();
      });
      row.append(sw);
      list.append(row);
    }
    const ml = $('#mission-list');
    ml.textContent = '';
    for (const m of todayMissions(this.data, Date.now())) {
      const row = el('div', `mission-row${m.claimed ? ' done' : ''}`);
      row.append(el('b', null, m.label));
      row.append(el('span', 'm-state', m.claimed ? '완료 +20' : `${m.value} / ${m.goal}`));
      ml.append(row);
    }
    $('#credits').textContent =
      '그림·소리·글자 모두 이 게임을 위해 직접 만들었습니다. 외부 광고·분석 도구를 쓰지 않고, '
      + '이름·나이·학교 같은 개인정보를 받지 않습니다. 기록은 이 기기 안에만 저장됩니다.';
  }

  // ── 레이아웃 ────────────────────────────────────────────
  onResize() {
    this.layout = computeLayout(window.innerWidth, window.innerHeight);
    const L = this.layout;
    const card = $('#qcard');
    card.style.top = `${L.cardTop}px`;
    card.style.width = `${L.contentW}px`;
    card.style.height = `${L.cardH}px`;
    if (this.core && this.core.question && this.screen === 'play') {
      const cols = columns(L, this.core.question.choices.length);
      this.choiceNodes.forEach((b, i) => {
        const c = cols[i];
        if (!c) return;
        b.style.left = `${c.x}px`;
        b.style.top = `${c.y}px`;
        b.style.width = `${c.w}px`;
        b.style.height = `${c.h}px`;
      });
    }
    if (this.scene && this.scene.ready) this.scene.applyLayout();
  }

  // ── 구동 루프 ───────────────────────────────────────────
  loop(now) {
    this.rafId = requestAnimationFrame(this.loop);
    // 숨은 탭은 visibilitychange 에서 이미 일시정지된다. 여기 클램프는 «병적인 정지»만 막는 상한이다.
    // 🔴 너무 작게 자르면(예전 50ms) 실제 경과보다 게임 시계가 느려져 «3.2초보다 오래» 답할 수 있다.
    const dt = Math.min(now - this.lastFrame, 250);
    this.lastFrame = now;
    if (this.screen !== 'play' || !this.core || this.paused) return;
    this.step(dt);
  }

  /** 시뮬 한 스텝. 스모크·플레이테스트도 이 함수를 쓴다(경로가 갈리면 검증이 무의미해진다). */
  step(dtMs) {
    if (!this.core) return;
    if (this.autoBot) {
      const r = this.autoBot(this.core, dtMs);
      if (r && (r.type === 'correct' || r.type === 'wrong' || r.type === 'timeout')) this.onResolve(r);
    }
    const events = this.core.advance(dtMs);
    for (const ev of events) {
      if (ev.type === 'question') this.onQuestion();
      else if (ev.type === 'timeout' || ev.type === 'wrong' || ev.type === 'correct') this.onResolve(ev);
      else if (ev.type === 'gameover') {
        // 스모크는 «연속 시뮬»이다 — 한 판이 끝나면 결정론적으로 다음 판을 잇는다.
        // 그래야 런 재시작 경로(GameObject 전수 리셋)가 반복 검증되고, 숨은 탭 전진도 잴 수 있다.
        if (this.smokeMode) this.smokeRestart();
        else { this.sound.play('gameover'); this.lastCause = ev.cause || 'hearts'; this.endRun(false); }
      }
    }
    this.updateTimer();
  }

  // ── 검증 계약 지원 ──────────────────────────────────────
  /** 스모크: 시드 고정 + 시뮬 리셋. 결정론 봇이 대신 플레이한다. */
  smokeSeed(n) {
    this.smokeMode = true;
    this.smokeBaseSeed = n >>> 0;
    this.smokeRun = 0;
    this.subject = 'gugudan';
    this.scope = null;
    this.paused = false;
    $('#overlay-pause').hidden = true;
    this.core = new GameCore({
      seed: n >>> 0, subject: 'gugudan',
      notes: new PersistentNotes({}), now: () => 1700000000000,
    });
    this.go('play');
    this.onResize();
    if (this.scene && this.scene.ready) this.scene.resetWorld();
    this.core.start();
    this.onQuestion();

    const rng = makeRng((n >>> 0) ^ 0x5f356495);
    let pending = null;
    this.autoBot = (core) => {
      if (core.phase !== PHASE.QUESTION) { pending = null; return null; }
      if (!core.answered && !pending) {
        const k = core.question.choices.length;
        const knows = rng() < 0.75;
        pending = {
          at: core.t + 260 + rng() * 380,
          choice: knows ? core.question.answerIndex : Math.floor(rng() * k) % k,
        };
      }
      if (pending && core.t >= pending.at) {
        const choice = pending.choice;
        pending = null;
        return this.core.input(choice);
      }
      return null;
    };
  }

  /** 스모크 전용: 같은 시드에서 결정론적으로 다음 판을 잇는다(저장소에 쓰지 않는다) */
  smokeRestart() {
    this.smokeRun += 1;
    const next = (this.smokeBaseSeed + this.smokeRun * 2654435761) >>> 0;
    this.core = new GameCore({
      seed: next, subject: 'gugudan',
      notes: new PersistentNotes({}), now: () => 1700000000000,
    });
    if (this.scene && this.scene.ready) this.scene.resetWorld();
    this.core.start();
    this.onQuestion();
  }

  /**
   * 안정 해시 — «의미 있는 상태»만 넣는다.
   * 🔴 시계(t)를 넣으면 무동작 구현도 해시가 매번 바뀌어 결정론 검사가 자명하게 통과한다.
   */
  hash() {
    const c = this.core;
    if (!c) return '0';
    const q = c.question;
    const parts = [
      c.floor, c.hearts, c.coins, c.streak, c.phase,
      c.stats.asked, c.stats.correct, c.stats.timeouts, this.smokeRun || 0,
      q ? q.id : '-', q ? q.answerIndex : '-', q ? q.choices.join(',') : '-',
    ].join('|');
    let h = 0x811c9dc5;
    for (let i = 0; i < parts.length; i++) {
      h ^= parts.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
  }
}

export { emptySave };
