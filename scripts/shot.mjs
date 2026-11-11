// usage: node scripts/shot.mjs <name> [jsToEvalBeforeShot] [waitMs]
import { chromium } from 'playwright-core';
const [name = 'shot', js = '', wait = '6000'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(process.env.URL || 'http://localhost:5173/');
await page.waitForTimeout(1500);
if (js) await page.evaluate(js);
await page.waitForTimeout(+wait);
await page.screenshot({ path: `shots/${name}.png` });
const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); }));
console.log('fps~', fps);
console.log(logs.filter((l) => !l.includes('[vite]')).slice(0, 20).join('\n'));
await browser.close();
