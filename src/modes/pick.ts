import * as THREE from 'three';
import { CELL_H, CELL_W } from '../config';

export interface Pick {
  /** occupied cell under the cursor, if any */
  hit?: [number, number, number];
  /** empty cell a new module would go into */
  target: [number, number, number];
}

/** World-space pick boxes of an occupied cell (empty array or null if the cell is empty). */
export type PickBox = (x: number, y: number, z: number) => THREE.Box3[] | null;

const GROUND_Y = -1;
const MAX_LEVEL = 14;
const _hit = new THREE.Vector3();

/**
 * Voxel DDA (Amanatides & Woo) through the cell grid. Each visited cell is
 * tested against the module's own bounding box (not the whole cell), so you
 * can aim past a slim tower or wall at the ground behind it. The face that
 * was hit decides where the new module goes.
 */
export function pickCell(ray: THREE.Ray, pickBox: PickBox): Pick | null {
  const o = ray.origin, d = ray.direction;
  const tGround = d.y < 0 ? (GROUND_Y - o.y) / d.y : Infinity;

  // grid space: cell i spans [i, i+1); ground tiles reach down into iy = -1
  const g = new THREE.Vector3(o.x / CELL_W + 0.5, o.y / CELL_H, o.z / CELL_W + 0.5);
  const gd = new THREE.Vector3(d.x / CELL_W, d.y / CELL_H, d.z / CELL_W);
  let t0 = 0;
  if (g.y > MAX_LEVEL && gd.y < 0) t0 = (MAX_LEVEL - g.y) / gd.y;
  const p = g.clone().addScaledVector(gd, t0);
  let ix = Math.floor(p.x), iy = Math.floor(p.y), iz = Math.floor(p.z);
  const sx = Math.sign(gd.x), sy = Math.sign(gd.y), sz = Math.sign(gd.z);
  const next = (pi: number, i: number, s: number, di: number) => (s === 0 ? Infinity : ((s > 0 ? i + 1 : i) - pi) / di);
  let tx = t0 + next(p.x, ix, sx, gd.x);
  let ty = t0 + next(p.y, iy, sy, gd.y);
  let tz = t0 + next(p.z, iz, sz, gd.z);
  const dx = sx === 0 ? Infinity : Math.abs(1 / gd.x);
  const dy = sy === 0 ? Infinity : Math.abs(1 / gd.y);
  const dz = sz === 0 ? Infinity : Math.abs(1 / gd.z);

  for (let i = 0; i < 800; i++) {
    if (iy >= -1 && iy <= MAX_LEVEL) {
      const cy = Math.max(iy, 0);
      let best: { box: THREE.Box3; p: THREE.Vector3; d: number } | null = null;
      for (const box of pickBox(ix, cy, iz) ?? []) {
        if (!ray.intersectBox(box, _hit)) continue;
        const dist = _hit.distanceTo(o);
        if (!best || dist < best.d) best = { box, p: _hit.clone(), d: dist };
      }
      if (best) {
        const hit: [number, number, number] = [ix, cy, iz];
        return { hit, target: faceTarget(best.box, best.p, hit) };
      }
    }
    if (iy < -1) break;
    if (iy > MAX_LEVEL && sy >= 0) return null;
    const tMin = Math.min(tx, ty, tz);
    if (tMin > tGround) break;
    if (tx === tMin) {
      ix += sx;
      tx += dx;
    } else if (ty === tMin) {
      iy += sy;
      ty += dy;
    } else {
      iz += sz;
      tz += dz;
    }
  }
  if (tGround === Infinity) return null;
  const hp = o.clone().addScaledVector(d, tGround);
  const target: [number, number, number] = [Math.round(hp.x / CELL_W), 0, Math.round(hp.z / CELL_W)];
  // ground under an occupied cell (e.g. the corner of a round tower's cell)
  if (pickBox(...target)?.length) return null;
  return { target };
}

/** Neighbour across the box face closest to the hit point. */
function faceTarget(box: THREE.Box3, p: THREE.Vector3, [x, y, z]: [number, number, number]): [number, number, number] {
  const faces: [number, [number, number, number]][] = [
    [Math.abs(p.y - box.max.y), [x, y + 1, z]],
    [Math.abs(p.x - box.max.x), [x + 1, y, z]],
    [Math.abs(p.x - box.min.x), [x - 1, y, z]],
    [Math.abs(p.z - box.max.z), [x, y, z + 1]],
    [Math.abs(p.z - box.min.z), [x, y, z - 1]],
  ];
  // bottom faces only make sense above the ground floor
  if (y > 0) faces.push([Math.abs(p.y - box.min.y), [x, y - 1, z]]);
  faces.sort((a, b) => a[0] - b[0]);
  return faces[0][1];
}
