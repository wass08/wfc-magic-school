import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { CELL_H, CELL_W } from '../config';
import { moduleGeometry } from '../geo';
import { World } from '../render/world';
import { AIR_INDEX, VARIANTS } from '../wfc/variants';

/**
 * Collision against the castle's real surfaces. One BVH per module style, built lazily in the
 * module's own frame; a query visits only the cells around it and works in each cell's frame
 * (instances are just a translation plus quarter turns), so nothing scales with the world size.
 */
const bvhs = new Map<string, MeshBVH | null>();

function bvhOf(id: string, style: number): MeshBVH | null {
  const key = `${id}:${style}`;
  let b = bvhs.get(key);
  if (b === undefined) {
    const src = moduleGeometry(id, style).castle;
    if (src) {
      // positions only, on a wrapper: the BVH writes its own index and must not touch the render geometry
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', src.getAttribute('position'));
      b = new MeshBVH(geo);
    } else b = null;
    bvhs.set(key, b);
  }
  return b;
}

interface CellFrame {
  bvh: MeshBVH;
  ox: number;
  oy: number;
  oz: number;
  cos: number;
  sin: number;
}

const _p = new THREE.Vector3();
const _hit = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
const _ray = new THREE.Ray();

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
/** Outward normal of a BVH triangle, in the module's frame. */
function faceNormal(bvh: MeshBVH, face: number, out: THREE.Vector3) {
  const geo = bvh.geometry;
  const idx = geo.index!;
  const pos = geo.getAttribute('position');
  _a.fromBufferAttribute(pos, idx.getX(face * 3));
  _b.fromBufferAttribute(pos, idx.getX(face * 3 + 1));
  _c.fromBufferAttribute(pos, idx.getX(face * 3 + 2));
  return out.subVectors(_c, _b).cross(_a.sub(_b)).normalize();
}

export class Collider {
  constructor(private world: World) {}

  /** Cells whose module may reach into the box [min, max] (modules overhang their cell a little). */
  private cells(min: THREE.Vector3, max: THREE.Vector3, out: CellFrame[]) {
    out.length = 0;
    const x0 = Math.round(min.x / CELL_W) - 1, x1 = Math.round(max.x / CELL_W) + 1;
    const z0 = Math.round(min.z / CELL_W) - 1, z1 = Math.round(max.z / CELL_W) + 1;
    const y0 = Math.max(0, Math.floor(min.y / CELL_H) - 1), y1 = Math.max(0, Math.floor(max.y / CELL_H));
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const c = this.world.get(x, y, z);
          if (!c || c.v === AIR_INDEX) continue;
          const v = VARIANTS[c.v];
          const bvh = bvhOf(v.module.id, c.style);
          if (!bvh) continue;
          const a = (((v.rot + c.vrot) % 4) * Math.PI) / 2;
          out.push({ bvh, ox: x * CELL_W + c.ox, oy: y * CELL_H, oz: z * CELL_W + c.oz, cos: Math.cos(a), sin: Math.sin(a) });
        }
    return out;
  }

  // world <-> cell frame: the instance turns its geometry by +a about y (three.js convention)
  private toLocal(f: CellFrame, p: THREE.Vector3, out: THREE.Vector3) {
    const x = p.x - f.ox, z = p.z - f.oz;
    return out.set(x * f.cos - z * f.sin, p.y - f.oy, x * f.sin + z * f.cos);
  }
  private toWorldDir(f: CellFrame, d: THREE.Vector3, out: THREE.Vector3) {
    return out.set(d.x * f.cos + d.z * f.sin, d.y, -d.x * f.sin + d.z * f.cos);
  }
  private toLocalDir(f: CellFrame, d: THREE.Vector3, out: THREE.Vector3) {
    return out.set(d.x * f.cos - d.z * f.sin, d.y, d.x * f.sin + d.z * f.cos);
  }

  private frames: CellFrame[] = [];
  private push = new THREE.Vector3();
  private lp = new THREE.Vector3();
  private fn = new THREE.Vector3();

  /**
   * Push a sphere out of the castle (in place). Returns the total push-out, zero when free;
   * a few relaxation passes let it slide along walls and settle into corners.
   */
  resolveSphere(center: THREE.Vector3, r: number): THREE.Vector3 {
    const total = new THREE.Vector3();
    const min = _p.copy(center).subScalar(r);
    const max = new THREE.Vector3().copy(center).addScalar(r);
    const frames = this.cells(min, max, this.frames);
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const f of frames) {
        this.toLocal(f, center, this.lp);
        const hit = f.bvh.closestPointToPoint(this.lp, _hit, 0, r);
        if (!hit || hit.distance >= r) continue;
        // out of the surface on its outer side: from in front, away from the closest point; from
        // behind (the centre already inside a wall), back through it along the face normal
        const n = faceNormal(f.bvh, hit.faceIndex, this.fn);
        const d = this.lp.clone().sub(hit.point);
        const len = d.length();
        let depth: number;
        if (len > 1e-5 && d.dot(n) > 0) {
          d.divideScalar(len);
          depth = r - hit.distance;
        } else {
          d.copy(n);
          depth = r + hit.distance;
        }
        this.toWorldDir(f, d, this.push).multiplyScalar(depth + 1e-3);
        center.add(this.push);
        total.add(this.push);
        moved = true;
      }
      if (!moved) break;
    }
    return total;
  }

  /** Distance along a segment to the first castle surface (or `len` when clear). */
  castRay(origin: THREE.Vector3, dir: THREE.Vector3, len: number): number {
    const end = new THREE.Vector3().copy(origin).addScaledVector(dir, len);
    const min = new THREE.Vector3().copy(origin).min(end);
    const max = new THREE.Vector3().copy(origin).max(end);
    let best = len;
    for (const f of this.cells(min, max, this.frames)) {
      this.toLocal(f, origin, _ray.origin);
      this.toLocalDir(f, dir, _ray.direction);
      const hit = f.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, best);
      if (hit && hit.distance < best) best = hit.distance;
    }
    return best;
  }
}
