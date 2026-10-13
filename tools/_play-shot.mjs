import { chromium } from 'playwright';
const [url, out] = process.argv.slice(2);
const b = await chromium.launch();
const errs = [];
for (const [n, vp] of [['m', { width: 390, height: 844 }], ['pc', { width: 1440, height: 900 }]]) {
  const p = await b.newPage({ viewport: vp });
  p.on('pageerror', (e) => errs.push(`${n} PAGEERR ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(`${n}: ${m.text().slice(0, 160)}`); });
  await p.goto(url, { waitUntil: 'load' });
  await p.waitForTimeout(1500);
  await p.click('#btn-play');
  await p.waitForTimeout(1500);
  const how = await p.$('#btn-how-start'); if (how && await how.isVisible()) await how.click();
  for (let i = 0; i < 24; i++) {
    await p.evaluate(() => { const a = window.__SMOKE__.app; const q = a.core && a.core.question; if (q && !a.core.answered) a.press(q.answerIndex); });
    await p.waitForTimeout(420);
  }
  await p.screenshot({ path: `${out}/play-${n}.png` });
  console.log(n, await p.evaluate(() => ({ floor: window.__SMOKE__.app.core.floor, zone: window.__SMOKE__.app.scene.zone, screen: window.__SMOKE__.app.screen })));
}
console.log(errs.join('\n') || 'no errors');
await b.close();
