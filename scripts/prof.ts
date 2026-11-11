import { WFCSolver } from '../src/wfc/solver';
const s0 = performance.now();
for (let i = 0; i < 5; i++) new WFCSolver({ sx: 24, sy: 5, sz: 24, seed: i * 13 + 5, borderOpen: true }).solve();
console.log('ms/solve', ((performance.now() - s0) / 5).toFixed(0));
