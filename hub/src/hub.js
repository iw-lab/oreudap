// game-builder 학교 허브 — 기기별 학교 · 문제 묶음 출제/채점 · 이용권 · 판 결과 · 학교 순위. 저장소 = D1(daum 계정 «<게임>-hub») 또는 시험용 node:sqlite 껍데기.
// 키트 정본 = ~/.claude/skills/game-builder/kit/school-hub (원본 비트:온 ← 콩콩배구 ← 꿀꺽 행성). 판 판정은 브라우저에서 나므로 결과는 기기가 알린다
//   → 그래서 결과 1건은 반드시 «그 기기가 쓴 경기권 1장»(ref)에 묶이고, 한 장에 한 번만 점수가 된다(scored PRIMARY KEY).
// 🔴 원자성은 «코드의 읽고-쓰기»가 아니라 SQLite 가 집행한다(같은 기기가 두 탭에서 동시에 와도):
//    · 경기권 차감 = spent INSERT 하나. BEFORE 트리거가 «tix>0 인 기기 행»이 없으면 ABORT, AFTER 트리거가 tix-1. 같은 ref 두 번 = PK 충돌(멱등).
//    · 환불 = spent.state 'spent'→'refunded' UPDATE 하나(쓴 지 TICKET_REFUND_SEC 안 · 결과를 아직 안 낸 것만). 트리거가 그 전이일 때만 tix+1.
//    · 채점 보상 = used INSERT 하나(묶음 정규형 해시가 PK). 트리거가 correct·tix 를 올린다 → 같은 묶음 재제출은 충돌로 배치 전체 롤백.
//    · 결과 = scored INSERT 하나(ref 가 PK) + 같은 배치의 점수 갱신 — 같은 경기권 두 번 = 충돌로 배치 전체 롤백(이중 지급 0).
import { makeQuestions } from '../shared/quiz.js';
import { T, kstDay, kstWeek, isDh, isCode, isRef, packKey, seal, unseal, shortName, SIDO, isCanonicalToken, tokenKey, resultPoints } from '../shared/school.js';

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dev (dh TEXT PRIMARY KEY, school TEXT, sname TEXT, sido TEXT, set_day TEXT DEFAULT '',
     correct INTEGER NOT NULL DEFAULT 0, tix INTEGER NOT NULL DEFAULT 0 CHECK (tix >= 0), packs INTEGER NOT NULL DEFAULT 0,
     pts_day TEXT DEFAULT '', pts INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS used (pk TEXT PRIMARY KEY, dh TEXT NOT NULL, c INTEGER NOT NULL, t INTEGER NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS spent (ref TEXT PRIMARY KEY, dh TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'ai', state TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS scored (ref TEXT PRIMARY KEY, dh TEXT NOT NULL, n INTEGER NOT NULL, at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ipcap (day TEXT NOT NULL, iph TEXT NOT NULL, s INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, iph))`,
  `CREATE TABLE IF NOT EXISTS board (period TEXT NOT NULL, k TEXT NOT NULL, code TEXT NOT NULL, name TEXT, sido TEXT, s INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (period, k, code))`,
  // 🔴 BEFORE 트리거는 PRIMARY KEY 검사보다 «먼저» 돈다 — 이미 있는 ref 는 비켜서 PK 충돌(= again)로 가게 한다(꿀꺽 행성 첫 실측)
  `CREATE TRIGGER IF NOT EXISTS spend_need BEFORE INSERT ON spent
     WHEN NOT EXISTS (SELECT 1 FROM spent WHERE ref = NEW.ref) AND NOT EXISTS (SELECT 1 FROM dev WHERE dh = NEW.dh AND tix > 0)
     BEGIN SELECT RAISE(ABORT, 'ticket'); END`,
  `CREATE TRIGGER IF NOT EXISTS spend_take AFTER INSERT ON spent BEGIN UPDATE dev SET tix = tix - 1 WHERE dh = NEW.dh; END`,
  `CREATE TRIGGER IF NOT EXISTS refund_give AFTER UPDATE OF state ON spent WHEN OLD.state = 'spent' AND NEW.state = 'refunded'
     BEGIN UPDATE dev SET tix = tix + 1 WHERE dh = NEW.dh; END`,
  // 🔴 결과(scored)는 «그 기기가 쓴, 아직 열린» 경기권에만 — 확인과 닫기가 같은 트랜잭션(트리거)이라 환불과 동시에 와도 둘 중 하나만 된다
  //    (2026-10-10 교차검증 codex·gemini·grok·meta: 결과가 상태를 «배치 밖에서» 읽어 환불+점수 동시 성공)
  `CREATE TRIGGER IF NOT EXISTS score_need BEFORE INSERT ON scored
     WHEN NOT EXISTS (SELECT 1 FROM spent WHERE ref = NEW.ref AND dh = NEW.dh AND state = 'spent')
     BEGIN SELECT RAISE(ABORT, 'ticket'); END`,
  `CREATE TRIGGER IF NOT EXISTS score_close AFTER INSERT ON scored BEGIN UPDATE spent SET state = 'done' WHERE ref = NEW.ref; END`,
  // 🔴 하루 상한은 «읽고 계산»만으로는 동시 요청에 뚫린다 — 넘는 갱신 자체를 DB 가 거절한다(배치 전체 롤백)
  `CREATE TRIGGER IF NOT EXISTS dev_cap BEFORE UPDATE OF pts ON dev WHEN NEW.pts > ${T.SCHOOL_DAY_CAP} BEGIN SELECT RAISE(ABORT, 'cap'); END`,
  `CREATE TRIGGER IF NOT EXISTS ip_cap_u BEFORE UPDATE ON ipcap WHEN NEW.s > ${T.IP_DAY_CAP} BEGIN SELECT RAISE(ABORT, 'cap'); END`,
  `CREATE TRIGGER IF NOT EXISTS ip_cap_i BEFORE INSERT ON ipcap WHEN NEW.s > ${T.IP_DAY_CAP} BEGIN SELECT RAISE(ABORT, 'cap'); END`,
  `CREATE TRIGGER IF NOT EXISTS grade_give AFTER INSERT ON used
     BEGIN UPDATE dev SET correct = correct + NEW.c, tix = tix + NEW.t, packs = packs + 1 WHERE dh = NEW.dh; END`,
  `CREATE INDEX IF NOT EXISTS board_rank ON board (period, k, s DESC)`,
];

const json = (body, status = 200) => ({ status, body });
const SUBJ = ['math', 'eng', 'music'];
const dup = (e) => /UNIQUE|PRIMARY|constraint/i.test(String(e?.message || e));

export class Hub {
  // db: D1Database 모양({ prepare, batch }) · secret: 봉인 키 원문(wrangler secret QUIZ_KEY) · now: 시계(시험용)
  // free = FREE_PLAY 게임(판 자체가 문제 풀이 — 구구성 수호대 2026-10-12): 판 영수증(ref)은 그대로 내되 이용권은 안 깎는다.
  //   차감 트리거를 건드리지 않으려고 «같은 batch 안에서 1장 넣고 바로 1장 쓴다» — 학교 점수 정산·하루 상한·환불 창은 그대로 걸린다.
  constructor({ db, secret, now = () => Date.now(), free = false }) {
    this.free = !!free;
    if (!secret) throw new Error('QUIZ_KEY 없음 — 봉인 키 없이 묶음을 내면 워커가 바뀔 때마다 채점이 410 이 된다');
    Object.assign(this, { db, now }); this.keyP = packKey(secret); this.ready = null;
  }
  init() { return (this.ready ||= this.db.batch(SCHEMA.map((s) => this.db.prepare(s))).catch((e) => { this.ready = null; throw e; })); }
  /** 새 기기 = 첫 경기권 FIRST_TIX 장(처음 온 아이가 한 판 맛보고 문제로). 이미 있으면 아무것도 안 한다 */
  ensure(dh) { return this.db.prepare('INSERT INTO dev (dh, tix) VALUES (?, ?) ON CONFLICT (dh) DO NOTHING').bind(dh, T.FIRST_TIX); }
  async dev(dh) { return (await this.db.prepare('SELECT * FROM dev WHERE dh = ?').bind(dh).first()) || null; }
  schoolOfRow(d) { return d?.school ? { code: d.school, name: d.sname, sido: d.sido, region: SIDO[d.sido] || '' } : null; }
  async tix(dh) { try { return ((await this.dev(dh))?.tix) | 0; } catch { return 0; } }

  // path: '/me' | '/select' | '/pack' | '/grade' | '/spend' | '/refund' | '/result' | '/top' · body = 바깥에서 형식 검사한 객체(dh 는 did 해시)
  async handle(path, body = {}) {
    await this.init();
    const t = this.now(), day = kstDay(t), week = kstWeek(t);
    if (path === '/top') return json(await this.top(day, week, isDh(body.dh) ? (await this.dev(body.dh))?.school : null));
    const dh = String(body.dh || ''); if (!isDh(dh)) return json({ error: 'dh' }, 400);
    if (path === '/me') {
      await this.ensure(dh).run();
      const d = await this.dev(dh), used = d.pts_day === day ? d.pts | 0 : 0;
      return json({ school: this.schoolOfRow(d), free: this.free, tix: d.tix | 0, correct: d.correct | 0, pass: T.TICKET_PASS_Q, q: T.PACK_Q, per: T.TIX_PER_PACK, todayPts: used, cap: T.SCHOOL_DAY_CAP });
    }
    if (path === '/spend') {
      const ref = String(body.ref || ''); if (!isRef(ref)) return json({ error: 'ref' }, 400);
      const kind = /^[a-z]{1,12}$/.test(String(body.kind || '')) ? String(body.kind) : 'play';   // 기록용(점수엔 안 쓴다)
      try {
        await this.db.batch([this.ensure(dh), ...(this.free ? [this.db.prepare('UPDATE dev SET tix = tix + 1 WHERE dh = ?').bind(dh)] : []), this.db.prepare("INSERT INTO spent (ref, dh, kind, state, at) VALUES (?, ?, ?, 'spent', ?)").bind(ref, dh, kind, t)]);
      } catch (e) {
        if (/ticket/.test(String(e?.message || e))) return json({ ok: false, why: 'ticket', tix: 0 });
        if (dup(e)) {   // 같은 ref — 이미 냈으면 ok(멱등), 돌려받은 ref 는 다시 못 쓴다
          const r = await this.db.prepare('SELECT state, dh FROM spent WHERE ref = ?').bind(ref).first();
          return json({ ok: r?.state === 'spent' && r.dh === dh, again: true, tix: await this.tix(dh) });
        }
        throw e;
      }
      // 차감은 이미 커밋됐다 — 뒤의 조회가 실패해도 ok(응답 유실 = 영수증 없는 차감 — 꿀꺽 행성 교차검증 codex)
      return json({ ok: true, tix: await this.tix(dh) });
    }
    if (path === '/refund') {
      const ref = String(body.ref || ''); if (!isRef(ref)) return json({ error: 'ref' }, 400);
      // 결과가 들어간 표는 score_close 트리거가 'done' 으로 닫아 여기 WHERE 에 안 걸린다(환불+점수 동시 성공 차단)
      const r = await this.db.prepare(`UPDATE spent SET state = 'refunded' WHERE ref = ? AND dh = ? AND state = 'spent' AND at >= ?`)
        .bind(ref, dh, t - T.TICKET_REFUND_SEC * 1000).run();
      // 🔴 «=== 1» 이면 D1 에선 환불이 되고도 ok:false(트리거 행까지 세서 2) → 클라가 쓸데없이 결과를 보냈다(2026-10-14 숲속 오케스트라 배포본 실측)
      return json({ ok: (r.meta?.changes | 0) >= 1, tix: await this.tix(dh) });
    }
    if (path === '/result') return json(await this.result(dh, body, day, week, t, String(body.iph || '')));
    if (path === '/select') {
      const s = body.school; if (!s || !isCode(s.code) || !SIDO[s.sido]) return json({ error: 'code' }, 400);
      await this.ensure(dh).run();
      const d = await this.dev(dh);
      if (d.school && d.school !== s.code && d.set_day === day) return json({ error: 'today' }, 429);   // 학교 바꾸기는 하루 1회(순위 품앗이 차단)
      await this.db.prepare('UPDATE dev SET school = ?, sname = ?, sido = ?, set_day = ? WHERE dh = ?')
        .bind(s.code, String(s.name).slice(0, 30), s.sido, d.school === s.code ? (d.set_day || '') : day, dh).run();
      return json({ ok: true, school: { code: s.code, name: String(s.name).slice(0, 30), sido: s.sido, region: SIDO[s.sido] } });
    }
    if (path === '/pack') {
      const subject = SUBJ.includes(body.subject) ? body.subject : 'math', grade = Math.max(1, Math.min(6, body.grade | 0 || 3));
      const seed = crypto.getRandomValues(new Uint32Array(1))[0] >>> 1;
      const qs = makeQuestions(seed, { subject, grade, count: T.PACK_Q });
      const pid = await seal(await this.keyP, { dh, a: qs.map((q) => q.answer), at: t });
      return json({ pid, qs: qs.map((q) => ({ text: q.text, choices: q.choices })), pass: T.TICKET_PASS_Q, per: T.TIX_PER_PACK });
    }
    if (path === '/grade') {
      // 🔴 pid 는 정규 형식만 — unseal 이 base64url 밖 문자를 버리므로 원문을 키로 쓰면 pid+'!' 로 같은 묶음을 다시 채점할 수 있다(스쿨 스타즈 교차검증)
      const pid = String(body.pid || ''); if (!/^[A-Za-z0-9_-]{30,4096}$/.test(pid) || !isCanonicalToken(pid)) return json({ error: 'pack' }, 410);
      const P = await unseal(await this.keyP, pid);
      if (!P || P.dh !== dh || t - P.at > T.PACK_TTL_MIN * 60000) return json({ error: 'pack' }, 410);
      if (t - P.at < T.PACK_MIN_MS_PER_Q * P.a.length) return json({ tooFast: true, waitMs: T.PACK_MIN_MS_PER_Q * P.a.length - (t - P.at) });
      const got = (Array.isArray(body.answers) ? body.answers : []).slice(0, P.a.length).map((x) => (Number.isInteger(x) ? x : -1));
      const right = P.a.map((a, i) => got[i] === a), correct = right.filter(Boolean).length, ticket = correct >= T.TICKET_PASS_Q ? T.TIX_PER_PACK : 0;
      try {
        await this.db.batch([this.ensure(dh), this.db.prepare('INSERT INTO used (pk, dh, c, t, at) VALUES (?, ?, ?, ?, ?)').bind(await tokenKey(pid), dh, correct, ticket, t)]);
      } catch (e) { if (dup(e)) return json({ error: 'pack' }, 410); throw e; }
      return json({ correct, total: P.a.length, right, answers: P.a, ticket, tix: await this.tix(dh), pass: T.TICKET_PASS_Q });
    }
    return json({ error: 'not found' }, 404);
  }

  /** 판 결과 — 경기권 한 장(ref)에 한 번. 그 기기가 쓴 표 · 환불 안 됨 · RESULT_TTL 안 · 학교가 있어야 점수 · 기기·IP 하루 상한.
   *  열림 확인·닫기·상한은 SQLite 트리거가 같은 배치(트랜잭션) 안에서 집행한다 — 여기서 읽는 값은 «얼마를 줄까» 계산용일 뿐. */
  async result(dh, body, day, week, t, iph = '') {
    const ref = String(body.ref || ''); if (!isRef(ref)) return { error: 'ref' };
    if (!iph) return { ok: false, why: 'iph' };   // IP 해시 없이 오면 IP 상한이 통째로 꺼진다 — 받지 않는다(교차검증 grok)
    for (let attempt = 0; attempt < 2; attempt++) {
      const sp = await this.db.prepare('SELECT dh, state, at FROM spent WHERE ref = ?').bind(ref).first();
      if (!sp || sp.dh !== dh) return { ok: false, why: 'ticket' };
      if (sp.state === 'done') return { ok: false, why: 'again' };
      if (sp.state !== 'spent') return { ok: false, why: 'ticket' };
      if (t - sp.at > T.RESULT_TTL_MIN * 60000) return { ok: false, why: 'late' };
      const d = await this.dev(dh), sc = this.schoolOfRow(d);
      const used = d.pts_day === day ? d.pts | 0 : 0;
      const ipUsed = (await this.db.prepare('SELECT s FROM ipcap WHERE day = ? AND iph = ?').bind(day, iph).first())?.s | 0;
      const want = resultPoints({ won: !!body.won });
      const n = sc ? Math.max(0, Math.min(want, T.SCHOOL_DAY_CAP - used, T.IP_DAY_CAP - ipUsed)) : 0;
      const stmts = [this.db.prepare('INSERT INTO scored (ref, dh, n, at) VALUES (?, ?, ?, ?)').bind(ref, dh, n, t)];
      if (n) {
        // 누적(덮어쓰기 아님) — 날이 바뀌었으면 새로 시작
        stmts.push(this.db.prepare('UPDATE dev SET pts = CASE WHEN pts_day = ? THEN pts + ? ELSE ? END, pts_day = ? WHERE dh = ?').bind(day, n, n, day, dh));
        stmts.push(this.db.prepare('INSERT INTO ipcap (day, iph, s) VALUES (?, ?, ?) ON CONFLICT (day, iph) DO UPDATE SET s = s + excluded.s').bind(day, iph, n));
        for (const [period, k] of [['d', day], ['w', week]]) stmts.push(this.db.prepare(
          'INSERT INTO board (period, k, code, name, sido, s) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (period, k, code) DO UPDATE SET s = s + excluded.s, name = excluded.name')
          .bind(period, k, sc.code, String(sc.name).slice(0, 30), sc.sido, n));
      }
      try {
        await this.db.batch(stmts);
        return { ok: true, added: n, school: sc ? shortName(sc.name) : null, capped: !!sc && n < want };
      } catch (e) {
        const m = String(e?.message || e);
        if (/cap/.test(m)) continue;                       // 동시에 온 다른 결과가 상한을 먼저 썼다 — 남은 양으로 한 번 더 계산
        if (/ticket/.test(m)) return { ok: false, why: 'ticket' };   // 그 사이 환불됐다
        if (dup(e)) return { ok: false, why: 'again' };
        throw e;
      }
    }
    return { ok: false, why: 'cap' };
  }

  async top(day, week, myCode) {
    const list = async (period, k) => (await this.db.prepare('SELECT code, name, sido, s FROM board WHERE period = ? AND k = ? ORDER BY s DESC, code LIMIT 20').bind(period, k).all()).results
      .map((r) => ({ code: r.code, name: shortName(r.name), sido: SIDO[r.sido] || '', s: r.s }));
    const rank = async (period, k) => {
      if (!myCode) return null;
      const me = await this.db.prepare('SELECT s FROM board WHERE period = ? AND k = ? AND code = ?').bind(period, k, myCode).first();
      if (!me) return null;
      const above = await this.db.prepare('SELECT COUNT(*) AS n FROM board WHERE period = ? AND k = ? AND s > ?').bind(period, k, me.s).first();
      const next = await this.db.prepare('SELECT MIN(s) AS s FROM board WHERE period = ? AND k = ? AND s > ?').bind(period, k, me.s).first();
      return { rank: (above?.n | 0) + 1, s: me.s, gap: next?.s ? next.s - me.s : 0 };   // gap = 바로 위 학교까지 남은 점수(«다시 들어올 이유»)
    };
    return { day, week, today: await list('d', day), weekly: await list('w', week), mine: myCode ? { today: await rank('d', day), weekly: await rank('w', week) } : null };
  }
}

/** node:sqlite 를 D1 모양으로 감싼다(시험 전용). batch = 하나의 트랜잭션(실패하면 전부 롤백 — D1 과 같다) */
export async function sqliteD1(file = ':memory:') {
  // getBuiltinModule — vitest(vite)가 'node:sqlite' 접두사를 떼고 «sqlite» 패키지로 찾다 실패한다(2026-10-11 종이하늘 실측)
  const { DatabaseSync } = globalThis.process.getBuiltinModule('node:sqlite');
  const raw = new DatabaseSync(file);
  const stmt = (sql) => {
    let args = [];
    const o = {
      bind: (...a) => { args = a; return o; },
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      // D1 의 meta.changes 는 트리거가 바꾼 행까지 센다(실측: 트리거 1개 달린 UPDATE 1행 → changes 2) — node:sqlite changes 는 안 센다 → total_changes 차이로 D1 과 같게
      run: async () => { const tc = () => Number(raw.prepare('SELECT total_changes() AS n').get().n); const a = tc(); raw.prepare(sql).run(...args); return { meta: { changes: tc() - a } }; },
      _exec: () => (/^\s*SELECT/i.test(sql) ? raw.prepare(sql).all(...args) : raw.prepare(sql).run(...args)),
    };
    return o;
  };
  return {
    raw, prepare: stmt,
    batch: async (list) => {
      raw.exec('BEGIN');
      try { const out = list.map((s) => s._exec()); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
}
