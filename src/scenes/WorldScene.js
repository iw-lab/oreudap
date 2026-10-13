// Phaser 월드 — 배경·발판·캐릭터·이펙트만 그린다.
// 글자와 터치 타깃은 여기 없다(DOM 오버레이). 그래야 44px·28px·대비를 실제로 잴 수 있다.
//
// 🔴 «올라가는 느낌»의 정본 구조:
//    캐릭터를 화면에 붙박아 두고 «세계»를 한 층씩 아래로 흘려보낸다.
//    이전 구조는 점프 후 캐릭터를 원래 좌표로 되돌려 놓아서, 세계가 그대로인 채
//    캐릭터만 제자리 뛰기를 했다. 배경 46px 스크롤은 3500px 그라데이션에서 1.3%라 보이지도 않았다.
//    지금은 ① 밟은 발판이 캐릭터를 따라 내려오고 ② 그 아래로 지나온 계단이 2~3개 쌓이며
//    ③ 배경이 같은 리듬으로(더 느리게) 흘러 시차를 만든다.

import Phaser from 'phaser';
import { computeLayout, columns } from '../ui/layout.js';

const BG_W = 720;
const BG_H = 1280;
const BG_PARALLAX = 0.55;      // 배경은 발판보다 느리게 흐른다 = 깊이
const POOL = 12;               // 발판 스프라이트 풀(지나온 층 최대 5 + 갈래 3 + 여유)
const MILESTONE_EVERY = 10;    // 이 층마다 «금 발판» — 아래로 흘러가며 고도계 역할을 한다
const DEPTH_FADE = 0.13;       // 한 층 내려갈 때마다 흐려지는 정도
const DEPTH_SHRINK = 0.055;    // 한 층 내려갈 때마다 작아지는 정도(원근)
const ZONE_FADE_MS = 1000;     // 구간이 바뀔 때 세계가 넘어가는 시간(한 곡만 울리는 BGM 처럼 «한 장만» 보이게 겹쳐 바꾼다)
/** 구간별 떠다니는 것(중경) — 시차의 가운데 층. 'spark' 텍스처 하나에 색·움직임만 바꾼다 */
const AMBIENT = {
  forest: { tint: [0x9be37a, 0xd9f28b, 0xffe08a], speedY: { min: 18, max: 46 }, speedX: { min: -24, max: 24 }, scale: { start: 0.55, end: 0.2 }, alpha: { start: 0.8, end: 0 }, lifespan: 5200, freq: 360, fromTop: true },
  cloud: { tint: [0xffffff, 0xe6f1ff], speedY: { min: 10, max: 22 }, speedX: { min: 8, max: 26 }, scale: { start: 1.3, end: 0.6 }, alpha: { start: 0.35, end: 0 }, lifespan: 6800, freq: 520, fromTop: true },
  space: { tint: [0xffffff, 0xc9b8ff, 0x9fe8ff], speedY: { min: 4, max: 12 }, speedX: { min: -6, max: 6 }, scale: { start: 0.35, end: 0.05 }, alpha: { start: 1, end: 0 }, lifespan: 3600, freq: 160, fromTop: true },
  lava: { tint: [0xffb347, 0xff7a3d, 0xffe08a], speedY: { min: -70, max: -30 }, speedX: { min: -16, max: 16 }, scale: { start: 0.5, end: 0.05 }, alpha: { start: 1, end: 0 }, lifespan: 3200, freq: 140, fromTop: false },
};

/** 발판 스프라이트의 «걸어 다니는 윗면»은 그림 위에서 이 비율만큼 내려온 자리다(원근 슬래브). */
const PLAT_SURFACE = 0.28;
const PLAT_MAX_H = 0.38;   // 한 층 높이 대비 발판 두께 상한 — 넘으면 캐릭터가 파묻힌다

/** 발판 하나의 표시 크기 — 열 폭에서 뽑되 «한 층»을 넘지 않게 깎는다 */
function platSize(layout, branches, depth, aspect) {
  const colW = (layout.bandW || layout.contentW) / branches;
  let w = colW * 0.86 * (1 - DEPTH_SHRINK * depth);
  let h = w * aspect;
  const cap = layout.floorH * PLAT_MAX_H * (1 - DEPTH_SHRINK * depth);
  if (h > cap) { h = cap; w = h / aspect; }
  return { w, h };
}

/** 🔴 발판 중심은 «발밑»보다 이만큼 아래다 — 발이 슬래브 윗면에 닿게.
 *  올라갈 때와 밟은 뒤가 같은 값을 써야 착지 순간 발판이 튀지 않는다. */
function platOffset(layout, platH) { return platH * (0.5 - PLAT_SURFACE); }

export class WorldScene extends Phaser.Scene {
  constructor() {
    super('World');
  }

  /**
   * 🔴 씬 재시작 경로가 있으므로 GameObject 를 담는 «모든» 필드를 여기서 전수 리셋한다.
   *    일부만 리셋하면 파괴된 객체에 setTexture 를 불러 캔버스 null 로 크래시한다.
   */
  init(data = {}) {
    this.manifest = data.manifest || this.manifest || { images: {}, themePlatform: {} };
    this.theme = data.theme || 'dawn';
    this.skin = data.skin || 'fox';
    this.reduced = !!data.reducedMotion;

    this.bgA = null;
    this.bgB = null;
    this.bgC = null;        // 구간 전환용 겹침 한 쌍(새 세계가 위에서 서서히 나타난다)
    this.bgD = null;
    this.zone = data.zone || 'forest';
    this.ambient = null;
    this.world = null;
    this.pool = [];         // 발판 스프라이트 전체
    this.free = [];         // 반납된 스프라이트
    this.row = [];          // 이번 문항의 «올라갈» 발판들
    this.stack = [];        // 지나온 발판들(깊이 0 = 지금 밟고 선 것)
    this.char = null;
    this.shadow = null;
    this.emitterSpark = null;
    this.emitterCrack = null;
    this.tracked = [];      // 우리가 만든 트윈 — killTweensOf 는 참조 일치만 보므로 직접 들고 있는다
    this.timers = [];       // delayedCall 핸들 — 종료 경로에서 명시 취소
    this.finished = false;
    this.scrollY = 0;
    this.targetScrollY = 0;
    this.layout = null;
    this.cols = [];
    this.branches = 2;
    this.charCol = 0;
    this.floorsClimbed = 0;
    this.pendingLand = null;
    this.pose = 'idle';
    this.ready = false;
  }

  preload() {
    const imgs = this.manifest.images || {};
    for (const [key, meta] of Object.entries(imgs)) {
      if (!this.textures.exists(key)) this.load.image(key, `./assets/images/${meta.file}`);
    }
    // 🦴 리그 캐릭터(Firefly 3D + 뼈대 → 액션 프레임 아틀라스). «지금 고른 캐릭터 하나만» 첫 판 전에 받는다 —
    //    일곱을 다 받으면 첫 문제까지 전송량 예산(D25)을 캐릭터가 다 먹는다. 나머지는 고를 때 받는다(setSkin).
    const rig = (this.manifest.rig || {})[this.skin];
    if (rig && !this.textures.exists(`rig-${this.skin}`)) this.load.atlas(`rig-${this.skin}`, `./assets/rig/${rig.png}`, `./assets/rig/${rig.json}`);
    const audio = this.manifest.audio || {};
    for (const [key, meta] of Object.entries(audio)) {
      if (this.cache.audio.exists(key)) continue;
      if (meta.lazy) continue;   // 강도 BGM 은 판 중에 받는다(main.js 주석)
      const urls = [];
      if (meta.ogg) urls.push(`./assets/audio/${meta.ogg}`);
      if (meta.m4a) urls.push(`./assets/audio/${meta.m4a}`);
      if (urls.length) this.load.audio(key, urls);
    }
    // 로더가 조용히 실패하면 「콘솔 0건인 채로 영영 무음」이 된다 — 실패를 들고 있는다.
    this.loadErrors = [];
    this.load.on('loaderror', (file) => this.loadErrors.push(file && file.key));
  }

  create() {
    this.makeParticleTexture();

    const themePlatform = this.manifest.themePlatform || {};
    const platKey = `platform-${themePlatform[this.theme] || 'stone'}`;
    const bgKey = this.bgKeyFor(this.zone);

    this.bgA = this.add.image(0, 0, bgKey).setOrigin(0, 0);
    this.bgB = this.add.image(0, 0, bgKey).setOrigin(0, 0);
    // 🔴 위쪽 타일을 상하 반전해 두면 이음매의 두 줄이 «같은 픽셀»이 된다 —
    //    하늘 그라데이션은 위아래가 다르므로 반전 없이 이어 붙이면 층마다 색이 튄다.
    this.bgA.setFlipY(true);
    this.bgC = this.add.image(0, 0, bgKey).setOrigin(0, 0).setFlipY(true).setVisible(false);
    this.bgD = this.add.image(0, 0, bgKey).setOrigin(0, 0).setVisible(false);
    this.startAmbient(this.zone);

    // 월드 컨테이너 — 이 컨테이너의 y 를 내리는 것이 곧 «올라가는 것»이다.
    this.world = this.add.container(0, 0);
    this.pool = Array.from({ length: POOL }, () => {
      const p = this.add.image(0, 0, platKey).setOrigin(0.5, 0.5).setVisible(false);
      this.world.add(p);
      return p;
    });
    this.free = this.pool.slice();

    this.shadow = this.add.ellipse(0, 0, 60, 16, 0x000000, 0.28);
    this.char = this.makeChar(this.skin);
    this.world.add(this.shadow);
    this.world.add(this.char);

    this.emitterSpark = this.add.particles(0, 0, 'spark', {
      speed: { min: 60, max: 220 }, angle: { min: 200, max: 340 },
      scale: { start: 0.9, end: 0 }, alpha: { start: 1, end: 0 },
      lifespan: 620, quantity: 12, emitting: false, blendMode: 'ADD',
    });
    this.emitterCrack = this.add.particles(0, 0, 'spark', {
      speed: { min: 40, max: 150 }, angle: { min: 250, max: 290 },
      scale: { start: 0.7, end: 0 }, alpha: { start: 0.9, end: 0 },
      tint: 0xff8a96, lifespan: 520, quantity: 10, emitting: false,
    });

    this.applyLayout();
    this.scale.on('resize', this.applyLayout, this);
    this.events.once('shutdown', () => {
      // 🔴 ready 를 내리지 않으면 App 이 «죽은 씬»에 계속 그리기를 시킨다.
      this.ready = false;
      this.scale.off('resize', this.applyLayout, this);
      this.stopAllMotion();
    });

    this.ready = true;
  }

  /** 파티클용 작은 텍스처는 결정론 생성이 낫다(기하학 자산) */
  makeParticleTexture() {
    if (this.textures.exists('spark')) return;
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(8, 8, 7);
    g.generateTexture('spark', 16, 16);
    g.destroy();
  }

  // ── 발판 풀 ────────────────────────────────────────────
  acquire() {
    const p = this.free.pop() || this.stack.pop();   // 풀이 마르면 «가장 깊은» 것을 뺏어 온다
    if (!p) return null;
    p.setVisible(true).setAlpha(1).clearTint().setAngle(0);
    return p;
  }

  release(p) {
    if (!p) return;
    p.setVisible(false).clearTint();
    if (!this.free.includes(p)) this.free.push(p);
  }

  /** 발판 하나의 표시 크기 — 열 폭에서 나온다(3갈래에서 겹치지 않게) */
  sizePlatform(p, branches, depth = 0) {
    const { w, h } = platSize(this.layout, branches, depth, p.height / p.width);
    p.setDisplaySize(w, h);
    return h;
  }

  applyLayout() {
    const w = this.scale.width;
    const h = this.scale.height;
    if (!w || !h || !this.bgA) return;
    this.layout = computeLayout(w, h);

    const scale = Math.max(w / BG_W, h / BG_H);
    for (const bg of [this.bgA, this.bgB, this.bgC, this.bgD]) if (bg) bg.setScale(scale);
    this.bgH = BG_H * scale;
    this.bgX = (w - BG_W * scale) / 2;
    this.updateBackground();

    // 떠다니는 것의 범위도 화면 크기를 따른다
    if (this.ambient && (this._ambW !== w || this._ambH !== h)) { this._ambW = w; this._ambH = h; this.startAmbient(this.zone); }
    this.cols = columns(this.layout, this.branches);
    this.world.setPosition(0, this.layout.charY);

    // 지나온 계단 — 저장해 둔 «정규화 x»와 깊이로 다시 놓는다(리사이즈 안전)
    this.stack.forEach((p, depth) => {
      const ph = this.sizePlatform(p, p.__branches || 2, depth);
      p.setPosition((p.__nx || 0.5) * w, depth * this.layout.floorH + platOffset(this.layout, ph));
      p.setAlpha(Math.max(0.25, 1 - DEPTH_FADE * depth));
    });
    this.positionRow();

    this.char.setDisplaySize(this.layout.charSize, this.layout.charSize);
    this.shadow.setSize(this.layout.charSize * 0.62, this.layout.charSize * 0.18);
    this.positionChar();
  }

  updateBackground() {
    if (!this.bgA) return;
    const off = ((this.scrollY % this.bgH) + this.bgH) % this.bgH;
    this.bgA.setPosition(this.bgX, off - this.bgH);
    this.bgB.setPosition(this.bgX, off);
    if (this.bgC) { this.bgC.setPosition(this.bgX, off - this.bgH); this.bgD.setPosition(this.bgX, off); }
  }

  /** 구간 → 배경 키. 구간 그림이 없으면(옛 매니페스트) 고른 하늘 테마로 */
  bgKeyFor(zone) {
    const k = `zone-${zone}`;
    return this.textures.exists(k) ? k : `bg-${this.theme}`;
  }

  /**
   * 세계 바꾸기 — 여정 구간이 바뀌는 층(21·51·91)에서 부른다.
   * 🔴 두 장을 «겹쳐 둔 채» 멈추지 않는다 — 새 장이 다 나타나면 아래 장을 바꿔 끼우고 겹침을 숨긴다.
   */
  setZone(zone, { instant = false } = {}) {
    if (!zone || zone === this.zone || !this.bgA) { this.zone = zone || this.zone; return; }
    this.zone = zone;
    const key = this.bgKeyFor(zone);
    this.startAmbient(zone);
    if (instant || this.reduced || !this.textures.exists(key)) {
      for (const bg of [this.bgA, this.bgB]) bg.setTexture(key);
      this.bgC.setVisible(false); this.bgD.setVisible(false);
      return;
    }
    for (const bg of [this.bgC, this.bgD]) bg.setTexture(key).setVisible(true).setAlpha(0);
    this.updateBackground();
    this.track(this.tweens.add({
      targets: [this.bgC, this.bgD], alpha: 1, duration: ZONE_FADE_MS, ease: 'Sine.easeInOut',
      onComplete: () => {
        for (const bg of [this.bgA, this.bgB]) bg.setTexture(key);
        this.bgC.setVisible(false); this.bgD.setVisible(false);
      },
    }));
  }

  /** 중경 — 구간마다 떠다니는 것(잎·구름 조각·별·불씨). 배경보다 앞, 발판보다 뒤 */
  startAmbient(zone) {
    const a = AMBIENT[zone];
    if (this.ambient) { this.ambient.destroy(); this.ambient = null; }
    if (!a || this.reduced) return;
    const w = this.scale.width || 400, h = this.scale.height || 700;
    this.ambient = this.add.particles(0, 0, 'spark', {
      x: { min: 0, max: w }, y: a.fromTop ? { min: -20, max: h * 0.6 } : { min: h * 0.5, max: h + 20 },
      speedY: a.speedY, speedX: a.speedX, scale: a.scale, alpha: a.alpha, tint: a.tint,
      lifespan: a.lifespan, frequency: a.freq, quantity: 1, blendMode: zone === 'cloud' ? 'NORMAL' : 'ADD',
    });
    // 배경(bgA~D) 바로 위 = 월드 컨테이너 아래
    if (this.world) this.children.moveBelow(this.ambient, this.world);
  }

  /** 현재 문항의 갈래 수에 맞춰 «한 층 위» 발판 행을 세운다 */
  showRow(branches) {
    this.branches = branches;
    if (!this.layout) return;
    this.settleNow();
    this.row.forEach((p) => this.release(p));
    this.cols = columns(this.layout, branches);
    this.row = [];
    for (let i = 0; i < branches; i++) {
      const p = this.acquire();
      if (!p) break;
      p.__branches = branches;
      const ph = this.sizePlatform(p, branches, 0);
      const c = this.cols[i];
      p.__nx = c.cx / this.layout.w;
      p.setPosition(c.cx, -this.layout.floorH + platOffset(this.layout, ph));
      p.setAlpha(0);
      const sx = p.scaleX; const sy = p.scaleY;
      p.setScale(sx * 0.86, sy * 0.86);
      this.track(this.tweens.add({
        targets: p, alpha: 1, scaleX: sx, scaleY: sy,
        duration: this.reduced ? 1 : 170, ease: 'Back.easeOut',
      }));
      this.row.push(p);
    }
  }

  positionRow() {
    if (!this.layout) return;
    this.row.forEach((p, i) => {
      const c = this.cols[i];
      if (!c) return;
      const ph = this.sizePlatform(p, this.branches, 0);
      p.__nx = c.cx / this.layout.w;
      p.setPosition(c.cx, -this.layout.floorH + platOffset(this.layout, ph));
    });
  }

  positionChar() {
    if (!this.layout || !this.char) return;
    const under = this.stack[0];
    const x = under ? under.x : this.layout.w / 2;
    this.char.setPosition(x, 0);
    this.shadow.setPosition(x, 2);
  }

  /** 정답 — 고른 발판으로 뛰어오르고, 세계가 한 층 내려온다 */
  jumpTo(index, floor) {
    if (!this.layout || this.finished) return;
    const target = this.row[index] || this.row[0];
    if (!target) return;
    // 🔴 코어는 TIMING.JUMP_MS(220ms) 뒤에 다음 문항을 낸다 — 연출이 그보다 길면
    //    착지 중인 발판이 showRow 에서 회수된다. 총 연출을 그 안에 맞추고,
    //    그래도 겹치면 settleNow() 가 먼저 착지를 확정한다.
    const dur = this.reduced ? 1 : 150;
    const topY = -this.layout.floorH;
    this.charCol = index;
    this.setPose('jump');          // 🔴 트윈을 만들기 전에 — scale 을 다시 잡기 때문

    this.track(this.tweens.add({
      targets: [this.char, this.shadow],
      x: target.x, duration: dur, ease: 'Sine.easeInOut',
    }));
    // 캐릭터가 «한 층 위»로 오른다 — 살짝 넘겼다가 내려앉아 발이 닿는 느낌을 만든다.
    this.track(this.tweens.add({
      targets: this.char,
      y: { value: topY, duration: dur, ease: 'Back.easeOut' },
      scaleY: { value: this.char.scaleY * 1.06, duration: dur * 0.45, yoyo: true },
    }));
    this.track(this.tweens.add({
      targets: this.shadow, y: topY + 2, duration: dur, ease: 'Sine.easeOut',
    }));

    // 🔴 이 트윈이 «올라가는 느낌»의 전부다 — 세계 전체가 한 층만큼 아래로 흐른다.
    this.targetScrollY += this.layout.floorH * BG_PARALLAX;
    this.track(this.tweens.add({
      targets: this.world,
      y: this.layout.charY + this.layout.floorH,
      delay: this.reduced ? 0 : dur * 0.42,
      duration: this.reduced ? 1 : dur * 0.95,
      ease: 'Sine.easeOut',
      onComplete: () => this.land(index, floor),
    }));
    this.pendingLand = { index, floor };
  }

  /** 연출이 끝나기 전에 다음 문항이 오면 «먼저 착지시킨다» — 착지 중인 발판이 회수되지 않게 */
  settleNow() {
    if (!this.pendingLand) return;
    for (const t of this.tracked.slice()) {
      try { if (t.isPlaying && t.isPlaying()) t.complete(); } catch { /* 이미 끝남 */ }
    }
    if (this.pendingLand) this.land(this.pendingLand.index, this.pendingLand.floor);
  }

  /** 착지 — 밟은 발판을 계단에 편입하고 좌표계를 한 층 내려 재기준화한다 */
  land(index, floor) {
    if (this.finished || !this.layout) return;
    const landed = this.row[index];
    this.row.forEach((p, i) => { if (i !== index) this.release(p); });
    this.row = [];

    if (landed) {
      landed.__floor = floor;
      this.stack.unshift(landed);
      if (floor != null && floor % MILESTONE_EVERY === 0) {
        // 금 발판 — 아래로 흘러가며 «몇 층까지 왔는지»를 세계 자체로 보여 준다.
        landed.setTint(0xffcf6a);
        this.emitterSpark.setPosition(landed.x, this.layout.charY + landed.y);
        this.emitterSpark.explode(18);
      }
    }

    // 재기준화: 컨테이너를 제자리로 돌리고 좌표를 깊이에서 «다시 계산»한다.
    // 🔴 상대 증분(y += fh)이 아니라 절대값으로 놓는다 — 연출이 중간에 끊겨도 계단이 어긋나지 않는다.
    const fh = this.layout.floorH;
    this.world.y = this.layout.charY;

    const maxDepth = Math.ceil((this.layout.h - this.layout.charY) / fh) + 2;
    while (this.stack.length > maxDepth) this.release(this.stack.pop());
    this.stack.forEach((p, depth) => {
      const ph = this.sizePlatform(p, p.__branches || 2, depth);
      p.setPosition(p.x, depth * fh + platOffset(this.layout, ph));
      p.setAlpha(Math.max(0.28, 1 - DEPTH_FADE * depth));
      p.__nx = p.x / this.layout.w;
    });

    const footX = this.stack[0] ? this.stack[0].x : this.char.x;
    this.setPose('idle');
    this.char.setPosition(footX, 0);
    this.char.setScale(this.char.scaleX, Math.abs(this.char.scaleY));
    this.shadow.setPosition(footX, 2).setAlpha(0.28);
    this.floorsClimbed = floor || this.floorsClimbed + 1;
    this.pendingLand = null;
  }

  /** 오답·시간초과 — 헛디딤 + 정답 발판 강조 */
  stumble(chosenIndex, correctIndex) {
    if (!this.layout || this.finished) return;
    const wrong = chosenIndex != null ? this.row[chosenIndex] : null;
    const right = this.row[correctIndex];
    if (wrong) {
      wrong.setTint(0xff8a96);
      this.emitterCrack.setPosition(wrong.x, this.world.y + wrong.y);
      this.emitterCrack.explode(10);
      this.track(this.tweens.add({
        targets: wrong, alpha: 0.25, y: wrong.y + 26,
        duration: this.reduced ? 1 : 420, ease: 'Quad.easeIn',
      }));
    }
    if (right) {
      right.clearTint();
      this.track(this.tweens.add({
        targets: right, scaleX: right.scaleX * 1.1, scaleY: right.scaleY * 1.1,
        duration: this.reduced ? 1 : 180, yoyo: true, repeat: 1,
      }));
    }
    this.setPose('sad');
    this.track(this.tweens.add({
      targets: this.char, angle: { from: -9, to: 9 },
      duration: this.reduced ? 1 : 90, yoyo: true, repeat: 1,
      onComplete: () => { if (this.char) this.char.setAngle(0); },
    }));
    // 카메라 셰이크는 2D 한정 처방이다. reduced-motion 이면 끈다.
    if (!this.reduced) this.cameras.main.shake(130, 0.005);
  }

  /** 스트릭 축하 — 캐릭터 뒤 반짝임 */
  celebrate() {
    if (!this.char || this.finished || !this.layout) return;
    this.setPose('cheer');
    this.emitterSpark.setPosition(this.char.x, this.world.y + this.char.y - this.layout.charSize * 0.5);
    this.emitterSpark.explode(22);
  }

  // ── 캐릭터(리그 아틀라스 우선, 없으면 옛 그림) ─────────────────
  rigKey(skin) { return `rig-${skin}`; }
  hasRig(skin) { return this.textures.exists(this.rigKey(skin)); }

  /** 아틀라스 meta.anims → Phaser 애니(idle 반복 · jump/cheer/sad 한 번) */
  ensureRigAnims(skin) {
    const key = this.rigKey(skin);
    const meta = ((this.textures.get(key) || {}).customData || {}).meta || {};
    for (const [name, frames] of Object.entries(meta.anims || {})) {
      const act = name.slice(name.lastIndexOf('_') + 1);
      const ak = `${skin}-${act}`;
      if (this.anims.exists(ak)) continue;
      this.anims.create({
        key: ak, frames: frames.map((f) => ({ key, frame: f })),
        frameRate: act === 'idle' ? 10 : act === 'jump' ? 55 : 18, repeat: act === 'idle' ? -1 : 0,
      });
    }
    return meta;
  }

  makeChar(skin) {
    if (this.hasRig(skin)) {
      const meta = this.ensureRigAnims(skin);
      const fr = `${skin}_idle_00`;
      const spr = this.add.sprite(0, 0, this.rigKey(skin), this.textures.get(this.rigKey(skin)).has(fr) ? fr : undefined);
      // 발 = 아틀라스 pivot(굽기 때 잰 발바닥 자리). 없으면 맨 아래
      const fh = spr.frame ? spr.frame.height : 1;
      spr.setOrigin(0.5, meta.pivotPx ? Math.min(1, meta.pivotPx[1] / fh) : 1);
      if (this.anims.exists(`${skin}-idle`)) spr.play(`${skin}-idle`);
      spr.__rig = skin;
      return spr;
    }
    return this.add.image(0, 0, `char-${skin}`).setOrigin(0.5, 1);
  }

  setSkin(skin) {
    this.skin = skin;
    this.pose = 'idle';
    if (!this.char || !this.char.scene) return;
    const rig = (this.manifest.rig || {})[skin];
    if (rig && !this.hasRig(skin)) {
      // 고를 때 받는다 — 받는 동안은 지금 캐릭터 그대로
      this.load.atlas(this.rigKey(skin), `./assets/rig/${rig.png}`, `./assets/rig/${rig.json}`);
      this.load.once('complete', () => { if (this.skin === skin) this.setSkin(skin); });
      this.load.start();
      return;
    }
    // 아틀라스 캐릭터 ↔ 그림 캐릭터는 객체 종류가 달라 바꿔 끼운다(월드 컨테이너 안 같은 자리)
    const x = this.char.x, y = this.char.y;
    const idx = this.world ? this.world.getIndex(this.char) : -1;
    this.char.destroy();
    this.char = this.makeChar(skin);
    this.char.setPosition(x, y);
    if (this.world) { this.world.add(this.char); if (idx >= 0) this.world.moveTo(this.char, idx); }
    if (this.layout) this.char.setDisplaySize(this.layout.charSize, this.layout.charSize);
  }

  /**
   * 자세 — 리그 캐릭터는 «액션 애니»(idle 반복 · jump · cheer · sad 한 번), 옛 그림은 «점프 그림 한 장».
   * 🔴 반드시 트윈을 «만들기 전»에 부른다 — setDisplaySize 가 scale 을 다시 잡으므로
   *    도약 중에 부르면 진행 중인 scaleY 트윈과 싸운다.
   */
  setPose(pose) {
    // 🔴 파괴된 GameObject 도 «truthy» 다 — 살아 있는지는 .scene 이 남아 있는가로 본다.
    if (!this.char || !this.char.scene || !this.layout) return;
    if (this.char.__rig) {
      const ak = `${this.char.__rig}-${pose}`;
      if (!this.anims.exists(ak)) return;
      this.pose = pose;
      this.char.play(ak, pose === 'idle');
      if (pose !== 'idle') {
        this.char.once('animationcomplete', () => {
          if (this.char && this.char.scene && this.pose === pose) { this.pose = 'idle'; this.char.play(`${this.char.__rig}-idle`, true); }
        });
      }
      return;
    }
    const key = pose === 'jump' ? `char-${this.skin}-jump` : `char-${this.skin}`;
    if (!this.textures.exists(key) || this.char.texture.key === key) return;
    this.pose = pose;
    this.char.setTexture(key);
    this.char.setDisplaySize(this.layout.charSize, this.layout.charSize);
  }

  setTheme(theme) {
    this.theme = theme;
    // v2: 배경은 여정 구간이 정한다(D52). 구간 그림이 없을 때만 테마 하늘을 쓴다.
    const key = this.bgKeyFor(this.zone);
    if (this.textures.exists(key)) for (const bg of [this.bgA, this.bgB]) if (bg) bg.setTexture(key);
    const platKey = `platform-${(this.manifest.themePlatform || {})[theme] || 'stone'}`;
    if (this.textures.exists(platKey)) for (const p of this.pool) p.setTexture(platKey);
    this.applyLayout();
  }

  /** 새 런 시작 시 시각 상태 초기화 — 발밑 첫 계단 하나를 깔아 준다 */
  resetWorld() {
    this.stopAllMotion();
    this.finished = false;
    this.setZone('forest', { instant: true });
    this.scrollY = 0;
    this.targetScrollY = 0;
    this.charCol = 0;
    this.branches = 2;
    this.floorsClimbed = 0;
    this.pendingLand = null;
    for (const p of this.pool) this.release(p);
    this.free = this.pool.slice();
    this.row = [];
    this.stack = [];
    if (!this.layout) this.applyLayout();
    if (!this.layout) return;
    const ground = this.acquire();
    if (ground) {
      ground.__branches = 2;
      ground.__nx = 0.5;
      const gh = this.sizePlatform(ground, 2, 0);
      ground.setPosition(this.layout.w / 2, platOffset(this.layout, gh));
      this.stack.push(ground);
    }
    if (this.char) { this.setPose('idle'); this.char.setAngle(0).setAlpha(1); }
    this.applyLayout();
  }

  track(tween) {
    if (tween) this.tracked.push(tween);
    return tween;
  }

  /** 종료 경로 — 예약된 트윈·타이머를 «우리가 들고 있는 참조»로 명시 정리한다 */
  stopAllMotion() {
    for (const t of this.tracked) { try { t.remove(); } catch { /* 이미 정리됨 */ } }
    this.tracked = [];
    for (const t of this.timers) { try { t.remove(false); } catch { /* 이미 정리됨 */ } }
    this.timers = [];
    if (this.emitterSpark) this.emitterSpark.stop();
    if (this.emitterCrack) this.emitterCrack.stop();
    // 트윈을 중간에 끊으면 컨테이너가 «올라가다 만» 자리에 남는다 — 제자리로 되돌린다.
    if (this.world && this.layout) this.world.y = this.layout.charY;
  }

  /** QA 훅: 파괴된 대상을 도는 트윈 수(0이어야 한다) */
  zombieTweenCount() {
    return this.tracked.filter((t) => t.isPlaying && t.isPlaying()
      && (t.targets || []).some((o) => o && o.scene === undefined)).length;
  }

  /** QA 훅: 지금 캐릭터가 쓰고 있는 텍스처 키 */
  /** QA 훅: 캐릭터 «그려진» 머리 꼭대기(세계 y). 리그 프레임은 위쪽이 투명 여백이고 발이 pivot 이라
   *  `y - displayHeight` 로는 머리를 못 잰다 — 지금 프레임의 첫 불투명 줄을 찾는다(프레임마다 1회, 캐시) */
  charHeadY() {
    const c = this.char;
    if (!c || !c.scene) return null;
    if (!c.__rig) return c.y - c.displayHeight;
    const f = c.frame;
    this._topFrac = this._topFrac || new Map();
    const key = `${f.texture.key}:${f.name}`;
    if (!this._topFrac.has(key)) {
      const img = f.source.image;
      const cv = document.createElement('canvas'); cv.width = f.cutWidth; cv.height = f.cutHeight;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
      const d = g.getImageData(0, 0, f.cutWidth, f.cutHeight).data;
      let top = f.cutHeight;
      for (let y = 0; y < f.cutHeight && top === f.cutHeight; y++) {
        for (let x = 0; x < f.cutWidth; x++) if (d[(y * f.cutWidth + x) * 4 + 3] > 40) { top = y; break; }
      }
      this._topFrac.set(key, top / f.cutHeight);
    }
    return c.y - c.originY * c.displayHeight + this._topFrac.get(key) * c.displayHeight;
  }

  /** QA 훅: 지금 «자세» — 옛 그림은 텍스처 키(char-fox-jump), 리그는 애니 이름(fox-jump). 둘 다 «-jump» 로 끝나면 도약 자세 */
  charTextureKey() {
    if (!this.char || !this.char.scene) return null;
    if (this.char.__rig) return this.char.anims && this.char.anims.currentAnim ? this.char.anims.currentAnim.key : this.char.texture.key;
    return this.char.texture.key;
  }
  /** QA 훅: 리그 애니 이름·프레임 이름 */
  charAnim() { return this.char && this.char.scene ? { rig: this.char.__rig || null, anim: this.char.anims && this.char.anims.currentAnim ? this.char.anims.currentAnim.key : null, frame: this.char.frame ? this.char.frame.name : null } : null; }

  /** QA 훅: 지금 화면에 보이는 «지나온 계단» 수 */
  visibleStairs() {
    if (!this.layout) return 0;
    return this.stack.filter((p) => p.visible && this.world.y + p.y < this.layout.h + 40).length;
  }

  update(time, delta) {
    // 배경 스크롤은 프레임 델타를 클램프해서 쓴다 — 숨은 탭 복귀의 거대 delta 를 여기서 막는다.
    const dt = Math.min(delta, 50);
    if (this.scrollY !== this.targetScrollY) {
      const diff = this.targetScrollY - this.scrollY;
      this.scrollY += diff * Math.min(1, dt / 160);
      if (Math.abs(this.targetScrollY - this.scrollY) < 0.4) this.scrollY = this.targetScrollY;
      this.updateBackground();
    }
  }
}
