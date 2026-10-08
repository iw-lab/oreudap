// 오르답 일일 등수 API. 게임 자체는 Vercel 이 서빙하고, 여기는 판 하나만 맡는다.
import { submitScore, topRows } from './board.js';

// 🔴 게임 주소가 늘면 **여기도 늘어야 한다**. 2026-09-06 에 oreudap 도메인을 추가하고 이 줄을
//    안 고쳐서, 새 주소에서 등수판이 통째로 죽어 있었다(화면엔 판이 비어 보일 뿐 에러가 안 뜬다).
//    도메인 추가는 «Vercel 한 곳»이 아니라 «Vercel + 이 목록» 두 곳이다.
const ALLOW = ['https://oreudap.vercel.app', 'https://muhan-pi.vercel.app'];
// 로컬 개발·게이트가 쓰는 오리진. 포트가 도구마다 달라 목록으로는 못 맞춘다(스모크 8181·플레이 8189…).
// 🔴 CORS 는 여기서 «보호 장치»가 아니다 — 이 API 는 인증이 없어 curl 로는 어차피 누구나 부른다.
//    실제 방어선은 acceptName(실명 거부)·MAX_FLOOR·이름당 한 줄이다.
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function cors(origin) {
  const ok = ALLOW.includes(origin) || LOCAL.test(origin || '');
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOW[0],
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
  };
}
const json = (data, origin, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(origin) },
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (url.pathname !== '/api/rank') return json({ error: 'not found' }, origin, 404);

    try { return await route(request, env, url, origin); }
    catch (e) { console.error('rank', e && e.message); return json({ error: 'db' }, origin, 503); }   // D1 장애 — 판이 «비어 보이는» 대신 오류로
  },
};

async function route(request, env, url, origin) {
    if (request.method === 'GET') {
      const n = Math.min(50, Math.max(1, Number(url.searchParams.get('n')) || 10));
      return json(await topRows(env.DB, n), origin);
    }
    if (request.method === 'POST') {
      let body = null;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, origin, 400); }
      const res = await submitScore(env.DB, body);
      return json(res, origin, res.ok ? 200 : 400);
    }
    return json({ error: 'method' }, origin, 405);
}
