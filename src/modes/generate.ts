import { World, CellRec } from '../render/world';
import { WFCSolver, solveWithRetries } from '../wfc/solver';
import { AIR_INDEX } from '../wfc/variants';

export interface GenParams {
  sx: number;
  sz: number;
  sy: number;
  seed: number;
  animate: boolean;
  /** cells revealed per frame when animating */
  speed: number;
  borderOpen: boolean;
}

export interface Region {
  x0: number;
  z0: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Runs WFC over a region of the world, either instantly or one collapse at a
 * time so you can watch the wave propagate. Existing cells inside the region
 * become fixed constraints, cells around it become external constraints.
 */
export class Generator {
  private solver: WFCSolver | null = null;
  private snapshot: Map<string, CellRec> | null = null;
  private region: Region | null = null;
  private params: GenParams | null = null;
  private fixed = new Map<number, number>();
  private attempt = 0;
  onStatus: (msg: string) => void = () => {};
  onDone: () => void = () => {};
  /** Pieces about to pop in (spawn: stage time each one starts growing). */
  onReveal: (cells: { x: number; y: number; z: number; v: number; spawn: number }[]) => void = () => {};
  /** Cells decided so far in the current run, out of `total`. */
  done = 0;
  total = 0;
  /** Wall-clock duration of the last finished run (ms). */
  lastMs = 0;
  /** time spent inside the solver during an animated run */
  private solveMs = 0;

  constructor(private world: World, private now: () => number) {}

  get running() {
    return this.solver !== null;
  }

  stop() {
    this.solver = null;
  }

  run(params: GenParams, region: Region) {
    this.params = params;
    this.region = region;
    this.attempt = 0;
    this.done = 0;
    this.total = region.sx * region.sy * region.sz;
    this.solveMs = 0;
    this.snapshot = new Map(this.world.cells);
    this.fixed.clear();
    const { x0, z0, sx, sy, sz } = region;
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++) {
          const v = this.world.variantAt(x0 + x, y, z0 + z);
          if (v !== undefined && v !== AIR_INDEX) this.fixed.set(x + sx * (z + sz * y), v);
        }

    const opts = this.options(params.seed);
    if (!params.animate) {
      const t0 = performance.now();
      const r = solveWithRetries(opts, 40);
      if (!r) {
        this.onStatus(this.fixed.size ? 'Contradiction: the placed modules cannot be completed.' : 'Failed to solve, try another seed.');
        return;
      }
      const now = this.now();
      const cx = x0 + sx / 2, cz = z0 + sz / 2;
      const shown: { x: number; y: number; z: number; v: number; spawn: number }[] = [];
      for (const c of r.cells) {
        if (this.fixed.has(c.x - x0 + sx * (c.z - z0 + sz * c.y)) && this.world.variantAt(c.x, c.y, c.z) === c.variant) continue;
        const dist = Math.hypot(c.x - cx, c.z - cz);
        const spawn = now + dist * 0.045 + c.y * 0.12;
        this.world.set(c.x, c.y, c.z, c.variant, spawn);
        if (c.variant !== AIR_INDEX) shown.push({ x: c.x, y: c.y, z: c.z, v: c.variant, spawn });
      }
      this.onReveal(shown);
      this.done = this.total;
      this.lastMs = performance.now() - t0;
      this.onStatus(`Solved ${r.cells.length} cells in ${this.lastMs.toFixed(0)} ms (${r.tries} ${r.tries > 1 ? 'tries' : 'try'})`);
      this.onDone();
      return;
    }
    this.solver = new WFCSolver(opts);
    if (this.solver.contradiction && this.fixed.size) {
      this.solver = null;
      this.onStatus('Contradiction: the placed modules cannot be completed.');
    }
  }

  private options(seed: number) {
    const r = this.region!;
    return {
      sx: r.sx, sy: r.sy, sz: r.sz,
      ox: r.x0, oz: r.z0,
      seed,
      borderOpen: this.params!.borderOpen,
      fixed: this.fixed,
      external: (x: number, y: number, z: number) => this.world.variantAt(x, y, z),
    };
  }

  update() {
    if (!this.solver || !this.params || !this.region) return;
    const now = this.now();
    let revealed = 0;
    const shown: { x: number; y: number; z: number; v: number; spawn: number }[] = [];
    while (revealed < this.params.speed) {
      const ts = performance.now();
      const r = this.solver.step();
      this.solveMs += performance.now() - ts;
      if (r === null) {
        // contradiction: roll back and retry with another seed
        this.attempt++;
        this.world.clear();
        for (const [, c] of this.snapshot!) this.world.set(c.x, c.y, c.z, c.v, c.spawn);
        this.done = 0;
        if (this.attempt > 40) {
          this.solver = null;
          this.onStatus('Gave up after 40 contradictions.');
          return;
        }
        this.onStatus(`Contradiction, retrying (#${this.attempt})`);
        this.solver = new WFCSolver(this.options(this.params.seed + this.attempt * 7919));
        return;
      }
      if (r.length === 0) {
        this.onReveal(shown);
        this.solver = null;
        this.done = this.total;
        this.lastMs = this.solveMs;
        this.onStatus(`Collapsed ${this.region.sx * this.region.sy * this.region.sz} cells${this.attempt ? ` after ${this.attempt} restarts` : ''}`);
        this.onDone();
        return;
      }
      this.done += r.length;
      for (const c of r) {
        const existing = this.world.get(c.x, c.y, c.z);
        if (existing && existing.v === c.variant) continue;
        this.world.set(c.x, c.y, c.z, c.variant, now);
        if (c.variant !== AIR_INDEX) {
          revealed++;
          shown.push({ x: c.x, y: c.y, z: c.z, v: c.variant, spawn: now });
        }
      }
    }
    this.onReveal(shown);
  }
}

export function centeredRegion(p: GenParams): Region {
  return { x0: -Math.floor(p.sx / 2), z0: -Math.floor(p.sz / 2), sx: p.sx, sy: p.sy, sz: p.sz };
}
