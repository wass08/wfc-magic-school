import { solveWithRetries } from '../src/wfc/solver';
import { VARIANTS } from '../src/wfc/variants';
const counts: Record<string, number> = {};
let comps = 0, sizes: number[] = [];
for (let s = 0; s < 20; s++) {
  const r = solveWithRetries({ sx: 24, sy: 5, sz: 24, seed: s * 13 + 5, borderOpen: true })!;
  const grid = new Map<string, string>();
  for (const c of r.cells) if (c.y === 0) grid.set(`${c.x},${c.z}`, VARIANTS[c.variant].module.id);
  for (const id of grid.values()) if (id.startsWith('blk')) counts[id] = (counts[id] ?? 0) + 1;
  // connected building components (4-neighbour)
  const seen = new Set<string>();
  for (const [k, id] of grid) {
    if (!id.startsWith('blk') || seen.has(k)) continue;
    let n = 0; const st = [k]; seen.add(k);
    while (st.length) { const cur = st.pop()!; n++; const [x, z] = cur.split(',').map(Number);
      for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nk = `${x+dx},${z+dz}`; if (grid.get(nk)?.startsWith('blk') && !seen.has(nk)) { seen.add(nk); st.push(nk); } } }
    comps++; sizes.push(n);
  }
}
sizes.sort((a, b) => b - a);
console.log(counts, 'buildings', comps, 'largest', sizes.slice(0, 8).join(','), 'median', sizes[Math.floor(sizes.length / 2)]);
