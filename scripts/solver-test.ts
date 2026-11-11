import { solveWithRetries } from '../src/wfc/solver';
import { VARIANTS, NV } from '../src/wfc/variants';
console.log('variants', NV);
for (const [sx, sy, sz, open] of [[10,4,10,true],[16,5,16,false],[24,5,24,true]] as const) {
  let fails = 0, tries = 0; const t0 = performance.now(); const counts: Record<string, number> = {};
  for (let s = 0; s < 10; s++) {
    const r = solveWithRetries({ sx, sy, sz, seed: s * 31 + 1, borderOpen: open });
    if (!r) { fails++; continue; }
    tries += r.tries;
    for (const c of r.cells) { const id = VARIANTS[c.variant].module.id; counts[id] = (counts[id] ?? 0) + 1; }
  }
  console.log(sx, sy, sz, open, 'fails', fails, 'avg tries', (tries / 10).toFixed(2), 'ms/solve', ((performance.now() - t0) / 10).toFixed(1));
  console.log(counts);
}
