// 학교 허브 중계(Vercel Edge) — 게임 페이지와 같은 오리진(/api/hub/<경로>, vercel.json 이 ?p= 로 바꿔 넣는다)에서 daum 계정 허브 워커로 넘긴다.
// 키트 정본 = ~/.claude/skills/game-builder/kit/school-hub. Pages 판(functions/api/hub/[[path]].js)과 같은 규약.
// 학교망은 vercel.app 은 통과시키지만 workers.dev 는 홍콩으로 돈다(메모리 free-workers-dev-skips-seoul-pop) — 그래서 같은 오리진 중계.
// 🔴 허브는 이 중계가 붙이는 비밀 머리글(HUB_PROXY_KEY)이 있어야만 받는다. 아이 IP 는 원문을 넘기지 않고
//    «날짜를 섞은 해시 16자»만 넘긴다(학교 와이파이 하루 상한 전용 — 저장소에 IP 원문 0).
export const config = { runtime: 'edge' };

const ALLOW = new Set(['school', 'schools', 'me', 'select', 'pack', 'grade', 'spend', 'refund', 'result']);
const J = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function ipHash(ip, salt) {
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${day}|${ip}`));
  return [...new Uint8Array(h).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(request) {
  const src = new URL(request.url);
  const seg = src.searchParams.get('p') || '';
  if (!ALLOW.has(seg)) return J({ error: 'not found' }, 404);
  const env = process.env;
  if (!env.HUB_URL || !env.HUB_PROXY_KEY) return J({ error: 'config' }, 503);
  const q = new URLSearchParams(src.searchParams); q.delete('p');
  const dst = env.HUB_URL.replace(/\/$/, '') + '/' + seg + (q.toString() ? `?${q}` : '');
  const headers = { 'x-bo-proxy': env.HUB_PROXY_KEY, 'content-type': 'application/json' };
  // 🔴 플랫폼이 넣는 머리글만 믿는다(x-real-ip · x-vercel-forwarded-for). x-forwarded-for 첫 값은 앞단 구성에 따라 위조될 수 있다
  //    (교차검증 gemini CRITICAL 2026-10-11). 둘 다 없으면 IP 해시를 안 붙인다 → 허브가 결과를 거절(why:'iph') — 상한이 꺼지는 쪽보다 낫다.
  const ip = (request.headers.get('x-real-ip') || request.headers.get('x-vercel-forwarded-for') || '').split(',')[0].trim();
  if (ip && env.IP_SALT) headers['x-bo-iph'] = await ipHash(ip, env.IP_SALT);
  const init = { method: request.method === 'POST' ? 'POST' : 'GET', headers };
  if (init.method === 'POST') { const t = await request.text(); if (t.length > 8192) return J({ error: 'big' }, 413); init.body = t; }
  try {
    const r = await fetch(dst, init);
    // 순위도 캐시 금지 — 판 끝나고 바로 열면 옛 점수가 보였다(비트:온 e2e R-9 · 응답에 «내 학교»가 섞여 개인화이기도 하다)
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  } catch { return J({ error: 'hub' }, 502); }
}
