import { chromium } from 'playwright-core';
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:5173/'); await page.waitForTimeout(1200);
await page.click('nav.tabs button[data-mode="build"]'); await page.click('#clear');
await page.evaluate(() => { stage.controls.target.set(0, 0, 0); stage.camera.position.set(26, 24, 26); world.set(0,0,0, VARIANTS.find(v=>v.module.id==='towerBase').index); world.set(0,1,0, VARIANTS.find(v=>v.module.id==='towerMid').index); world.set(1,0,0, VARIANTS.find(v=>v.module.id==='wall'&&v.rot===0).index); });
await page.waitForTimeout(500);
const toScreen = (x, y, z) => page.evaluate(([x, y, z]) => { const v = new stage.camera.position.constructor(x, y, z).project(stage.camera); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; }, [x, y, z]);
// sweep ground points just behind the tower+wall (from the camera's view) and report targets
const out = [];
for (const [x, z] of [[-3, -1], [-1, -3], [-2.5, -2.5], [2, -3.5], [5, -2.6], [-3, 3]]) {
  const [sx, sy] = await toScreen(x, -1, z);
  await page.mouse.move(sx, sy); await page.waitForTimeout(80);
  const t = await page.evaluate(() => { const o = build['outline']; return o.visible ? [o.position.x / 4, o.position.y / 3, o.position.z / 4].join(',') : 'none'; });
  out.push(`ground(${x},${z}) -> cell ${Math.round(x / 4)},0,${Math.round(z / 4)} | outline ${t}`);
}
console.log(out.join('\n'));
await browser.close();
