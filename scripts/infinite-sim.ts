// headless infinite-mode simulation: spiral of chunks, report restarts and fallbacks
import { InfiniteWorld } from '../src/modes/infinite';
const fakeWorld: any = { set() {}, remove() {}, clear() {} };
const inf = new InfiniteWorld(fakeWorld, () => 0);
inf.radius = 6;
inf.start(Number(process.argv[2] ?? 1));
const stats: string[] = [];
inf.onStatus = (m) => stats.push(m);
const t0 = performance.now();
for (let i = 0; i < 4000 && stats.length < 140; i++) inf.update({ x: 0, y: 0, z: 0 } as any);
const restarts = stats.map((m) => Number(/\((\d+) restarts/.exec(m)?.[1] ?? 0));
const margins = stats.map((m) => Number(/repaired (\d+)/.exec(m)?.[1] ?? 0));
console.log('chunks', stats.length, 'with restarts', restarts.filter((r) => r > 0).length, 'repaired', margins.filter((m) => m > 0).length, 'margins', JSON.stringify(margins.filter((m) => m > 0)), 'gave up', restarts.filter((r) => r >= 32).length, 'max', Math.max(...restarts), 's', ((performance.now() - t0) / 1000).toFixed(1));
