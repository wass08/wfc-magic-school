import { DIRS, mulberry32, opposite, RNG, UP } from '../config';
import { JOIN_SOCKETS, socketsFit } from './modules';
import { COMPAT, NV, VARIANTS, WORDS } from './variants';

export interface SolveOptions {
  /** grid size in cells */
  sx: number;
  sy: number;
  sz: number;
  /** world-space cell offset of grid cell (0,0,0); y must be 0 for the ground rule */
  ox?: number;
  oz?: number;
  seed: number;
  /** force open sockets on the horizontal border (closed, tidy castle) */
  borderOpen?: boolean;
  /** pre-collapsed cells, keyed by local cell index */
  fixed?: Map<number, number>;
  /** variant of an already-decided cell just outside the grid, if any */
  external?: (wx: number, wy: number, wz: number) => number | undefined;
}

export interface Collapse {
  x: number; // world cell coords
  y: number;
  z: number;
  variant: number;
}

/**
 * Wave Function Collapse over a 3D grid of module variants.
 * Domains are bitsets; propagation is arc-consistency over 6 neighbours.
 */
export class WFCSolver {
  readonly n: number;
  readonly dom: Uint32Array;
  readonly count: Int32Array;
  private sumW: Float64Array;
  private sumWL: Float64Array;
  private emitted: Uint8Array;
  private stack: number[] = [];
  private inStack: Uint8Array;
  private fresh: number[] = [];
  private rng: RNG;
  private allowed6 = new Uint32Array(WORDS * 6);
  contradiction = false;

  constructor(readonly o: SolveOptions) {
    this.n = o.sx * o.sy * o.sz;
    this.dom = new Uint32Array(this.n * WORDS);
    this.count = new Int32Array(this.n);
    this.sumW = new Float64Array(this.n);
    this.sumWL = new Float64Array(this.n);
    this.emitted = new Uint8Array(this.n);
    this.inStack = new Uint8Array(this.n);
    this.rng = mulberry32(o.seed);
    this.init();
  }

  idx(x: number, y: number, z: number) {
    return x + this.o.sx * (z + this.o.sz * y);
  }
  coords(i: number): [number, number, number] {
    const x = i % this.o.sx;
    const z = Math.floor(i / this.o.sx) % this.o.sz;
    const y = Math.floor(i / (this.o.sx * this.o.sz));
    return [x, y, z];
  }
  world(i: number): [number, number, number] {
    const [x, y, z] = this.coords(i);
    return [x + (this.o.ox ?? 0), y, z + (this.o.oz ?? 0)];
  }

  private init() {
    const { sx, sy, sz } = this.o;
    const W = WORDS;
    for (let i = 0; i < this.n; i++) {
      const [x, y, z] = this.coords(i);
      for (const v of VARIANTS) {
        // the grid floor counts as 'ground'; higher cells get it from a terrace below
        if (y === 0 && v.bottomKey !== 'ground') continue;
        if (y === sy - 1 && v.topKey !== 'air') continue;
        if (this.o.borderOpen) {
          if (x === sx - 1 && !socketsFit(v.sides[0], 'o')) continue;
          if (z === 0 && !socketsFit(v.sides[1], 'o')) continue;
          if (x === 0 && !socketsFit(v.sides[2], 'o')) continue;
          if (z === sz - 1 && !socketsFit(v.sides[3], 'o')) continue;
        }
        this.dom[i * W + (v.index >> 5)] |= 1 << (v.index & 31);
      }

      // constraints from decided cells just outside the grid
      if (this.o.external) {
        const [wx, wy, wz] = this.world(i);
        for (let d = 0; d < 6; d++) {
          const [dx, dy, dz] = DIRS[d];
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx >= 0 && nx < sx && ny >= 0 && ny < sy && nz >= 0 && nz < sz) continue;
          const u = this.o.external(wx + dx, wy + dy, wz + dz);
          if (u === undefined) continue;
          const base = (u * 6 + opposite(d)) * W;
          for (let k = 0; k < W; k++) this.dom[i * W + k] &= COMPAT[base + k];
        }
      }

      const fixed = this.o.fixed?.get(i);
      if (fixed !== undefined) {
        const has = this.dom[i * W + (fixed >> 5)] & (1 << (fixed & 31));
        for (let k = 0; k < W; k++) this.dom[i * W + k] = 0;
        if (has) this.dom[i * W + (fixed >> 5)] = 1 << (fixed & 31);
      }
      this.recount(i);
      if (this.count[i] === 0) this.contradiction = true;
    }
    for (let i = 0; i < this.n; i++) this.push(i);
    if (!this.propagate()) this.contradiction = true;
  }

  private recount(i: number) {
    let c = 0, s = 0, sl = 0;
    this.forEach(i, (v) => {
      const w = VARIANTS[v].weight;
      c++;
      s += w;
      sl += w * Math.log(w);
    });
    this.count[i] = c;
    this.sumW[i] = s;
    this.sumWL[i] = sl;
    if (c === 1 && !this.emitted[i]) this.fresh.push(i);
  }

  forEach(i: number, fn: (v: number) => void) {
    for (let k = 0; k < WORDS; k++) {
      let bits = this.dom[i * WORDS + k];
      while (bits) {
        const t = bits & -bits;
        fn(k * 32 + 31 - Math.clz32(t));
        bits ^= t;
      }
    }
  }

  private push(i: number) {
    if (!this.inStack[i]) {
      this.inStack[i] = 1;
      this.stack.push(i);
    }
  }

  private propagate(): boolean {
    const { sx, sy, sz } = this.o;
    const W = WORDS;
    const allowed = this.allowed6;
    const dom = this.dom;
    while (this.stack.length) {
      const c = this.stack.pop()!;
      this.inStack[c] = 0;
      const x = c % sx, z = Math.floor(c / sx) % sz, y = Math.floor(c / (sx * sz));
      // union of what c's remaining variants allow, for all 6 directions in one pass
      allowed.fill(0);
      for (let k = 0; k < W; k++) {
        let bits = dom[c * W + k];
        while (bits) {
          const t = bits & -bits;
          const v = k * 32 + 31 - Math.clz32(t);
          bits ^= t;
          const base = v * 6 * W;
          for (let j = 0; j < 6 * W; j++) allowed[j] |= COMPAT[base + j];
        }
      }
      for (let d = 0; d < 6; d++) {
        const [dx, dy, dz] = DIRS[d];
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || nx >= sx || ny < 0 || ny >= sy || nz < 0 || nz >= sz) continue;
        const n = nx + sx * (nz + sz * ny);
        let changed = false;
        for (let k = 0; k < W; k++) {
          const old = dom[n * W + k];
          const nv = (old & allowed[d * W + k]) >>> 0;
          if (nv !== old) {
            dom[n * W + k] = nv;
            changed = true;
          }
        }
        if (changed) {
          this.recount(n);
          if (this.count[n] === 0) return false;
          this.push(n);
        }
      }
    }
    return true;
  }

  private pickCell(): number {
    let best = -1;
    let bestE = Infinity;
    for (let i = 0; i < this.n; i++) {
      if (this.count[i] <= 1) continue;
      const s = this.sumW[i];
      // bottom-up: the ground layer decides the layout, upper floors follow
      const y = Math.floor(i / (this.o.sx * this.o.sz));
      const e = y * 100 + Math.log(s) - this.sumWL[i] / s + this.rng() * 1e-4;
      if (e < bestE) {
        bestE = e;
        best = i;
      }
    }
    return best;
  }

  private pickVariant(i: number): number {
    const [x, y, z] = this.coords(i);
    const options: number[] = [];
    const weights: number[] = [];
    let total = 0;
    let groupSize = -1; // lazily computed size of the neighbouring structure
    this.forEach(i, (vi) => {
      const v = VARIANTS[vi];
      let w = v.weight;
      const m = v.module;
      if (m.solitary && this.nearSame(x, y, z, m.id)) w *= 1e-4;
      if (m.softCap && m.group) {
        if (groupSize < 0) groupSize = this.componentSize(x, y, z, m.group);
        let open = 0;
        for (let d = 0; d < 4; d++) {
          if (!JOIN_SOCKETS.has(v.sides[d])) continue;
          const [dx, , dz] = DIRS[d];
          const nx = x + dx, nz = z + dz;
          if (nx >= 0 && nx < this.o.sx && nz >= 0 && nz < this.o.sz && this.count[this.idx(nx, y, nz)] > 1) open++;
        }
        w *= Math.pow(m.softCap / (m.softCap + groupSize), open);
      }
      if (m.affinity && m.group) {
        let same = 0;
        for (let d = 0; d < 4; d++) {
          const [dx, , dz] = DIRS[d];
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx >= this.o.sx || nz < 0 || nz >= this.o.sz) continue;
          const n = this.idx(nx, y, nz);
          if (this.count[n] !== 1) continue;
          let nvi = -1;
          this.forEach(n, (q) => (nvi = q));
          if (VARIANTS[nvi].module.group === m.group) same++;
        }
        w *= 1 + m.affinity * same;
      }
      options.push(vi);
      weights.push(w);
      total += w;
    });
    let r = this.rng() * total;
    for (let k = 0; k < options.length; k++) {
      r -= weights[k];
      if (r <= 0) return options[k];
    }
    return options[options.length - 1];
  }

  /** Is a decided copy of this module among the 8 horizontal neighbours? */
  private nearSame(x: number, y: number, z: number, id: string): boolean {
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        let vi: number | undefined;
        if (nx < 0 || nx >= this.o.sx || nz < 0 || nz >= this.o.sz) {
          // across a chunk border: ask the already-solved neighbour
          vi = this.o.external?.(nx + (this.o.ox ?? 0), y, nz + (this.o.oz ?? 0));
        } else vi = this.decidedVariant(this.idx(nx, y, nz));
        if (vi !== undefined && vi >= 0 && VARIANTS[vi].module.id === id) return true;
      }
    return false;
  }

  private decidedVariant(n: number): number {
    let vi = -1;
    if (this.count[n] === 1) this.forEach(n, (q) => (vi = q));
    return vi;
  }

  /** Cells in the decided same-group structures touching (x, y, z), capped. */
  private componentSize(x: number, y: number, z: number, group: string): number {
    const seen = new Set<number>();
    const stack: number[] = [];
    const visit = (cx: number, cz: number) => {
      if (cx < 0 || cx >= this.o.sx || cz < 0 || cz >= this.o.sz) return;
      const n = this.idx(cx, y, cz);
      if (seen.has(n)) return;
      const vi = this.decidedVariant(n);
      if (vi < 0 || VARIANTS[vi].module.group !== group) return;
      seen.add(n);
      stack.push(n);
    };
    for (let d = 0; d < 4; d++) visit(x + DIRS[d][0], z + DIRS[d][2]);
    while (stack.length && seen.size < 600) {
      const [cx, , cz] = this.coords(stack.pop()!);
      for (let d = 0; d < 4; d++) visit(cx + DIRS[d][0], cz + DIRS[d][2]);
    }
    return seen.size;
  }

  private drainFresh(out: Collapse[]) {
    for (const i of this.fresh) {
      if (this.emitted[i] || this.count[i] !== 1) continue;
      this.emitted[i] = 1;
      let variant = -1;
      this.forEach(i, (q) => (variant = q));
      const [x, y, z] = this.world(i);
      out.push({ x, y, z, variant });
    }
    this.fresh.length = 0;
  }

  /**
   * Collapse one cell (plus whatever propagation decides).
   * Returns newly decided cells, or null on contradiction. Empty array = done.
   */
  step(): Collapse[] | null {
    const out: Collapse[] = [];
    if (this.contradiction) return null;
    this.drainFresh(out);
    if (out.length) return out;
    const i = this.pickCell();
    if (i < 0) return out;
    const v = this.pickVariant(i);
    for (let k = 0; k < WORDS; k++) this.dom[i * WORDS + k] = 0;
    this.dom[i * WORDS + (v >> 5)] = 1 << (v & 31);
    this.recount(i);
    this.push(i);
    if (!this.propagate()) {
      this.contradiction = true;
      return null;
    }
    this.drainFresh(out);
    return out;
  }

  get done() {
    for (let i = 0; i < this.n; i++) if (this.count[i] !== 1) return false;
    return true;
  }

  /** Run to completion. */
  solve(): Collapse[] | null {
    const all: Collapse[] = [];
    for (;;) {
      const r = this.step();
      if (r === null) return null;
      if (r.length === 0) return all;
      all.push(...r);
    }
  }
}

/** Solve with restarts on contradiction. */
export function solveWithRetries(o: SolveOptions, tries = 30): { cells: Collapse[]; tries: number } | null {
  for (let t = 0; t < tries; t++) {
    const s = new WFCSolver({ ...o, seed: o.seed + t * 7919 });
    if (s.contradiction && t === 0 && o.fixed?.size) {
      // fixed cells conflict with each other: retries cannot help
      return null;
    }
    const cells = s.solve();
    if (cells) return { cells, tries: t + 1 };
  }
  return null;
}

export { NV, UP };
