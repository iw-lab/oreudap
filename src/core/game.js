// 게임 코어 — DOM·Phaser 를 import 하지 않는다(headless 1:1 테스트의 전제).
// 시간은 전부 advance(dt) 로만 흐른다. rAF 에 매달리지 않으므로 숨은 탭에서도 검증 가능하다.

import {
  HEART, TIMING, COIN, timerFor, branchesFor,
  MODES, DEFAULT_MODE, STAMINA, drainFor, refillFor, capFor,
  REVIVE, FEVER, CLOSE_CALL,
} from './balance.js';
import { makeRng } from './rng.js';
import { QuestionSource } from './questions.js';
import { SessionQueue, PersistentNotes } from './srs.js';

export const PHASE = {
  IDLE: 'idle',
  QUESTION: 'question',
  RESOLVE: 'resolve',
  DOWN: 'down',       // 추락 — «다시 일어서기»를 고를 때까지 시간이 멈춘다(beginRevive / giveUp)
  OVER: 'over',
};

export class GameCore {
  /**
   * @param {object} o
   * @param {number} o.seed
   * @param {string} o.subject 'gugudan' | 'words34' | 'words56'
   * @param {number[]} [o.scope]
   * @param {PersistentNotes} [o.notes]
   * @param {string} [o.mode] 'classic' | 'thrill' | 'sprint'
   * @param {() => number} [o.now] 벽시계(영속 SRS 가중·박스 날짜에만)
   * @param {boolean} [o.revive] 추락 때 «다시 일어서기»를 줄 것인가. 실제 판(App)만 켠다 —
   *        끄면 추락이 곧 gameover 다(옛 프로브·스모크가 그대로 돈다).
   */
  constructor({ seed, subject, scope, notes, mode = DEFAULT_MODE, now = () => Date.now(), revive = false }) {
    this.seed = seed >>> 0;
    this.subject = subject;
    this.mode = MODES[mode] ? mode : DEFAULT_MODE;
    this.rules = MODES[this.mode];
    this.rng = makeRng(this.seed);
    this.notes = notes || new PersistentNotes();
    this.sessionQueue = new SessionQueue();
    this.nowFn = now;
    this.source = new QuestionSource({
      subject, scope, rng: this.rng, sessionQueue: this.sessionQueue, notes: this.notes, now, mirror: !!this.rules.mirror,
    });

    this.t = 0;
    this.floor = 0;
    // 🔴 하트를 «쓰지 않는» 모드에서도 필드는 남긴다 — 지우면 HUD·결과·오답노트가 전부
    //    분기문 범벅이 된다. 대신 rules.hearts 가 0 이면 아무도 이 값을 읽지 않는다.
    this.hearts = this.rules.hearts || HEART.START;
    this.stamina = this.rules.stamina ? STAMINA.START : null;
    this.runEndsAt = this.rules.runMs || 0;   // 0 = 무제한. 판 시작(t=0) 기준이라 그대로 쓴다.
    this.streak = 0;
    this.bestStreak = 0;
    this.coins = 0;
    this.phase = PHASE.IDLE;
    this.question = null;
    this.activeAt = 0;
    this.timerMs = 0;
    this.answered = false;
    this.resolveUntil = 0;
    this.pendingOver = false;
    this.lastResult = null;
    this.revivesLeft = revive && this.rules.revive ? REVIVE.COUNT : 0;
    this.reviving = null;     // { need, got } — 다시 일어서기 도중
    this.lastWrongId = null;
    this.downCause = null;

    this.stats = {
      asked: 0, correct: 0, wrong: 0, timeouts: 0,
      reviewCorrect: 0, wrongIds: [], perId: {},
    };
  }

  start() {
    if (this.phase !== PHASE.IDLE) return;
    this.floor = 0;
    this._nextQuestion();
  }

  /** 남은 시간(ms). 문항 국면이 아니면 0 */
  get timeLeftMs() {
    if (this.phase !== PHASE.QUESTION || this.answered || this.timerMs <= 0) return 0;
    return Math.max(0, this.timerMs - (this.t - this.activeAt));
  }

  /** 판 전체 남은 시간(ms). 무제한 모드면 0 */
  get runLeftMs() {
    return this.runEndsAt > 0 ? Math.max(0, this.runEndsAt - this.t) : 0;
  }

  /** 기력이 «위험 구간»인가 — 연출은 이 하나만 보고 켠다(UI 가 임계를 다시 적지 않게) */
  /** 지금 층에서 기력이 찰 수 있는 최대치(HUD 가 «비어 보이는 윗부분»을 그린다) */
  get staminaCap() {
    return this.stamina == null ? 0 : capFor(this.floor);
  }

  get lowStamina() {
    return this.stamina != null && this.stamina <= STAMINA.LOW;
  }

  get timeRatio() {
    return this.timerMs > 0 ? this.timeLeftMs / this.timerMs : 0;
  }

  /** 불꽃 계단 — 연속 정답이 FEVER.FROM 이상 */
  get fever() {
    return this.streak >= FEVER.FROM;
  }

  get accuracy() {
    return this.stats.asked > 0 ? this.stats.correct / this.stats.asked : 0;
  }

  /**
   * 입력. 문항이 «지금 살아 있을 때»만 판정한다.
   * 🔴 버퍼링하지 않는다 — 선택지는 활성화 순간에 처음 보이므로, 그 전의 입력은
   *    «보지 않은 문제에 대한 답»이 된다. 해결 국면·타임아웃 이후 입력도 같은 이유로 무시한다.
   * @returns {{type:string}}
   */
  input(choiceIndex) {
    if (this.phase !== PHASE.QUESTION || this.answered) return { type: 'ignored' };
    return this._judge(choiceIndex);
  }

  /** 시간을 dt(ms) 만큼 흘린다. 발생한 이벤트 배열을 돌려준다. */
  advance(dtMs) {
    const events = [];
    if (!Number.isFinite(dtMs) || dtMs < 0) return events; // 음수·NaN dt 방어
    // 🔴 여기서 dt 를 자르지 않는다 — 자르면 게임 시계가 벽시계와 어긋나 「끊긴다」로 읽힌다.
    //    숨은 탭 복귀 같은 거대 dt 는 «호출자»(씬)가 프레임 델타 단계에서 클램프한다.
    this.t += dtMs;

    // 🔴 기력은 «국면과 무관하게» 흐른다 — 정답 연출 중에도 줄어야 「멈추면 떨어진다」가 된다.
    //    다만 이미 끝난 판에서는 더 줄이지 않는다(결과 화면에서 계속 깎이면 값이 거짓이 된다).
    //    다시 일어서기 도중·추락해 고르는 중에는 멈춘다(그 시간은 «문제 푸는 시간»이 아니다).
    if (this.stamina != null && this.phase !== PHASE.OVER && this.phase !== PHASE.DOWN && !this.reviving) {
      this.stamina = Math.max(0, this.stamina - drainFor(this.floor + 1) * (dtMs / 1000));
      if (this.stamina <= 0 && !this.pendingOver) {
        events.push(this._fall('stamina'));
        return events;
      }
    }
    // 판 전체 제한시간(60초 질주) — 다 쓰면 그 자리에서 끝난다.
    if (this.runEndsAt > 0 && this.t >= this.runEndsAt && this.phase !== PHASE.OVER && !this.pendingOver) {
      events.push(this._fall('time'));
      return events;
    }

    for (let guard = 0; guard < 64; guard++) {
      if (this.phase === PHASE.QUESTION && !this.answered) {
        if (this.timerMs > 0 && this.t - this.activeAt >= this.timerMs) {
          events.push(this._resolveWrong(null, true));
          continue;
        }
        break;
      }
      if (this.phase === PHASE.RESOLVE && this.t >= this.resolveUntil) {
        if (this.pendingOver) {
          events.push(this._down('wrong'));
          break;
        }
        events.push(...this._nextQuestion());
        continue;
      }
      break;
    }
    return events;
  }

  _nextQuestion(forceId = null) {
    const events = [];
    const branches = branchesFor(this.floor + 1, this.rng);
    this.question = this.source.next(branches, this.floor + 1, forceId);
    this.activeAt = this.t;
    // 🔴 timerMs 0 = «시간 제한 없음». Infinity 를 넣으면 timeRatio 가 NaN 이 되어
    //    HUD 바가 조용히 사라진다 — 0 은 계산에서 안전하게 죽는다.
    //    다시 일어서기 문제는 모드와 무관하게 넉넉한 고정 시간이다.
    this.timerMs = this.reviving ? REVIVE.TIMER_S * 1000 : this.rules.timed ? timerFor(this.floor + 1) * 1000 : 0;
    this.answered = false;
    this.phase = PHASE.QUESTION;
    this.stats.asked += 1;
    events.push({ type: 'question', question: this.question, branches, timerMs: this.timerMs });
    return events;
  }

  _judge(choiceIndex) {
    if (this.answered || this.phase !== PHASE.QUESTION) return { type: 'ignored' };
    this.answered = true;                       // 문항당 판정 정확히 1회(D3)
    const correct = choiceIndex === this.question.answerIndex;
    return correct ? this._resolveCorrect() : this._resolveWrong(choiceIndex, false);
  }

  _resolveCorrect() {
    const q = this.question;
    if (this.reviving) return this._reviveCorrect(q);
    const elapsedMs = this.t - this.activeAt;
    const close = this.timerMs > 0 ? elapsedMs >= this.timerMs * CLOSE_CALL : this.lowStamina;
    this.floor += 1;
    this.streak += 1;
    const fever = this.fever;
    this.coins += COIN.PER_FLOOR * (fever ? FEVER.COIN_MULT : 1);
    if (this.streak > this.bestStreak) this.bestStreak = this.streak;
    this.stats.correct += 1;
    this._track(q.id, true);

    let healed = false;
    let bonus = 0;
    if (this.stamina != null) {
      const elapsed = this.t - this.activeAt;
      // 천장은 «지금 오른 층» 기준이다 — 방금 한 층 올랐으므로 this.floor 를 그대로 쓴다.
      this.stamina = Math.min(capFor(this.floor), this.stamina + refillFor(elapsed, this.stamina));
    }
    if (this.streak % HEART.STREAK_HEAL === 0) {
      bonus = COIN.STREAK_BONUS;
      this.coins += bonus;
      // 회복 상한은 «그 모드의 하트 수» — 하트 1개 모드에서 2개가 되면 «한 번 틀리면 추락»이 거짓말이 된다.
      if (this.rules.hearts > 0 && this.hearts < Math.min(HEART.MAX, this.rules.hearts)) { this.hearts += 1; healed = true; }
    }
    const graduated = this.sessionQueue.has(q.id)
      ? this.sessionQueue.onCorrect(q.id, this.source.index)
      : null;
    if (q.fromReview) this.stats.reviewCorrect += 1;
    const boxState = this.notes.onCorrect(q.id, this.nowFn());

    this.phase = PHASE.RESOLVE;
    this.resolveUntil = this.t + TIMING.JUMP_MS;
    this.lastResult = {
      type: 'correct', floor: this.floor, healed, bonus, graduated, boxState,
      box: this.notes.box(q.id), id: q.id,
      fever, feverStart: this.streak === FEVER.FROM, close,
    };
    return this.lastResult;
  }

  /** 다시 일어서기 도중의 정답 — 층은 그대로, 맞힌 수만 센다. 다 맞히면 그 자리에서 다시 출발 */
  _reviveCorrect(q) {
    const r = this.reviving;
    r.got += 1;
    this.stats.correct += 1;
    this._track(q.id, true);
    if (q.fromReview) this.stats.reviewCorrect += 1;
    if (this.sessionQueue.has(q.id)) this.sessionQueue.onCorrect(q.id, this.source.index);
    this.notes.onCorrect(q.id, this.nowFn());
    const done = r.got >= r.need;
    if (done) {
      this.reviving = null;
      this.hearts = this.rules.hearts || HEART.START;
      if (this.stamina != null) this.stamina = Math.max(this.stamina, capFor(this.floor) * REVIVE.STAMINA);
    }
    this.phase = PHASE.RESOLVE;
    this.resolveUntil = this.t + REVIVE.STEP_MS;
    this.lastResult = {
      type: 'correct', floor: this.floor, id: q.id,
      revive: { got: r.got, need: r.need, done },
    };
    return this.lastResult;
  }

  /**
   * 추락. 다시 일어서기가 남았으면 DOWN 에서 기다리고(시간 정지), 아니면 그대로 끝난다.
   * @param {'wrong'|'stamina'|'time'} cause
   */
  _down(cause) {
    this.pendingOver = false;
    this.answered = true;
    if (cause !== 'time' && this.revivesLeft > 0) {
      this.phase = PHASE.DOWN;
      this.downCause = cause;
      return { type: 'down', cause, floor: this.floor, revivesLeft: this.revivesLeft, need: REVIVE.NEED };
    }
    this.phase = PHASE.OVER;
    if (cause !== 'wrong') this.lastResult = { type: 'fall', cause, floor: this.floor };
    return {
      type: 'gameover', cause, floor: this.floor, stats: this.stats,
      bestStreak: this.bestStreak, coins: this.coins,
    };
  }

  /** 추락한 자리에서 다시 일어서기 시작 — 첫 문제는 방금 놓친 문제. 이벤트 배열을 돌려준다 */
  beginRevive() {
    if (this.phase !== PHASE.DOWN || this.revivesLeft <= 0) return [];
    this.revivesLeft -= 1;
    this.reviving = { need: REVIVE.NEED, got: 0 };
    this.streak = 0;
    return this._nextQuestion(this.lastWrongId);
  }

  /** 다시 일어서기를 안 하고 끝낸다 */
  giveUp() {
    if (this.phase !== PHASE.DOWN) return [];
    this.revivesLeft = 0;
    return [this._down(this.downCause || 'wrong')];
  }

  _resolveWrong(choiceIndex, isTimeout) {
    const q = this.question;
    this.answered = true;
    const wasReviving = !!this.reviving;
    let penaltyMs = 0;
    let slid = 0;
    if (wasReviving) {
      // 다시 일어서기에서 틀리면 끝 — 남은 기회도 없다
      this.reviving = null;
      this.revivesLeft = 0;
    } else {
      if (this.rules.hearts > 0) this.hearts -= 1;
      if (this.stamina != null) this.stamina = Math.max(0, this.stamina - STAMINA.WRONG);
      if (this.rules.penaltyMs && this.runEndsAt > 0) {
        penaltyMs = Math.min(this.rules.penaltyMs, Math.max(0, this.runEndsAt - this.t));
        this.runEndsAt -= penaltyMs;
      }
      if (this.rules.slide) {
        slid = Math.min(this.rules.slide, this.floor);
        this.floor -= slid;
      }
    }
    this.lastWrongId = q.id;
    this.streak = 0;
    this.stats.wrong += 1;
    if (isTimeout) this.stats.timeouts += 1;
    this._track(q.id, false);
    if (!this.stats.wrongIds.includes(q.id)) this.stats.wrongIds.push(q.id);

    this.sessionQueue.onWrong(q.id, this.source.index);
    this.notes.onWrong(q.id, this.nowFn());

    this.phase = PHASE.RESOLVE;
    // 하트가 0이면 하이라이트만 보여 주고 추락한다 — 자동 이동·다음 문항 없음.
    // 하트 모드는 하트가 0 일 때, 기력만 쓰는 모드는 기력이 0 일 때, 감점 모드(질주)는 오답으로 끝나지 않는다.
    // 🔴 stamina 가 null 인 모드에서 `null <= 0` 은 true 다 — 기력 모드인지 먼저 묻는다.
    this.pendingOver = wasReviving ? true
      : this.rules.hearts > 0 ? this.hearts <= 0
        : this.stamina != null ? this.stamina <= 0
          : false;
    this.resolveUntil = this.t + TIMING.STUMBLE_MS + TIMING.HIGHLIGHT_MS;
    this.lastResult = {
      type: isTimeout ? 'timeout' : 'wrong',
      chose: choiceIndex,
      answerIndex: q.answerIndex,
      answerText: q.answerText,
      hearts: this.hearts,
      stamina: this.stamina,
      box: this.notes.box(q.id),
      id: q.id,
      over: this.pendingOver,
      penaltyMs,
      slid,
      reviveFailed: wasReviving,
    };
    return this.lastResult;
  }

  /**
   * 문항을 틀려서가 아니라 «버티지 못해서» 끝나는 경로.
   * 🔴 여기서 stats 를 건드리지 않는다 — 답하지 않은 문항을 오답으로 세면 정답률이 거짓이 된다.
   * @param {'stamina'|'time'} cause
   */
  _fall(cause) {
    return this._down(cause);
  }

  _track(id, ok) {
    const rec = this.stats.perId[id] || { asked: 0, correct: 0 };
    rec.asked += 1;
    if (ok) rec.correct += 1;
    this.stats.perId[id] = rec;
  }

  snapshot() {
    return {
      t: this.t,
      phase: this.phase,
      floor: this.floor,
      hearts: this.hearts,
      stamina: this.stamina,
      staminaCap: this.staminaCap,
      revivesLeft: this.revivesLeft,
      reviving: this.reviving ? { ...this.reviving } : null,
      mode: this.mode,
      runLeftMs: this.runLeftMs,
      streak: this.streak,
      coins: this.coins,
      question: this.question,
      timeLeftMs: this.timeLeftMs,
      timeRatio: this.timeRatio,
      accuracy: this.accuracy,
      stats: this.stats,
    };
  }
}
