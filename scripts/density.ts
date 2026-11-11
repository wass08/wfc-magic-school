import { solveWithRetries } from '../src/wfc/solver';
import { VARIANTS } from '../src/wfc/variants';
let fill = 0, total = 0, fails = 0;
const counts: Record<string, number> = {};
for (let s = 0; s < 20; s++) {
  const r = solveWithRetries({ sx: 12, sy: 4, sz: 12, seed: s * 31 + 1, borderOpen: true });
  if (!r) { fails++; continue; }
  for (const c of r.cells) {
    if (c.y !== 0) continue;
    const id = VARIANTS[c.variant].module.id;
    counts[id] = (counts[id] ?? 0) + 1; total++;
    if (['grass', 'court', 'water'].includes(id)) fill++;
  }
}
console.log('fails', fails, 'filler share', (fill / total).toFixed(2), counts);
