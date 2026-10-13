// 사운드 — 오프라인 렌더된 파일을 Phaser 로더로 싣고 Phaser 사운드 매니저로 재생한다.
//
// 🔴 왜 Phaser 로더인가: 「파일이 서빙된다」와 「그 시점에 캐시에 디코드돼 있다」는 다른 명제다.
//    Phaser 캐시에 실어야 스모크가 «디코드 N/M» 을 셀 수 있고, 그래야 배포 후 무음(1순위 버그)을
//    기계가 잡는다. 직접 WebAudio 로 디코드하면 그 검사가 통째로 불가능해진다.
// 🔴 첫 사용자 입력에서 컨텍스트를 언락하지 않으면 소리가 안 난다.

// 🔴 계단이 오를수록 음악이 조여든다 — 사용자 요구(2026-09-04): 「계단 올라갈수록 bgm도 긴장되고 빠르게」.
//    두 축을 «같이» 쓴다. 재생속도만 올리면 피치가 따라 올라가 마림바가 치핑되고(1.15배 넘어가면
//    귀에 띄게 우스워진다), 트랙만 갈면 한 트랙 안에서는 아무 변화가 없어 밋밋하다.
//    ① 트랙 = 문항 등급과 «같은 층»에서 갈린다(balance.TIER_FLOORS) — 어려워지는 걸 귀로 예고한다.
//    ② 재생속도 = 한 단계 안에서 층당 조금씩 올라가고, 단계가 바뀌면 1.0 으로 되돌아간다.
export const BGM_TIER_KEYS = ['bgm', 'bgm-tense', 'bgm-rush'];
const RATE_MAX = 1.12;        // 이 위로는 피치 상승이 «빠름»이 아니라 «이상함»이 된다
const RATE_SPAN = 18;         // 한 단계 안에서 RATE_MAX 에 닿기까지의 층수
const XFADE_MS = 900;
// 🔴 경계 몇 층 전부터 다음 트랙을 받는가. 1층부터 다 받으면 «쓸지도 모르는» 400KB 를
//    셀룰러로 당겨 오고, 판이 일찍 끝나면 그게 전부 낭비다(그리고 받다 만 요청이
//    페이지 정리와 겹쳐 콘솔 오류로 남기도 한다). 25층 곡은 21층부터면 충분하다.
const PREFETCH_LEAD = 4;

export class Sound {
  /**
   * @param {() => boolean} enabledFn 설정에서 소리가 켜져 있는가
   * @param {Phaser.Scene} scene
   * @param {string[]} keys 실렸어야 하는 키(모수)
   */
  constructor(enabledFn, scene, keys) {
    this.enabledFn = enabledFn || (() => true);
    this.scene = scene || null;
    this.keys = keys || [];
    this.unlocked = false;
    this.failed = [];
    this.manifest = null;   // 지연 로드용 — 강도 트랙은 preload 에 넣지 않는다(첫 문제 전송량)
    this.tier = 0;
    this.rate = 1;
    this.bgmVolume = 0.22;
    this.loading = new Set();
  }

  /** 강도 트랙을 «필요할 때» 받아오기 위한 매니페스트 주입 */
  setManifest(manifest) { this.manifest = manifest || null; }

  attach(scene, keys) {
    // 🔴 참조만 버리면 «전역 사운드 매니저에서 계속 울리는» BGM 이 남아 중첩된다.
    //    먼저 멈추고 파괴한 뒤에 참조를 버린다.
    try {
      if (this.bgm) this.drop(this.bgm);
    } catch { /* 이미 파괴됨 */ }
    this.bgm = null;
    this.scene = scene;
    if (keys) this.keys = keys;
    this.unlocked = false;
    this.tier = 0;
    this.rate = 1;
    this.loading.clear();
  }

  unlock() {
    if (!this.scene || this.unlocked) return;
    const mgr = this.scene.sound;
    try {
      if (mgr && mgr.locked && typeof mgr.unlock === 'function') mgr.unlock();
      if (mgr && mgr.context && mgr.context.state === 'suspended') mgr.context.resume();
      this.unlocked = true;
    } catch (e) {
      this.failed.push(`unlock: ${e && e.message}`);
    }
  }

  play(name, volume = 0.65) {
    if (!this.enabledFn() || !this.scene) return false;
    this.unlock();
    try {
      if (!this.scene.cache.audio.exists(name)) return false;
      this.scene.sound.play(name, { volume });
      return true;
    } catch (e) {
      this.failed.push(`${name}: ${e && e.message}`);
      return false;
    }
  }

  /** 배경음 — 루프. 설정에서 소리를 끄면 즉시 멈춘다. */
  startBgm(volume = this.bgmVolume) {
    if (!this.scene || !this.enabledFn()) return false;
    this.unlock();
    this.bgmVolume = volume;
    try {
      // 🔴 일시정지 후 재개는 «그 층의 강도»로 돌아와야 한다 — 30층에서 쉬었다 왔는데
      //    잔잔한 1단계 곡이 나오면 그때까지 쌓인 긴장이 통째로 리셋된다.
      const key = this.tierKey(this.tier);
      if (!this.scene.cache.audio.exists(key)) return false;
      if (this.bgm && this.bgm.pendingRemove) this.bgm = null;
      if (this.bgm && this.bgm.isPlaying) return true;
      if (!this.bgm || this.bgm.key !== key) {
        try { if (this.bgm) this.drop(this.bgm); } catch { /* 이미 파괴됨 */ }
        this.bgm = this.scene.sound.add(key, { loop: true, volume });
      }
      this.bgm.play();
      this.applyRate();
      return true;
    } catch (e) {
      this.failed.push(`bgm: ${e && e.message}`);
      return false;
    }
  }

  /** 캐시에 «실제로 있는» 트랙 중 요구 단계 이하로 가장 높은 것 */
  tierKey(tier) {
    const cache = this.scene && this.scene.cache ? this.scene.cache.audio : null;
    for (let i = Math.min(tier, BGM_TIER_KEYS.length - 1); i > 0; i -= 1) {
      if (cache && cache.exists(BGM_TIER_KEYS[i])) return BGM_TIER_KEYS[i];
    }
    return BGM_TIER_KEYS[0];
  }

  applyRate() {
    try { if (this.bgm && typeof this.bgm.setRate === 'function') this.bgm.setRate(this.rate); }
    catch (e) { this.failed.push(`rate: ${e && e.message}`); }
  }

  /**
   * 층이 오를 때마다 강도를 갱신한다.
   * @param {number} floor 현재 층
   * @param {number} tier  balance.tierIndexFor(floor) — 코어 상수를 UI 가 다시 계산하지 않는다
   * @param {number} tierFrom 이 단계가 시작된 층
   */
  /** 다음 단계가 시작되는 층(코어가 알려 준다) — 이 값이 있어야 «미리 받기»가 낭비를 피한다 */
  setBoundaries(floors) { this.boundaries = Array.isArray(floors) ? floors.slice() : []; }

  setIntensity(floor, tier, tierFrom) {
    const t = Math.max(0, Math.min(BGM_TIER_KEYS.length - 1, tier | 0));
    this.nextBoundary = (this.boundaries || [])[t] || 0;
    const into = Math.max(0, floor - (tierFrom || 1));
    this.rate = 1 + (RATE_MAX - 1) * Math.min(1, into / RATE_SPAN);
    if (t !== this.tier) { this.tier = t; this.swapTrack(); }
    else this.applyRate();
    this.prefetch(t + 1, floor);
    return { tier: this.tier, rate: this.rate, key: this.bgm ? this.bgm.key : null };
  }

  /** 다음 단계 트랙을 미리 받는다 — 경계에서 로딩을 기다리면 그 자리에서 음악이 끊긴다 */
  prefetch(tier, floor = Infinity) {
    if (tier >= BGM_TIER_KEYS.length || !this.scene || !this.manifest) return;
    // 다음 단계가 시작되는 층은 UI 가 모른다 — 대신 «지금 단계에서 몇 층 올랐는가»로 가늠하지 않고
    // 호출자가 준 층과 경계 목록을 쓴다. 경계는 setIntensity 가 tier 로 알려 주므로,
    // 여기서는 «다음 경계까지 LEAD 층 이내인가»만 본다.
    if (this.nextBoundary && floor < this.nextBoundary - PREFETCH_LEAD) return;
    const key = BGM_TIER_KEYS[tier];
    if (this.loading.has(key) || this.scene.cache.audio.exists(key)) return;
    const meta = (this.manifest.audio || {})[key];
    if (!meta) return;
    const urls = [];
    if (meta.ogg) urls.push(`./assets/audio/${meta.ogg}`);
    if (meta.m4a) urls.push(`./assets/audio/${meta.m4a}`);
    if (!urls.length) return;
    this.loading.add(key);
    try {
      this.scene.load.audio(key, urls);
      this.scene.load.once('complete', () => this.loading.delete(key));
      this.scene.load.once('loaderror', (f) => {
        this.loading.delete(key);
        this.failed.push(`prefetch ${f && f.key}`);
      });
      if (!this.scene.load.isLoading()) this.scene.load.start();
    } catch (e) {
      this.loading.delete(key);
      this.failed.push(`prefetch ${key}: ${e && e.message}`);
    }
  }

  /** 소리 하나를 치운다 — 🔴 걸려 있는 볼륨 트윈을 먼저 끊는다. 크로스페이드 중(1초)에 다시 바뀌면
   *  파괴된 소리에 트윈이 volume 을 써서 «Cannot set properties of null (setting 'volume')» 가 났다(부하 걸린 QA 에서 재현). */
  drop(snd) {
    try { if (this.scene && this.scene.tweens) this.scene.tweens.killTweensOf(snd); } catch { /* 씬 정리됨 */ }
    try { snd.stop(); snd.destroy(); } catch { /* 이미 정리됨 */ }
  }

  /** 크로스페이드 — 「툭」 끊고 갈면 층 경계가 사고처럼 들린다 */
  swapTrack() {
    if (!this.scene || !this.enabledFn()) return;
    const key = this.tierKey(this.tier);
    if (this.bgm && this.bgm.key === key) { this.applyRate(); return; }
    let next;
    try { next = this.scene.sound.add(key, { loop: true, volume: 0 }); }
    catch (e) { this.failed.push(`swap ${key}: ${e && e.message}`); return; }
    const old = this.bgm;
    this.bgm = next;
    try {
      next.play();
      this.applyRate();
      const tw = this.scene.tweens;
      if (tw) {
        tw.add({ targets: next, volume: this.bgmVolume, duration: XFADE_MS });
        if (old) tw.add({ targets: old, volume: 0, duration: XFADE_MS,
          onComplete: () => this.drop(old) });
      } else {
        next.setVolume(this.bgmVolume);
        if (old) this.drop(old);
      }
    } catch (e) { this.failed.push(`swap play: ${e && e.message}`); }
  }

  /** QA 훅 — 지금 무슨 트랙이 몇 배속으로 도는가 */
  intensity() {
    return { tier: this.tier, rate: this.rate, key: this.bgm ? this.bgm.key : null,
             playing: !!(this.bgm && this.bgm.isPlaying) };
  }

  stopBgm() {
    try { if (this.bgm && this.bgm.isPlaying) this.bgm.stop(); } catch { /* 이미 정리됨 */ }
  }

  /** 새 판 시작 — 강도를 1단계로 되돌린다 */
  resetIntensity() {
    this.tier = 0;
    this.rate = 1;
  }

  /** 설정 변경 반영 */
  syncEnabled() {
    if (!this.enabledFn()) this.stopBgm();
  }

  /** QA 훅 — 무엇이 실렸어야 하고 실제로 몇 개가 디코드됐는가 */
  report() {
    const cache = this.scene ? this.scene.cache.audio : null;
    const decoded = cache ? this.keys.filter((k) => cache.exists(k)).length : 0;
    return { expected: this.keys.length, decoded, failed: this.failed.slice() };
  }
}
