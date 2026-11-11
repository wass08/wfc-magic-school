import { solveWithRetries } from '../src/wfc/solver';
let tries = 0; const t0 = performance.now();
for (let s = 0; s < 10; s++) tries += solveWithRetries({ sx: 24, sy: 5, sz: 24, seed: s * 13 + 5, borderOpen: true })!.tries;
console.log('ms', ((performance.now() - t0) / 10).toFixed(0), 'avg tries', tries / 10);
