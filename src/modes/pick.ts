import * as THREE from 'three';
import { CELL_H, CELL_W } from '../config';

export interface Pick {
  /** occupied cell under the cursor, if any */
  hit?: [number, number, number];
  /** empty cell a new module would go into */
  target: [number, number, number];
}

/**
 * A pick volume of an occupied cell: a box, or (with `mesh`) the module's real surface, where the
 * box is only the broad phase. Boxes around buildings with tall roofs reach above their walls, so
 * aiming at a wall from above would enter the box through its top and target the cell on the roof.
 */
export interface PickShape {
  box: THREE.Box3;
  mesh?: THREE.Mesh;
}

/** World-space pick volumes of an occupied cell (empty array or null if the cell is empty). */
export type PickBox = (x: number, y: number, z: number) => PickShape[] | null;

const GROUND_Y = -1;
const MAX_LEVEL = 14;
const _hit = new THREE.Vector3();
const _rc = new THREE.Raycaster();
const _hits: THREE.Intersection[] = [];

/** Nearest hit on a mesh's surface, with the normal facing the viewer. */
function surfaceHit(ray: THREE.Ray, mesh: THREE.Mesh) {
  _rc.ray.copy(ray);
  _hits.length = 0;
  mesh.updateMatrixWorld();
  mesh.raycast(_rc, _hits);
  let best: THREE.Intersection | null = null;
  for (const h of _hits) if (h.face && (!best || h.distance < best.distance)) best = h;
  if (!best) return null;
  const n = best.face!.normal.clone().transformDirection(mesh.matrixWorld);
  if (n.dot(ray.direction) > 0) n.negate();
  return { d: best.distance, n, y: best.point.y };
}

/**
 * Neighbour the surface faces: the floor above for flat faces near the top of the module, else
 * the side the face (or, for ledges and sills partway up a wall, the viewer) looks toward.
 */
function normalTarget(n: THREE.Vector3, hy: number, dir: THREE.Vector3, [x, y, z]: [number, number, number]): [number, number, number] {
  const up = (hy - y * CELL_H) / CELL_H;
  if (n.y > 0.65 && up > 0.6) return [x, y + 1, z];
  if (n.y < -0.65 && up < 0.3 && y > 0) return [x, y - 1, z];
  // flat ledges low on a wall carry no side of their own: take the one facing the viewer
  const h = Math.abs(n.y) > 0.65 ? _side.set(-dir.x, 0, -dir.z) : _side.set(n.x, 0, n.z);
  return Math.abs(h.x) > Math.abs(h.z) ? [x + Math.sign(h.x), y, z] : [x, y, z + Math.sign(h.z)];
}
const _side = new THREE.Vector3();

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
      const hit: [number, number, number] = [ix, cy, iz];
      let best: { target: [number, number, number]; d: number } | null = null;
      for (const s of pickBox(ix, cy, iz) ?? []) {
        if (!ray.intersectBox(s.box, _hit)) continue;
        if (s.mesh) {
          const h = surfaceHit(ray, s.mesh);
          if (h) {
            if (!best || h.d < best.d) best = { target: normalTarget(h.n, h.y, d, hit), d: h.d };
          } else if (_hit.y < s.box.max.y - 1e-3 && _hit.y - cy * CELL_H < CELL_H * 0.6) {
            // in through a doorway, an arch or a hall's open end: that side, not the floor inside
            const dist = _hit.distanceTo(o);
            if (!best || dist < best.d) best = { target: sideTarget(s.box, _hit, hit), d: dist };
          }
          continue;
        }
        const dist = _hit.distanceTo(o);
        if (!best || dist < best.d) best = { target: faceTarget(s.box, _hit, hit), d: dist };
      }
      if (best) return { hit, target: best.target };
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

/** Neighbour across the box's side face closest to the hit point. */
function sideTarget(box: THREE.Box3, p: THREE.Vector3, [x, y, z]: [number, number, number]): [number, number, number] {
  const faces: [number, [number, number, number]][] = [
    [Math.abs(p.x - box.max.x), [x + 1, y, z]],
    [Math.abs(p.x - box.min.x), [x - 1, y, z]],
    [Math.abs(p.z - box.max.z), [x, y, z + 1]],
    [Math.abs(p.z - box.min.z), [x, y, z - 1]],
  ];
  faces.sort((a, b) => a[0] - b[0]);
  return faces[0][1];
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
