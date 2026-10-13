// 낱말 발음 — 영어 문제에서 «귀로도» 만나게 한다.
//
// 🔴 두 경로를 쓴다. ① 파일(EchoTale 에서 가져온 원어민급 TTS, 943개) ② 브라우저 음성
//    (speechSynthesis, 파일 없는 264개). 하나로 통일하지 못한 이유는 원본 코퍼스에 없는
//    낱말이 264개 있어서다 — 그 낱말들을 «소리 없이» 두면 아이 입장에선 그냥 고장이다.
// 🔴 첫 문제 «전»에는 받지 않는다(943개 3.8MB 를 preload 하면 첫 문제까지 전송량이 두 배).
//    대신 판이 시작되면 그 과목 낱말을 뒤에서 차례로 받아 «디코드된 소리»로 쥐고 있다가(warm),
//    문제가 뜨는 순간 WebAudio 로 바로 튼다. 2026-10-13 사용자 «위로 갈수록 빨리 맞춰야 하는데 영어 낭독이 딜레이»:
//    그때그때 HTMLAudio 로 받던 시절 실측 427~819ms(모바일 왕복 120ms 가정) — 높은 층 제한시간 0.85초의 대부분이었다.
// 🔴 Audio 객체를 매번 새로 만들지 않는다 — 모바일에서 재생 인스턴스가 쌓이면 소리가 겹친다.

const DIR = './assets/say';

export class Say {
  /**
   * @param {() => boolean} enabledFn 설정에서 소리가 켜져 있는가
   * @param {Set<string>} haveFiles 파일이 있는 낱말(소문자)
   */
  constructor(enabledFn, haveFiles) {
    this.enabledFn = enabledFn || (() => true);
    this.have = haveFiles || new Set();
    this.cache = new Map();     // 낱말 → HTMLAudioElement
    this.el = null;             // 지금 울리는 것
    this.lastSpoken = null;     // QA 훅
    this.failed = [];
    this.ctxFn = () => null;     // WebAudio 컨텍스트(Phaser 사운드 매니저 것 — 이미 언락돼 있다)
    this.buffers = new Map();    // 낱말 → AudioBuffer(디코드 끝)
    this.loading = new Map();    // 낱말 → Promise
    this.queue = [];             // warm 대기열
    this.active = 0;
    this.src = null;             // 지금 울리는 BufferSource
    this.stats = { instant: 0, late: 0 };   // QA 훅 — 문제가 뜰 때 소리가 이미 준비돼 있었는가
  }

  /** WebAudio 컨텍스트를 알려 준다(없으면 HTMLAudio 로만 읽는다) */
  useContext(fn) { this.ctxFn = fn || (() => null); }

  /** 낱말 하나를 받아 디코드한다 — 같은 낱말은 한 번만 */
  load(k) {
    const ctx = this.ctxFn();
    if (!ctx || this.buffers.has(k)) return Promise.resolve(this.buffers.get(k) || null);
    if (this.loading.has(k)) return this.loading.get(k);
    const pr = fetch(`${DIR}/${k}.m4a`)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then((buf) => { this.buffers.set(k, buf); return buf; })
      .catch((e) => { this.failed.push(`load ${k}: ${e && e.message}`); return null; })
      .finally(() => this.loading.delete(k));
    this.loading.set(k, pr);
    return pr;
  }

  /** 이번 판에 나올 수 있는 낱말들을 뒤에서 차례로 받아 둔다(앞쪽 = 먼저 나올 것). 동시 6개(낱말 하나 4KB) */
  warm(words) {
    if (!this.ctxFn()) return;
    const seen = new Set(this.queue);
    for (const w of words) {
      const k = String(w).toLowerCase();
      if (this.has(k) && !this.buffers.has(k) && !seen.has(k)) { this.queue.push(k); seen.add(k); }
    }
    this.pump();
  }

  pump() {
    while (this.active < 6 && this.queue.length) {
      const k = this.queue.shift();
      if (this.buffers.has(k)) continue;
      this.active += 1;
      this.load(k).finally(() => { this.active -= 1; this.pump(); });
    }
  }

  has(word) { return this.have.has(String(word).toLowerCase()); }

  /** 다음 문제 낱말을 미리 받아 둔다 — 첫 재생이 끊기지 않게 */
  prefetch(word) {
    if (!word || !this.has(word)) return;
    const k = String(word).toLowerCase();
    if (this.ctxFn()) { this.load(k); return; }
    if (this.cache.has(k)) return;
    try {
      const a = new Audio(`${DIR}/${k}.m4a`);
      a.preload = 'auto';
      this.cache.set(k, a);
    } catch (e) { this.failed.push(`prefetch ${k}: ${e && e.message}`); }
  }

  /**
   * @param {string} word 읽을 말
   * @param {'en'|'ko'} [lang] 어느 말로 읽는가. 🔴 기본이 영어인 이유는 파일 943개가 전부 영어라서다 —
   *        국어 어휘는 파일이 없으므로 «파일 경로 자체를 타면 안 된다». 소문자화한 한글 낱말이
   *        우연히 영어 파일 이름과 겹칠 일은 없지만, 겹치지 않는다는 것에 기대는 대신 길을 나눈다.
   * @returns {'file'|'tts'|'off'|'fail'} 어느 경로로 읽었는가
   */
  speak(word, lang = 'en') {
    if (!this.enabledFn() || !word) return 'off';
    const k = String(word).toLowerCase();
    this.stop();
    if (lang === 'en' && this.has(k)) {
      const ctx = this.ctxFn();
      const buf = ctx && this.buffers.get(k);
      if (buf) {
        try {
          if (ctx.state === 'suspended') ctx.resume();
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          src.start(0);
          this.src = src;
          this.stats.instant += 1;
          this.lastSpoken = { word: k, via: 'file', instant: true };
          return 'file';
        } catch (e) { this.failed.push(`buffer ${k}: ${e && e.message}`); }
      }
      this.stats.late += 1;
      if (ctx) this.load(k);   // 다음에 나올 땐 바로 울리게
      try {
        let a = this.cache.get(k);
        if (!a) { a = new Audio(`${DIR}/${k}.m4a`); this.cache.set(k, a); }
        a.currentTime = 0;
        const p = a.play();
        if (p && p.catch) p.catch((e) => this.failed.push(`play ${k}: ${e && e.message}`));
        this.el = a;
        this.lastSpoken = { word: k, via: 'file' };
        return 'file';
      } catch (e) { this.failed.push(`file ${k}: ${e && e.message}`); }
    }
    // 파일이 없는 낱말 — 브라우저가 읽는다. 목소리는 다르지만 «소리가 없는» 것보다 낫다.
    try {
      const synth = window.speechSynthesis;
      if (!synth) return 'fail';
      const u = new SpeechSynthesisUtterance(word);
      u.lang = lang === 'ko' ? 'ko-KR' : 'en-US';
      u.rate = 0.85;          // 아이가 따라 할 수 있는 속도
      synth.cancel();
      synth.speak(u);
      this.lastSpoken = { word: k, via: 'tts', lang };
      return 'tts';
    } catch (e) {
      this.failed.push(`tts ${k}: ${e && e.message}`);
      return 'fail';
    }
  }

  stop() {
    try { if (this.src) this.src.stop(); } catch { /* 이미 끝남 */ }
    this.src = null;
    try { if (this.el) { this.el.pause(); this.el.currentTime = 0; } } catch { /* 이미 정리됨 */ }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* 미지원 */ }
    this.el = null;
  }

  /** QA 훅 */
  report() {
    return { files: this.have.size, cached: this.cache.size, decoded: this.buffers.size, queued: this.queue.length,
      instant: this.stats.instant, late: this.stats.late, last: this.lastSpoken, failed: this.failed.slice() };
  }
}
