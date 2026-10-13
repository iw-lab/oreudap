// 화면 레이아웃 단일 진실원.
// 🔴 DOM 오버레이(선택지 버튼)와 Phaser 월드(발판 스프라이트)가 «같은 이 함수»를 쓴다.
//    두 벌로 나뉘면 화면이 어긋나고, 그건 수치 검사가 못 잡는다.

export const MAX_CONTENT_W = 560;
export const MIN_TAP = 44;   // 접근성 최소 터치 타깃(px)
export const CHOICE_MIN_H = 88;

export function computeLayout(w, h) {
  // 🔴 아주 좁은 뷰포트에서 열 너비가 44px 밑으로 내려가면 «선언한 최소 터치 크기»가 깨진다.
  //    화면을 넘더라도 최소 폭을 지킨다(스크롤이 생기는 편이 못 누르는 것보다 낫다).
  const MIN_CONTENT = MIN_TAP * 3 + 24;
  const contentW = Math.max(MIN_CONTENT, Math.min(w - 24, MAX_CONTENT_W));
  const contentLeft = (w - contentW) / 2;
  const landscape = w > h;

  // 두 줄로 접히는 긴 뜻(「스케이트를 타다」)이 들어갈 여유를 둔다.
  const bandH = Math.max(CHOICE_MIN_H, Math.min(152, h * 0.20));
  // 🔴 floorH = «한 층 높이» = 한 번의 도약 거리다. 이 값이 크면 계단이 아니라 뜀뛰기가 되고,
  //    무엇보다 캐릭터 «아래»에 지나온 층이 들어설 자리가 사라져 높이가 체감되지 않는다.
  //    작게 잡아 화면 아래쪽에 계단이 2~3개 쌓여 내려가도록 한다.
  const floorH = Math.max(bandH * 0.62, h * 0.185);

  const cardTop = Math.max(64, h * 0.06);   // v2: HUD 단추(44px)가 4개로 늘어 카드와 겹치지 않게
  const cardH = Math.max(76, Math.min(140, h * (landscape ? 0.185 : 0.15)));
  // 발판 밴드는 카드 바로 아래에 붙이고, 캐릭터는 딱 한 층 아래에 둔다.
  const bandY = Math.max(cardTop + cardH + bandH * 0.60, h * 0.40);
  const charY = bandY + floorH;

  return {
    w, h, landscape, contentW, contentLeft,
    cardTop, cardH,
    bandY, bandH, floorH,
    charY,
    // 🔴 캐릭터는 «한 층 안»에 들어가야 한다 — 크면 머리가 위 발판에 가려 파묻힌 것처럼 보인다.
    //    상한 셋의 뜻: 가로 비율 · 한 층 높이 · 화면 높이.
    charSize: Math.min(contentW * 0.26, floorH * 0.60, h * 0.145),
    // 🔴 발판 띠 폭 = 선택지 열 폭의 원천. 좁히면 발판은 예뻐지지만 «한국어 뜻»이 안 들어간다.
    //    3갈래에서 440px 면 한 열이 136px 이고, 「필요하다」가 40px 글자로 196px 라 잘렸다(실측).
    //    발판 두께는 floorH 로 따로 제한하므로(PLAT_MAX_H) 넓혀도 계단은 두꺼워지지 않는다.
    bandW: contentW,
    gap: contentW > 420 ? 16 : 10,
  };
}

/**
 * k개 갈래의 열 위치. 좌 → (가운데) → 우 순서이며 인덱스가 곧 선택지 인덱스다.
 * @returns {{x:number, y:number, w:number, h:number, cx:number, cy:number}[]}
 */
export function columns(layout, k) {
  const { contentW, bandY, bandH, gap, w } = layout;
  const bandW = layout.bandW || contentW;
  const left = (w - bandW) / 2;
  const colW = (bandW - gap * (k - 1)) / k;
  const out = [];
  for (let i = 0; i < k; i++) {
    const x = left + i * (colW + gap);
    out.push({ x, y: bandY - bandH / 2, w: colW, h: bandH, cx: x + colW / 2, cy: bandY });
  }
  return out;
}
