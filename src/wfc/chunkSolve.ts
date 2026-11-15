import { cellKey } from '../config';
import { WFCSolver } from './solver';

/** Infinite-world chunk solve, run off the main thread (see chunkWorker.ts). */
export interface ChunkJob {
  id: number;
  cx: number;
  cz: number;
  chunk: number;
  height: number;
  worldSeed: number;
  /** which of the four neighbours (W, E, N, S) are already solved */
  has: [boolean, boolean, boolean, boolean];
  /** already-decided cells around the chunk, flat (x, y, z, variant) */
  known: Int32Array;
}

export interface ChunkResult {
  id: number;
  cx: number;
  cz: number;
  /** every cell of the solve region, flat (x, y, z, variant) */
  cells: Int32Array;
  attempts: number;
  margin: number;
  ms: number;
}

/** Contradictions tolerated at each margin before widening the repair region. */
export const LADDER: [margin: number, attempts: number][] = [
  [0, 2],
  [2, 8],
  [3, 8],
  [4, 12],
];
/** how far around a chunk its solve may read decided cells: widest margin + the 8-neighbourhood */
export const KNOWN_REACH = LADDER[LADDER.length - 1][0] + 2;

/**
 * Solve one chunk against its decided neighbours. When it can't be completed, the solve
 * region is widened into the neighbours ("modifying in blocks"): a margin of already-solved
 * cells is re-solved together with the new chunk, so the seam can resolve instead of being cut.
 */
export function solveChunk(job: ChunkJob): ChunkResult {
  const t0 = performance.now();
  const known = new Map<string, number>();
  for (let i = 0; i < job.known.length; i += 4) known.set(cellKey(job.known[i], job.known[i + 1], job.known[i + 2]), job.known[i + 3]);
  const total = LADDER.reduce((a, [, n]) => a + n, 0);
  const { cx, cz, chunk: C, height } = job;
  for (let attempt = 0; ; attempt++) {
    let margin = LADDER[LADDER.length - 1][0];
    let budget = 0;
    for (const [m, n] of LADDER) {
      budget += n;
      if (attempt < budget) {
        margin = m;
        break;
      }
    }
    // last resort only: ignore neighbours (a visible seam beats a hole)
    const giveUp = attempt >= total;
    // only grow into neighbours that exist: unsolved areas stay untouched
    const [hW, hE, hN, hS] = job.has;
    const mW = hW ? margin : 0, mE = hE ? margin : 0;
    const mN = hN ? margin : 0, mS = hS ? margin : 0;
    const x0 = cx * C - mW, z0 = cz * C - mN;
    const sx = C + mW + mE, sz = C + mN + mS;
    const inside = (x: number, z: number) => x >= x0 && x < x0 + sx && z >= z0 && z < z0 + sz;
    const solver = new WFCSolver({
      sx, sy: height, sz,
      ox: x0, oz: z0,
      seed: ((job.worldSeed * 73856093) ^ (cx * 19349663) ^ (cz * 83492791)) + attempt * 7919,
      external: giveUp ? undefined : (x, y, z) => (inside(x, z) ? undefined : known.get(cellKey(x, y, z))),
    });
    if (!solver.solve()) continue;
    const cells = new Int32Array(solver.n * 4);
    for (let i = 0; i < solver.n; i++) {
      const [x, y, z] = solver.world(i);
      let variant = -1;
      solver.forEach(i, (q) => (variant = q));
      cells.set([x, y, z, variant], i * 4);
    }
    return { id: job.id, cx, cz, cells, attempts: attempt, margin, ms: performance.now() - t0 };
  }
}
