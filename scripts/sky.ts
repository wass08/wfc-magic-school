import { solveWithRetries } from '../src/wfc/solver';
import { VARIANTS } from '../src/wfc/variants';
const SKY = new Set(['skyBridge', 'skySpan', 'skyLongEnd', 'skyMid']);
const lens: Record<number, number> = {};
let fails = 0, bad = 0;
for (let s = 0; s < 12; s++) {
  const r = solveWithRetries({ sx: 24, sy: 7, sz: 24, seed: s * 7 + 3, borderOpen: true });
  if (!r) { fails++; continue; }
  const g = new Map<string, number>();
  for (const c of r.cells) g.set(`${c.x},${c.y},${c.z}`, c.variant);
  const seen = new Set<string>();
  for (const [k, vi] of g) {
    if (!SKY.has(VARIANTS[vi].module.id) || seen.has(k)) continue;
    // walk the span along its sb axis
    const st = [k]; seen.add(k); let n = 0; const ends: string[] = [];
    while (st.length) {
      const cur = st.pop()!; n++;
      const [x, y, z] = cur.split(',').map(Number); const v = VARIANTS[g.get(cur)!];
      [[1, 0], [0, -1], [-1, 0], [0, 1]].forEach(([dx, dz], d) => {
        if (v.sides[d] === 'o') return;
        const nk = `${x + dx},${y},${z + dz}`; const nv = g.get(nk);
        const nid = nv === undefined ? 'none' : VARIANTS[nv].module.id;
        if (SKY.has(nid)) { if (!seen.has(nk)) { seen.add(nk); st.push(nk); } }
        else ends.push(nid);
      });
    }
    lens[n] = (lens[n] ?? 0) + 1;
    if (ends.length !== 2 || ends.some((e) => e === 'none' || e === 'air')) bad++;
  }
}
console.log('fails', fails, 'span lengths', lens, 'undocked', bad);
