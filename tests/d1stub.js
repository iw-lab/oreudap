// D1 흉내 — node:sqlite 에 진짜 스키마(worker/migrations)를 얹는다. SQL 문법·GROUP BY·INSERT OR IGNORE 가 실제로 도는지가 요점.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';

export function d1() {
  const db = new DatabaseSync(':memory:');
  for (const f of fs.readdirSync(new URL('../worker/migrations/', import.meta.url)).sort()) {
    db.exec(fs.readFileSync(new URL(`../worker/migrations/${f}`, import.meta.url), 'utf8'));
  }
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => db.prepare(sql).run(...args),
    _sql: sql, _args: args,
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try {
        const out = list.map((s) => (/^\s*SELECT/i.test(s._sql) ? { results: db.prepare(s._sql).all(...s._args) } : (db.prepare(s._sql).run(...s._args), { results: [] })));
        db.exec('COMMIT'); return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
