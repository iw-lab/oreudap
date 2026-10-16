// game-builder 학교 허브 워커(키트 정본 = ~/.claude/skills/game-builder/kit/school-hub) — daum 계정. D1 «<게임>-hub» + NEIS 학교 확인.
// 원본 = 비트:온(music, 2026-10-10) ← 콩콩배구 ← 꿀꺽 행성. 고칠 때는 키트를 고치고 각 게임에 다시 깐다(install.sh).
// 🔴 게임 페이지(Pages, naver 계정)의 functions/api/hub 가 비밀 머리글(PROXY_KEY)을 붙여 부를 때만 받는다 —
//    workers.dev 주소로 바로 오는 요청은 403(IP 해시 머리글을 위조해 하루 상한을 비켜 가지 못하게).
// 라우트: GET /school?q=&sido= · GET /schools?did= · POST /me|/select|/pack|/grade|/spend|/refund|/result  (본문 = {did, …})
import { Hub } from './hub.js';
export { HubDO } from './do.js';   // 저장소가 Durable Object(HUB_DO 바인딩)인 허브만 쓴다 — D1 허브엔 묶이지 않은 클래스로 남는다
import { cleanQuery, isCode, isSido, isDid, searchUrl, codeUrl, parseNeis, ymdKst, shortName, didHash } from '../shared/school.js';

const J = (body, status = 200, cacheSec = 0) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': cacheSec ? `public, max-age=${cacheSec}` : 'no-store' } });
const hubOf = (env) => new Hub({ db: env.DB, secret: env.QUIZ_KEY, free: env.FREE_PLAY === '1' });
// 저장소: D1(env.DB) 이 있으면 그대로, 없고 HUB_DO 가 있으면 Durable Object 하나에 맡긴다(같은 Hub 코드 · 같은 스키마·트리거)
const handle = (env, path, body) => (env.DB || !env.HUB_DO ? hubOf(env).handle(path, body) : env.HUB_DO.get(env.HUB_DO.idFromName('hub')).handle(path, body));
const POSTS = new Set(['/me', '/select', '/pack', '/grade', '/spend', '/refund', '/result']);

async function neis(url, ctx) {   // NEIS 조회 — 엣지 캐시 7일(학교 목록은 거의 안 바뀐다). 장애면 null(캐시하지 않는다)
  const cache = caches.default, key = new Request(url);
  const hit = await cache.match(key); if (hit) return hit.json();
  try {
    const r = await fetch(url, { cf: { cacheTtl: 0 } }); if (!r.ok) return null;
    const list = parseNeis(await r.json(), ymdKst()); if (!list) return null;
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(list), { headers: { 'cache-control': 'public, max-age=604800' } })));
    return list;
  } catch { return null; }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), path = url.pathname;
    if (path === '/health') return J({ ok: true, v: 1 });
    if (!env.PROXY_KEY || req.headers.get('x-bo-proxy') !== env.PROXY_KEY) return J({ error: 'proxy' }, 403);
    const iph = /^[0-9a-f]{16}$/.test(req.headers.get('x-bo-iph') || '') ? req.headers.get('x-bo-iph') : '';
    if (path === '/school' && req.method === 'GET') {
      const q = cleanQuery(url.searchParams.get('q')), sido = url.searchParams.get('sido') || '';
      if (!q) return J({ list: [] });
      const list = await neis(searchUrl(q, isSido(sido) ? sido : undefined), ctx);
      return list ? J({ list: list.map((s) => ({ ...s, short: shortName(s.name) })) }, 200, 300) : J({ list: [], error: 'neis' }, 502);
    }
    if (path === '/schools' && req.method === 'GET') {
      const did = url.searchParams.get('did') || '';
      const r = await handle(env, '/top', isDid(did) ? { dh: await didHash(did) } : {});
      return J(r.body, r.status);
    }
    if (req.method !== 'POST' || !POSTS.has(path)) return J({ error: 'not found' }, 404);
    let b; try { b = await req.json(); } catch { return J({ error: 'json' }, 400); }
    if (!b || !isDid(b.did)) return J({ error: 'did' }, 400);
    const body = { ...b, dh: await didHash(b.did), iph };
    if (path === '/select') {   // 학교는 서버가 NEIS 로 다시 확인한 것만 — 클라이언트가 보낸 이름은 쓰지 않는다
      const code = String(b.code || ''), sido = String(b.sido || '');
      if (!isCode(code) || !isSido(sido)) return J({ error: 'code' }, 400);
      const list = await neis(codeUrl(code, sido), ctx);
      const sch = list && list.find((x) => x.code === code);
      if (!sch) return J({ error: list ? 'school' : 'neis' }, list ? 400 : 502);
      body.school = sch;
    }
    const r = await handle(env, path, body);
    return J(r.body, r.status);
  },
};
