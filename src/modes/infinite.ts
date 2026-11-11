import * as THREE from 'three';
import { CELL_W, cellKey } from '../config';
import { World } from '../render/world';
import { WFCSolver } from '../wfc/solver';

const CHUNK = 8;
const HEIGHT = 5;

interface Chunk {
  cx: number;
  cz: number;
  shown: boolean;
}

interface Pending {
  cx: number;
  cz: number;
  attempt: number;
  margin: number;
  /** solve region in cell coordinates */
  x0: number;
  z0: number;
  sx: number;
  sz: number;
  solver: WFCSolver;
  t0: number;
}

/** Contradictions tolerated at each margin before widening the repair region. */
const LADDER: [margin: number, attempts: number][] = [
  [0, 2],
  [2, 8],
  [3, 8],
  [4, 12],
];

/**
 * Endless castle: chunks are solved on demand around the camera target, each
 * one constrained by the already-solved cells of its neighbours.
 *
 * When a chunk can't be completed against its neighbours, the solve region is
 * widened into them ("modifying in blocks"): a margin of already-solved cells
 * is re-solved together with the new chunk, so the seam can resolve instead of
 * being cut. Far chunks are hidden but kept, so revisiting is stable.
 */
export class InfiniteWorld {
  private chunks = new Map<string, Chunk>();
  private store = new Map<string, number>();
  private pending: Pending | null = null;
  radius = 3;
  seed = 1;
  active = false;
  onStatus: (msg: string) => void = () => {};

  constructor(private world: World, private now: () => number) {}

  start(seed: number) {
    this.seed = seed;
    this.chunks.clear();
    this.store.clear();
    this.world.clear();
    this.pending = null;
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  private chunkOf(x: number, z: number) {
    return this.chunks.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`);
  }

  private begin(cx: number, cz: number, attempt: number, t0 = performance.now()): Pending {
    let margin = LADDER[LADDER.length - 1][0];
    let budget = 0;
    for (const [m, n] of LADDER) {
      budget += n;
      if (attempt < budget) {
        margin = m;
        break;
      }
    }
    const giveUp = attempt >= budget && attempt >= LADDER.reduce((a, [, n]) => a + n, 0);
    // only grow into neighbours that exist: unsolved areas stay untouched
    const has = (dx: number, dz: number) => this.chunks.has(`${cx + dx},${cz + dz}`);
    const mW = has(-1, 0) ? margin : 0, mE = has(1, 0) ? margin : 0;
    const mN = has(0, -1) ? margin : 0, mS = has(0, 1) ? margin : 0;
    const x0 = cx * CHUNK - mW, z0 = cz * CHUNK - mN;
    const sx = CHUNK + mW + mE, sz = CHUNK + mN + mS;
    const inside = (x: number, z: number) => x >= x0 && x < x0 + sx && z >= z0 && z < z0 + sz;
    const seed = ((this.seed * 73856093) ^ (cx * 19349663) ^ (cz * 83492791)) + attempt * 7919;
    const solver = new WFCSolver({
      sx, sy: HEIGHT, sz,
      ox: x0, oz: z0,
      seed,
      // last resort only: ignore neighbours (a visible seam beats a hole)
      external: giveUp ? undefined : (x, y, z) => (inside(x, z) ? undefined : this.store.get(cellKey(x, y, z))),
    });
    return { cx, cz, attempt, margin, x0, z0, sx, sz, solver, t0 };
  }

  /** Advance the pending solve within a time budget; returns the chunk once done. */
  private advance(budgetMs: number): Chunk | null {
    let p = this.pending!;
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      const r = p.solver.step();
      if (r === null) {
        p = this.pending = this.begin(p.cx, p.cz, p.attempt + 1, p.t0);
        continue;
      }
      if (r.length) continue;
      const chunk: Chunk = { cx: p.cx, cz: p.cz, shown: false };
      this.chunks.set(`${p.cx},${p.cz}`, chunk);
      const now = this.now();
      for (let i = 0; i < p.solver.n; i++) {
        const [x, y, z] = p.solver.world(i);
        let variant = -1;
        p.solver.forEach(i, (q) => (variant = q));
        const owner = this.chunkOf(x, z);
        if (!owner) continue; // corner of an unsolved diagonal chunk: leave it free
        const key = cellKey(x, y, z);
        if (this.store.get(key) === variant) continue;
        this.store.set(key, variant);
        // repaired margin cells of visible neighbours update in place
        if (owner !== chunk && owner.shown) this.world.set(x, y, z, variant, now);
      }
      const extra = p.attempt ? ` (${p.attempt} restarts${p.margin ? `, repaired ${p.margin}-cell margin` : ''})` : '';
      this.onStatus(`${this.chunks.size} chunks · last solved in ${(performance.now() - p.t0).toFixed(0)} ms${extra}`);
      this.pending = null;
      return chunk;
    }
    return null;
  }

  private show(c: Chunk, animate: boolean) {
    const now = this.now();
    const ccx = (c.cx + 0.5) * CHUNK, ccz = (c.cz + 0.5) * CHUNK;
    for (let y = 0; y < HEIGHT; y++)
      for (let z = c.cz * CHUNK; z < (c.cz + 1) * CHUNK; z++)
        for (let x = c.cx * CHUNK; x < (c.cx + 1) * CHUNK; x++) {
          const v = this.store.get(cellKey(x, y, z));
          if (v === undefined) continue;
          const d = Math.hypot(x - ccx, z - ccz);
          this.world.set(x, y, z, v, animate ? now + d * 0.04 + y * 0.1 : -100);
        }
    c.shown = true;
  }

  private hide(c: Chunk) {
    for (let y = 0; y < HEIGHT; y++)
      for (let z = c.cz * CHUNK; z < (c.cz + 1) * CHUNK; z++)
        for (let x = c.cx * CHUNK; x < (c.cx + 1) * CHUNK; x++) this.world.remove(x, y, z);
    c.shown = false;
  }

  update(target: THREE.Vector3) {
    if (!this.active) return;
    const ccx = Math.floor((target.x / CELL_W + 0.5) / CHUNK);
    const ccz = Math.floor((target.z / CELL_W + 0.5) / CHUNK);
    const r = this.radius;

    // nearest missing chunk first; solving is time-sliced to keep frames smooth
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const d = dx * dx + dz * dz;
        if (d > r * r + 1) continue;
        const c = this.chunks.get(`${ccx + dx},${ccz + dz}`);
        if (c && !c.shown) this.show(c, false);
        if (!c && d < bestD) {
          bestD = d;
          best = [ccx + dx, ccz + dz];
        }
      }
    if (!this.pending && best) this.pending = this.begin(best[0], best[1], 0);
    if (this.pending) {
      const c = this.advance(6);
      if (c) this.show(c, true);
    }

    for (const c of this.chunks.values()) {
      if (!c.shown) continue;
      const dx = c.cx - ccx, dz = c.cz - ccz;
      if (dx * dx + dz * dz > (r + 1.5) * (r + 1.5)) this.hide(c);
    }
  }
}
