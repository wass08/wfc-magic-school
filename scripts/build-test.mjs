import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.stack}`));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(1200);
await page.click('nav.tabs button[data-mode="build"]');
await page.click('#clear');
await page.evaluate(() => { stage.controls.target.set(0, 0, 0); stage.camera.position.set(26, 24, 26); });
await page.waitForTimeout(400);
// project world points to screen so we click exact cells/faces
const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => { const v = new stage.camera.position.constructor(x, y, z).project(stage.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, [x, y, z]);
const clickAt = async (x, y, z, sel) => {
  if (sel !== undefined) await page.click(`button.mod[data-mod="${sel}"]`);
  const [sx, sy] = await toScreen(x, y, z);
  await page.mouse.move(sx, sy); await page.waitForTimeout(60);
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(60);
  return page.evaluate(() => document.getElementById('hint').textContent);
};
const W = 4, H = 3;
console.log('tower ground', await clickAt(0, -1, 0, 'towerBase'));
console.log('wall side', await clickAt(W / 2, 1.5, 0, 'wall'));       // +X face of tower -> wall at (1,0,0)
console.log('wall2 side', await clickAt(W * 1.5, 1.2, 0, 'wall'));     // +X face of wall -> (2,0,0)
console.log('auto end', await clickAt(W * 2.5, 1.2, 0, ''));           // auto at (3,0,0)
console.log('tower mid', await clickAt(0, H, 0, 'towerMid'));          // top of tower
console.log('tower roof', await clickAt(0, H * 2, 0, 'towerRoof'));
console.log('hall ground', await clickAt(0, -1, W * 2, 'hall'));
console.log('hall side', await clickAt(W / 2, 1.5, W * 2, 'hall'));
console.log('hall end', await clickAt(W * 1.5, 1.5, W * 2, 'hallEnd'));
console.log('roof', await clickAt(W, H, W * 2, 'hallRoof'));
console.log('roof gable', await clickAt(0, H, W * 2, 'hallRoofEnd'));
console.log('bad: wall on top', await clickAt(W, H, 0, 'wall'));
console.log('water', await clickAt(-W, -1, W, 'water'));
console.log('water2', await clickAt(-W, -1, W * 2, 'water'));
console.log('garden', await clickAt(-W, -1, 0, 'grass'));
// hover a dangling socket to show ghost
await page.click('button.mod[data-mod=""]');
const [hx, hy] = await toScreen(W * 3.5, 1.2, 0); await page.mouse.move(hx, hy);
await page.waitForTimeout(1500);
console.log('cells', await page.evaluate(() => [...world.cells.values()].map((c) => `${c.x},${c.y},${c.z}`).join(' ')));
await page.screenshot({ path: 'shots/build.png' });
await page.click('#fill');
await page.waitForTimeout(6000);
await page.evaluate(() => { stage.controls.target.set(0, 0, 4); stage.camera.position.set(40, 38, 44); });
await page.waitForTimeout(800);
await page.screenshot({ path: 'shots/build-fill.png' });
console.log('status', await page.evaluate(() => document.getElementById('status').textContent));
console.log(logs.filter((l) => !l.includes('[vite]')).join('\n'));
await browser.close();
