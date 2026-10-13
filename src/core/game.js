// 게임 코어 — DOM·Phaser 를 import 하지 않는다(headless 1:1 테스트의 전제).
// 시간은 전부 advance(dt) 로만 흐른다. rAF 에 매달리지 않으므로 숨은 탭에서도 검증 가능하다.

import {
  HEART, TIMING, COIN, timerFor, branchesFor,
  MODES, DEFAULT_MODE, STAMINA, drainFor, refillFor, capFor,
} from './balance.js';
import { makeRng } from './rng.js';
import { QuestionSource } from './questions.js';
import { SessionQueue, PersistentNotes } from './srs.js';

export const PHASE = {
  IDLE: 'idle',
  QUESTION: 'question',
  RESOLVE: 'resolve',
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
   */
  constructor({ seed, subject, scope, notes, mode = DEFAULT_MODE, now = () => Date.now() }) {
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
    if (this.stamina != null && this.phase !== PHASE.OVER) {
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
          this.phase = PHASE.OVER;
          events.push({
            type: 'gameover', floor: this.floor, stats: this.stats,
            bestStreak: this.bestStreak, coins: this.coins,
          });
          break;
        }
        events.push(...this._nextQuestion());
        continue;
      }
      break;
    }
    return events;
  }

  _nextQuestion() {
    const events = [];
    const branches = branchesFor(this.floor + 1, this.rng);
    this.question = this.source.next(branches, this.floor + 1);
    this.activeAt = this.t;
    // 🔴 timerMs 0 = «시간 제한 없음». Infinity 를 넣으면 timeRatio 가 NaN 이 되어
    //    HUD 바가 조용히 사라진다 — 0 은 계산에서 안전하게 죽는다.
    this.timerMs = this.rules.timed ? timerFor(this.floor + 1) * 1000 : 0;
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
    this.floor += 1;
    this.coins += COIN.PER_FLOOR;
    this.streak += 1;
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
      if (this.hearts < HEART.MAX) { this.hearts += 1; healed = true; }
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
    };
    return this.lastResult;
  }

  _resolveWrong(choiceIndex, isTimeout) {
    const q = this.question;
    this.answered = true;
    if (this.rules.hearts > 0) this.hearts -= 1;
    if (this.stamina != null) this.stamina = Math.max(0, this.stamina - STAMINA.WRONG);
    this.streak = 0;
    this.stats.wrong += 1;
    if (isTimeout) this.stats.timeouts += 1;
    this._track(q.id, false);
    if (!this.stats.wrongIds.includes(q.id)) this.stats.wrongIds.push(q.id);

    this.sessionQueue.onWrong(q.id, this.source.index);
    this.notes.onWrong(q.id, this.nowFn());

    this.phase = PHASE.RESOLVE;
    // 하트가 0이면 하이라이트만 보여 주고 결과 화면으로 간다 — 자동 이동·다음 문항 없음.
    // 하트 모드는 하트가 0 일 때, 기력 모드는 기력이 0 일 때 끝난다.
    this.pendingOver = this.rules.hearts > 0 ? this.hearts <= 0 : this.stamina <= 0;
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
    };
    return this.lastResult;
  }

  /**
   * 문항을 틀려서가 아니라 «버티지 못해서» 끝나는 경로.
   * 🔴 여기서 stats 를 건드리지 않는다 — 답하지 않은 문항을 오답으로 세면 정답률이 거짓이 된다.
   * @param {'stamina'|'time'} cause
   */
  _fall(cause) {
    this.phase = PHASE.OVER;
    this.pendingOver = false;
    this.answered = true;
    this.lastResult = { type: 'fall', cause, floor: this.floor };
    return {
      type: 'gameover', cause, floor: this.floor, stats: this.stats,
      bestStreak: this.bestStreak, coins: this.coins,
    };
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
