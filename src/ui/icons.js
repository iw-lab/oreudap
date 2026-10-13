// 화면 아이콘 — 직접 그린 24px 선 SVG(currentColor). 이모지를 쓰지 않는다(기기마다 모양·색이 달라 톤이 깨진다 —
// game-builder check-no-emoji). 키트 아이콘(gb-icons.js)과 같은 선 굵기·같은 끝 모양으로 맞췄다.
const P = {
  // 과목 — 글자 아이콘(그림이 아니라 «무엇을 배우는가»가 한눈에)
  gugudan: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/>',
  words: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 16l2.6-8h.8L13 16M8 13.5h4"/><path d="M17.5 12.2a1.9 1.9 0 1 0 0 3.6V11"/>',
  korean: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7 8h4c0 3-1.4 5.6-4 7M14 7v10M14 12h3"/>',
  // 모드
  infinity: '<path d="M12 12c-2-2.6-3.6-4-5.6-4a4 4 0 0 0 0 8c2 0 3.6-1.4 5.6-4zm0 0c2 2.6 3.6 4 5.6 4a4 4 0 0 0 0-8c-2 0-3.6 1.4-5.6 4z"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M10 2h4"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.5 2.4-5.4 3.6-8.3.4 1.7 1.3 2.8 2.4 3.4-.2-2.8.9-5.6 3-7.4.3 3.1 1.8 4.6 3 6.4.9 1.4 1 2.6 1 3.7C18.5 18.4 15.9 21 12 21z"/><path d="M12 21c-1.6 0-2.8-1.1-2.8-2.7 0-1.8 1.6-2.6 2.2-4.3 1.6 1.2 3.4 2.4 3.4 4.3 0 1.6-1.2 2.7-2.8 2.7z"/>',
  mirror: '<path d="M12 3v18"/><path d="M8 7L4 12l4 5"/><path d="M16 7l4 5-4 5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M9.5 15l1.8 1.8L15 13"/>',
  // 여정 구간
  forest: '<path d="M12 3l5 7h-3l4 6H6l4-6H7z"/><path d="M12 16v5"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 9.3 4.3 4.3 0 1 1 17.3 18z"/>',
  planet: '<circle cx="12" cy="12" r="5.5"/><path d="M4.2 15.8c-1.5 1.6-1.9 2.9-1.2 3.6 1.4 1.4 6.6-1.4 11.5-6.3s7.7-10.1 6.3-11.5c-.7-.7-2-.3-3.6 1.2"/>',
  volcano: '<path d="M3 20l6-9h6l6 9z"/><path d="M10 11l1-3h2l1 3"/><path d="M12 5V2M9 5.5L7.5 3M15 5.5L16.5 3"/>',
  // UI
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7M9 11.5h5"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 4"/><path d="M12 17.3h.01"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>',
  week: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.3-9.2A4.8 4.8 0 0 1 12 6.6a4.8 4.8 0 0 1 9.3 4.7C19.5 15.9 12 20.5 12 20.5z" fill="currentColor"/>',
  coin: '<circle cx="12" cy="12" r="8.5" fill="currentColor" stroke="none"/><path d="M12 7.5v9M9.8 9.6c.5-.9 1.3-1.3 2.4-1.3 1.3 0 2.2.7 2.2 1.7 0 2.4-4.6 1.4-4.6 3.8 0 1 .9 1.8 2.4 1.8 1.1 0 2-.5 2.5-1.4" stroke="#2a1e00" stroke-width="1.6"/>',
  logo: '<path d="M3 20h4v-4h4v-4h4V8h4V4" stroke-width="2.6"/><circle cx="19" cy="4" r="1.6" fill="currentColor" stroke="none"/>',
  school: '<path d="M3 10l9-6 9 6"/><path d="M5 9v11h14V9"/><path d="M10 20v-5h4v5"/>',
};

/** icon('timer') → 인라인 SVG 문자열 · cls 로 크기·색 */
export function icon(name, cls = '') {
  const d = P[name];
  if (!d) return '';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/** DOM 노드로 */
export function iconEl(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstElementChild || document.createElement('span');
}

export const SUBJECT_ICON = { gugudan: 'gugudan', words34: 'words', words56: 'words', korean34: 'korean', korean56: 'korean' };
export const MODE_ICON = { classic: 'infinity', sprint: 'timer', thrill: 'flame', mirror: 'mirror', daily: 'calendar' };
