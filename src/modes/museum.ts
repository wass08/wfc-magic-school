import * as THREE from 'three';
import { CELL_H, CELL_W } from '../config';
import { Stage } from '../render/stage';
import { World } from '../render/world';
import { ModuleDef } from '../wfc/modules';
import { VARIANTS, Variant } from '../wfc/variants';

export interface Exhibit {
  module: ModuleDef;
  /** world-space centre of the exhibit's plot */
  wx: number;
  wz: number;
  /** level of the exhibited module (its support stack sits below) */
  y: number;
}

const COLUMNS = 8;
/** Logical cells between exhibits: far enough that neighbours never touch (canal banks, doors). */
const LOGICAL_STEP = 4;
const WET = new Set(['canalBridge', 'coveredBridge']);

/** Cheapest stack of variants that can carry `v`, bottom first (empty for ground modules). */
function supportChain(v: Variant): Variant[] {
  const chain: Variant[] = [];
  let key = v.bottomKey;
  let cur = v;
  for (let depth = 0; depth < 6 && cur.module.level !== 'ground'; depth++) {
    const options = VARIANTS.filter((c) => c.topKey === key && c.module.id !== 'air');
    if (!options.length) break;
    // stay in the family, prefer reaching the ground, then the most common piece
    options.sort(
      (a, b) =>
        Number(b.module.category === v.module.category) - Number(a.module.category === v.module.category) ||
        Number(b.module.level === 'ground') - Number(a.module.level === 'ground') ||
        b.weight - a.weight,
    );
    cur = options[0];
    chain.unshift(cur);
    key = cur.bottomKey;
  }
  return chain;
}

/**
 * The module museum: every module on its own plot of a starry grid, with the
 * camera gliding from exhibit to exhibit.
 */
export class Museum {
  exhibits: Exhibit[] = [];
  /** gap between plots, in cells (half steps allowed: plots are offset off the cell grid) */
  spacing = 1;
  private glide: { fromT: THREE.Vector3; fromP: THREE.Vector3; toT: THREE.Vector3; toP: THREE.Vector3; k: number; dur: number } | null = null;

  constructor(private stage: Stage, private world: World) {}

  /** Lay `modules` out in a grid (clears the world). */
  layout(modules: ModuleDef[]) {
    this.world.clear();
    const cols = Math.min(COLUMNS, Math.max(1, Math.ceil(Math.sqrt(modules.length * 1.6))));
    const rows = Math.ceil(modules.length / cols);
    const pitch = (1 + this.spacing) * CELL_W;
    const now = this.stage.now();
    this.exhibits = modules.map((module, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const lx = col * LOGICAL_STEP;
      const lz = row * LOGICAL_STEP;
      const wx = (col - (cols - 1) / 2) * pitch;
      const wz = (row - (rows - 1) / 2) * pitch;
      const offset = { x: wx - lx * CELL_W, z: wz - lz * CELL_W };
      const v = VARIANTS.find((c) => c.module === module && c.rot === module.rotations[0])!;
      const stack = [...supportChain(v), v];
      const spawn = now + i * 0.025;
      stack.forEach((s, y) => this.world.set(lx, y, lz, s.index, spawn + y * 0.12, offset));
      // bridges get their canal, when there is room for it between the plots
      if (WET.has(module.id) && this.spacing >= 1) {
        const water = VARIANTS.find((c) => c.module.id === 'water' && c.rot === 0)!;
        this.world.set(lx, 0, lz - 1, water.index, spawn, offset);
        this.world.set(lx, 0, lz + 1, water.index, spawn, offset);
      }
      return { module, wx, wz, y: stack.length - 1 };
    });
  }

  /** World-space anchor above an exhibit (for name tags). */
  anchor(e: Exhibit, out = new THREE.Vector3()) {
    return out.set(e.wx, (e.y + 1) * CELL_H + 0.6, e.wz);
  }

  /** Current viewing direction (target → camera), kept above `minY`. */
  private viewDir(minY: number) {
    const dir = this.stage.camera.position.clone().sub(this.stage.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0.9, 1);
    dir.normalize();
    dir.y = Math.max(dir.y, minY);
    return dir.normalize();
  }

  private glideTo(toT: THREE.Vector3, toP: THREE.Vector3, instant: boolean, dur = 0.7) {
    if (instant) {
      this.stage.controls.target.copy(toT);
      this.stage.camera.position.copy(toP);
      this.glide = null;
      return;
    }
    this.glide = { fromT: this.stage.controls.target.clone(), fromP: this.stage.camera.position.clone(), toT, toP, k: 0, dur };
  }

  /** Glide the camera to an exhibit, keeping the current viewing angle. */
  focus(e: Exhibit, instant = false) {
    const toT = new THREE.Vector3(e.wx, (e.y + 0.5) * CELL_H * 0.6, e.wz);
    const toP = toT.clone().addScaledVector(this.viewDir(0.45), 20 + e.y * 5);
    this.glideTo(toT, toP, instant);
  }

  /**
   * Pull back until every exhibit on show fits the view (no exhibit selected).
   * `leftInset` (px) is screen covered by the side panel: the grid is framed in what's left.
   */
  overview(instant = false, leftInset = 0) {
    if (!this.exhibits.length) return;
    const box = new THREE.Box3();
    for (const e of this.exhibits) box.union(this.boxOf(e));
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = 0.5 * Math.hypot(size.x, size.z, size.y * 0.5) + CELL_W * 0.5;
    const cam = this.stage.camera;
    const w = this.stage.renderer.domElement.clientWidth || 1;
    const free = Math.max(0.35, 1 - leftInset / w);
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect * free);
    const dist = Math.min(radius / Math.sin(Math.min(vfov, hfov) / 2), this.stage.controls.maxDistance * 0.95);
    const dir = this.viewDir(0.62);
    const toT = new THREE.Vector3(centre.x, CELL_H * 0.4, centre.z);
    // slide the orbit centre left so the grid sits in the middle of the uncovered area
    const viewW = 2 * dist * Math.tan(vfov / 2) * cam.aspect;
    const right = new THREE.Vector3(0, 1, 0).cross(dir).normalize(); // camera's screen-right
    toT.addScaledVector(right, -((leftInset / w) * viewW) / 2);
    const toP = toT.clone().addScaledVector(dir, dist);
    this.glideTo(toT, toP, instant, 1);
  }

  /** Box around an exhibit's plot and its stack. */
  boxOf(e: Exhibit, out = new THREE.Box3()) {
    const h = CELL_W * 0.5;
    out.min.set(e.wx - h, -1, e.wz - h);
    out.max.set(e.wx + h, (e.y + 1) * CELL_H, e.wz + h);
    return out;
  }

  /** Index of the exhibit a ray hits first, or -1. */
  pick(ray: THREE.Ray) {
    let best = -1;
    let bestD = Infinity;
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    this.exhibits.forEach((e, i) => {
      if (!ray.intersectBox(this.boxOf(e, box), hit)) return;
      const d = hit.distanceToSquared(ray.origin);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  set turntable(on: boolean) {
    this.stage.controls.autoRotate = on;
    this.stage.controls.autoRotateSpeed = 1.6;
  }

  leave() {
    this.glide = null;
    this.turntable = false;
  }

  update(dt: number) {
    const g = this.glide;
    if (!g) return;
    g.k = Math.min(1, g.k + dt / g.dur);
    const e = 1 - (1 - g.k) ** 3;
    this.stage.controls.target.lerpVectors(g.fromT, g.toT, e);
    this.stage.camera.position.lerpVectors(g.fromP, g.toP, e);
    if (g.k >= 1) this.glide = null;
  }
}
