/* 옛 주소(oreudap.vercel.app · muhan-pi.vercel.app)에서 넘어온 기기 기록을 받는다 — 주소가 바뀌면 localStorage 가 비기 때문이다.
   옛 주소 tools/old-address/index.html 이 #gbmove=<기록> 으로 보낸다. # 뒤는 서버로 가지 않고, 받자마자 주소에서 지운다.
   이 기기에 이미 있는 값은 덮지 않고, 정해진 열쇠만 받는다(링크로 다른 저장값을 못 심게). 게임 코드(모듈, defer)보다 먼저 돈다. */
(function () {
  var m = /^#gbmove=(.+)$/.exec(location.hash);
  if (!m) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 지우지 못해도 기록은 받는다 */ }
  var data;
  try { data = JSON.parse(decodeURIComponent(m[1])); } catch (e) { return; }
  if (!data || typeof data !== 'object') return;
  var OK = /^(oreudap:|oreudap\.hub\.v1)/;
  Object.keys(data).forEach(function (k) {
    var v = data[k];
    if (!OK.test(k) || typeof v !== 'string' || v.length > 100000) return;
    try { if (localStorage.getItem(k) === null) localStorage.setItem(k, v); } catch (e) { /* 사생활 보호 모드 */ }
  });
})();
