import { DIRS, UP } from '../config';
import { JOIN_SOCKETS, socketsConnect } from './modules';
import { AIR_INDEX, VARIANTS, Variant, fits } from './variants';

/** Highest floor build mode stacks to: the top floor only takes roofs and spires. */
export const MAX_BUILD_LEVEL = 5;
/** From this floor up, roofs rank first so stacking on "auto" tops a tower off. */
const ROOF_FROM = 3;

export type Lookup = (x: number, y: number, z: number) => number | undefined;

/**
 * Variants that can be dropped into (x,y,z) given already placed neighbours.
 * Empty / air neighbours are wildcards, except that upper cells need support.
 * Sorted best-first: more real socket connections, fewer dangling sockets. `jitter` adds a
 * random tie-break per variant (one draw per module, so its turns stay together).
 */
export function candidatesAt(lookup: Lookup, x: number, y: number, z: number, moduleId?: string, jitter?: (moduleId: string) => number): Variant[] {
  const solid = (vx: number, vy: number, vz: number) => {
    const v = lookup(vx, vy, vz);
    return v === undefined || v === AIR_INDEX ? undefined : VARIANTS[v];
  };
  const below = y > 0 ? solid(x, y - 1, z) : undefined;
  if (y > 0 && !below) return [];
  if (y > MAX_BUILD_LEVEL) return [];
  const above = solid(x, y + 1, z);
  const out: { v: Variant; score: number }[] = [];
  for (const v of VARIANTS) {
    if (v.index === AIR_INDEX) continue;
    if (moduleId && v.module.id !== moduleId) continue;
    if (y === 0 && v.bottomKey !== 'ground') continue;
    if (below && !fits(below, v, UP)) continue;
    if (above && !fits(v, above, UP)) continue;
    const caps = v.topKey === 'air';
    if (y === MAX_BUILD_LEVEL && !caps) continue;
    let ok = true;
    let joins = 0;
    let score = v.weight * 0.05;
    if (y >= ROOF_FROM && caps) score += 1;
    for (let d = 0; d < 4 && ok; d++) {
      const [dx, , dz] = DIRS[d];
      const n = solid(x + dx, y, z + dz);
      if (!n) {
        if (JOIN_SOCKETS.has(v.sides[d])) score -= 0.6; // dangling socket
        continue;
      }
      if (!fits(v, n, d)) ok = false;
      else if (socketsConnect(v.sides[d], n.sides[(d + 2) % 4])) {
        score += 2;
        joins++;
      }
    }
    // pieces that hang in the air (sky bridges) must dock to something, not perch on a roof
    if (v.bottomKey === 'air' && !joins) ok = false;
    // "auto" variety: shuffles fits that are equally good, never outranks a real connection (+2)
    if (jitter) score += jitter(v.module.id);
    if (ok) out.push({ v, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.map((o) => o.v);
}
