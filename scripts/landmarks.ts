import { solveWithRetries } from '../src/wfc/solver';
import { VARIANTS } from '../src/wfc/variants';
const L = new Set(VARIANTS.filter((v) => v.module.solitary).map((v) => v.module.id));
let touching = 0, total = 0;
for (let s = 0; s < 15; s++) {
  const r = solveWithRetries({ sx: 24, sy: 5, sz: 24, seed: s * 11 + 2, borderOpen: true })!;
  const g = new Map<string, string>();
  for (const c of r.cells) g.set(`${c.x},${c.y},${c.z}`, VARIANTS[c.variant].module.id);
  for (const [k, id] of g) {
    if (!L.has(id)) continue; total++;
    const [x, y, z] = k.split(',').map(Number);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if ((dx || dz) && g.get(`${x + dx},${y},${z + dz}`) === id) { touching++; dz = 2; break; }
  }
}
console.log('landmarks', total, 'touching a twin', touching);
