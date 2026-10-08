// 옛 gmail 계정 «oreudap-rank» 자리 — 새 등수 서버(daum 계정 D1)로 그대로 넘겨준다(2026-10-08 KV → D1 이전).
// 왜 남기나: 옛 화면을 캐시한 브라우저가 옛 주소로 계속 보낸다. 끄면 그 아이들 기록이 사라지고,
//            옛 코드를 두면 KV(무료 한도 초과로 429)를 계속 쓴다. 넘겨주기만 하면 둘 다 해결된다.
const NEW = 'https://oreudap-rank.simssijjang-a04.workers.dev';
export default {
  async fetch(request) {
    const u = new URL(request.url);
    return fetch(new Request(NEW + u.pathname + u.search, request));   // 메서드·헤더(Origin 포함)·본문 그대로 — CORS 는 새 서버가 판정
  },
};
