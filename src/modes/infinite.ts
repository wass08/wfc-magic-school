import * as THREE from 'three';
import { CELL_W, cellKey } from '../config';
import { World } from '../render/world';
import { ChunkJob, ChunkResult, KNOWN_REACH } from '../wfc/chunkSolve';

export const CHUNK = 8;
const HEIGHT = 5;

interface Chunk {
  cx: number;
  cz: number;
  shown: boolean;
  /** waiting in `ready` to be revealed */
  queued?: boolean;
}

/**
 * Endless castle: chunks are solved on demand around the camera target, each
 * one constrained by the already-solved cells of its neighbours.
 *
 * When a chunk can't be completed against its neighbours, the solve region is
 * widened into them ("modifying in blocks"): a margin of already-solved cells
 * is re-solved together with the new chunk, so the seam can resolve instead of
 * being cut. Far chunks are hidden but kept, so revisiting is stable (and they grow back in with
 * the same reveal as the first time).
 */
export class InfiniteWorld {
  private chunks = new Map<string, Chunk>();
  private store = new Map<string, number>();
  /** chunk solves run in a worker; one at a time, so each sees its neighbours' final cells */
  private worker = new Worker(new URL('../wfc/chunkWorker.ts', import.meta.url), { type: 'module' });
  private jobId = 0;
  private inFlight = 0;
  /** solved or revisited chunks waiting to be revealed (one per frame) */
  private ready: Chunk[] = [];
  radius = 4;
  seed = 1;
  active = false;
  onStatus: (msg: string) => void = () => {};
  /** Duration of the last chunk solve (ms). */
  lastMs = 0;

  /** Chunks currently shown around the target. */
  get awake() {
    let n = 0;
    for (const c of this.chunks.values()) if (c.shown) n++;
    return n;
  }

  constructor(private world: World, private now: () => number) {
    this.worker.onmessage = (e: MessageEvent<ChunkResult>) => this.receive(e.data);
  }

  start(seed: number) {
    this.seed = seed;
    this.chunks.clear();
    this.store.clear();
    this.world.clear();
    this.inFlight = 0;
    this.ready = [];
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  private chunkOf(x: number, z: number) {
    return this.chunks.get(`${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`);
  }

  /** Hand the chunk to the solver worker with the decided cells it may lean on. */
  private request(cx: number, cz: number) {
    const known: number[] = [];
    const R = KNOWN_REACH;
    for (let y = 0; y < HEIGHT; y++)
      for (let z = cz * CHUNK - R; z < (cz + 1) * CHUNK + R; z++)
        for (let x = cx * CHUNK - R; x < (cx + 1) * CHUNK + R; x++) {
          const v = this.store.get(cellKey(x, y, z));
          if (v !== undefined) known.push(x, y, z, v);
        }
    const has = (dx: number, dz: number) => this.chunks.has(`${cx + dx},${cz + dz}`);
    const job: ChunkJob = {
      id: ++this.jobId,
      cx, cz,
      chunk: CHUNK,
      height: HEIGHT,
      worldSeed: this.seed,
      has: [has(-1, 0), has(1, 0), has(0, -1), has(0, 1)],
      known: new Int32Array(known),
    };
    this.inFlight = job.id;
    this.worker.postMessage(job, [job.known.buffer]);
  }

  /** A solved chunk is back: store it, and update repaired margins of visible neighbours. */
  private receive(r: ChunkResult) {
    if (r.id !== this.inFlight) return; // from a world that was replaced meanwhile
    this.inFlight = 0;
    if (!this.active) return;
    const chunk: Chunk = { cx: r.cx, cz: r.cz, shown: false };
    this.chunks.set(`${r.cx},${r.cz}`, chunk);
    const now = this.now();
    for (let i = 0; i < r.cells.length; i += 4) {
      const x = r.cells[i], y = r.cells[i + 1], z = r.cells[i + 2], variant = r.cells[i + 3];
      const owner = this.chunkOf(x, z);
      if (!owner) continue; // corner of an unsolved diagonal chunk: leave it free
      const key = cellKey(x, y, z);
      if (this.store.get(key) === variant) continue;
      this.store.set(key, variant);
      // repaired margin cells of visible neighbours update in place
      if (owner !== chunk && owner.shown) this.world.set(x, y, z, variant, now);
    }
    const extra = r.attempts ? ` (${r.attempts} restarts${r.margin ? `, repaired ${r.margin}-cell margin` : ''})` : '';
    this.lastMs = r.ms;
    this.onStatus(`${this.chunks.size} chunks · last solved in ${r.ms.toFixed(0)} ms${extra}`);
    chunk.queued = true;
    this.ready.push(chunk);
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
        // coming back to a hidden chunk: queue it for the same animated reveal as a new one
        if (c && !c.shown && !c.queued) {
          c.queued = true;
          this.ready.push(c);
        }
        if (!c && d < bestD) {
          bestD = d;
          best = [ccx + dx, ccz + dz];
        }
      }
    if (!this.inFlight && best) this.request(best[0], best[1]);
    // reveal one chunk per frame (each reveal re-packs the instance buffers), nearest first;
    // ones the camera has already left again are dropped from the queue
    const far = (c: Chunk) => (c.cx - ccx) ** 2 + (c.cz - ccz) ** 2;
    this.ready = this.ready.filter((c) => {
      if (far(c) <= (r + 1.5) * (r + 1.5)) return true;
      c.queued = false;
      return false;
    });
    if (this.ready.length > 1) this.ready.sort((a, b) => far(a) - far(b));
    const c = this.ready.shift();
    if (c) {
      c.queued = false;
      this.show(c, true);
    }

    for (const c of this.chunks.values()) {
      if (!c.shown) continue;
      const dx = c.cx - ccx, dz = c.cz - ccz;
      if (dx * dx + dz * dz > (r + 1.5) * (r + 1.5)) this.hide(c);
    }
  }
}
