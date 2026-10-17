/* m4a-fallback.js — game-builder kit/audio-fallback (2026-10-17 · 사용자 «모두 고쳐»)
 * 어떤 폰 브라우저는 AAC(.m4a)를 decodeAudioData 로 못 푼다(«EncodingError: Unable to decode audio data» — 빙글스텝 판이 전부 안 열렸다).
 * 이 파일을 페이지 <head> 맨 앞에 «일반 스크립트»로 넣으면, .m4a 해독이 실패할 때 같은 자리의 .ogg(Opus)를 받아 대신 푼다.
 *   - fetch(Response.arrayBuffer)·XHR(arraybuffer) 로 받은 버퍼의 주소를 기억해 둔다(게임 코드는 안 고친다)
 *   - 한 번 실패한 기기는 그 뒤로 .ogg 를 바로 받는다
 *   - 예비본 만들기 = kit/audio-fallback/make-ogg.sh <웹 루트> · 검사 = tools/check-audio-fallback.mjs
 * 고치지 말고 키트에서 고쳐 다시 복사한다.
 */
(function () {
  if (window.__m4aFallback) return; window.__m4aFallback = { used: 0 };
  var urlOf = new WeakMap();
  function tag(buf, url) { try { if (buf && url) urlOf.set(buf, url); } catch (e) { /* */ } return buf; }
  if (window.Response && Response.prototype.arrayBuffer) {
    var ab = Response.prototype.arrayBuffer;
    Response.prototype.arrayBuffer = function () { var u = this.url; return ab.call(this).then(function (b) { return tag(b, u); }); };
  }
  var X = window.XMLHttpRequest && XMLHttpRequest.prototype, d = X && Object.getOwnPropertyDescriptor(X, 'response');
  if (d && d.get && d.configurable) {
    Object.defineProperty(X, 'response', { configurable: true, enumerable: d.enumerable, get: function () { var r = d.get.call(this); if (r instanceof ArrayBuffer) tag(r, this.responseURL); return r; } });
  }
  var C = window.BaseAudioContext || window.AudioContext || window.webkitAudioContext;
  var P = C && C.prototype; if (!P || !P.decodeAudioData) return;
  var orig = P.decodeAudioData, preferOgg = false;
  var M4A = /\.m4a(?=[?#]|$)/i;
  P.decodeAudioData = function (buf, ok, err) {
    var ctx = this, url = urlOf.get(buf), ogg = url && M4A.test(url) ? url.replace(M4A, '.ogg') : null;
    function viaOgg() {
      window.__m4aFallback.used++;
      return fetch(ogg).then(function (r) { if (!r.ok) throw new Error('예비본 ' + r.status + ' ' + ogg); return r.arrayBuffer(); })
        .then(function (b) { return new Promise(function (res, rej) { var q = orig.call(ctx, b, res, rej); if (q && q.then) q.then(res, rej); }); });
    }
    var p = preferOgg && ogg ? viaOgg() : new Promise(function (res, rej) { var q = orig.call(ctx, buf, res, rej); if (q && q.then) q.then(res, rej); })
      .catch(function (e) { if (!ogg) throw e; preferOgg = true; return viaOgg(); });
    if (ok || err) { p.then(ok, err); p.catch(function () {}); }
    return p;
  };
})();
