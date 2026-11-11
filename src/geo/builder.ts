import * as THREE from 'three';

/** Material ids, read by the castle shader to pick a procedural surface pattern. */
export const MAT = {
  plain: 0,
  stone: 1,
  roof: 2,
  wood: 3,
  gold: 4,
  foliage: 5,
  glass: 6,
  cloth: 7,
  paving: 8,
  grass: 9,
  magic: 10,
  iron: 11,
  fall: 12,
} as const;

export interface PartStyle {
  color: THREE.ColorRepresentation;
  mat: number;
  /** emissive strength (emissive colour = vertex colour) */
  emi?: number;
  /** 0..1 candle-like flicker */
  flick?: number;
  /** sway amplitude in world units */
  sway?: number;
  /** sway direction in part space (defaults to the vertex normal) */
  swayDir?: THREE.Vector3;
  /** banner mode: sway weight grows from swayTop down over swayLen (module space) */
  swayTop?: number;
  swayLen?: number;
  /** flag mode: sway weight grows with distance from this point (module space) */
  swayOrigin?: THREE.Vector3;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

export function mat4(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

/**
 * Accumulates transformed primitives into one flat, non-indexed geometry with
 * the custom attributes the castle material understands.
 */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private fx: number[] = [];
  private sw: number[] = [];
  private water: THREE.BufferGeometry[] = [];
  /** smoke emitter points (module space) */
  readonly emitters: number[] = [];
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  get matrix() {
    return this.stack[this.stack.length - 1];
  }

  /** Run fn with an extra transform applied to everything it adds. */
  with(m: THREE.Matrix4, fn: () => void) {
    this.stack.push(this.matrix.clone().multiply(m));
    fn();
    this.stack.pop();
  }
  at(x: number, y: number, z: number, ry: number, fn: () => void) {
    this.with(mat4(x, y, z, ry), fn);
  }

  add(geo: THREE.BufferGeometry, local: THREE.Matrix4 | null, s: PartStyle) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _m.copy(this.matrix);
    if (local) _m.multiply(local);
    g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const c = new THREE.Color(s.color);
    const dir = s.swayDir ? s.swayDir.clone().transformDirection(_m) : null;
    const amp = s.sway ?? 0;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      this.pos.push(p.getX(i), y, p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.fx.push(s.emi ?? 0, s.flick ?? 0, s.mat, 0);
      let w = amp;
      if (s.swayTop !== undefined && s.swayLen) w = amp * THREE.MathUtils.clamp((s.swayTop - y) / s.swayLen, 0, 1);
      if (s.swayOrigin && s.swayLen) w = amp * THREE.MathUtils.clamp(_v.set(p.getX(i), y, p.getZ(i)).distanceTo(s.swayOrigin) / s.swayLen, 0, 1);
      if (dir) this.sw.push(dir.x, dir.y, dir.z, w);
      else this.sw.push(n.getX(i), n.getY(i), n.getZ(i), w);
    }
    g.dispose();
  }

  /** Register a chimney-smoke source at (x, y, z) in the current frame. */
  emitter(x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(this.matrix);
    this.emitters.push(p.x, p.y, p.z);
  }

  addWater(geo: THREE.BufferGeometry, local: THREE.Matrix4 | null) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    _m.copy(this.matrix);
    if (local) _m.multiply(local);
    g.applyMatrix4(_m);
    this.water.push(g);
  }

  /** Box centred at (x,y,z). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, s: PartStyle, ry = 0) {
    this.add(boxGeo(w, h, d), mat4(x, y, z, ry), s);
  }
  /** Box resting on y (bottom face at y). */
  block(w: number, h: number, d: number, x: number, y: number, z: number, s: PartStyle, ry = 0) {
    this.box(w, h, d, x, y + h / 2, z, s, ry);
  }
  /** Cylinder resting on y. */
  cyl(rTop: number, rBot: number, h: number, seg: number, x: number, y: number, z: number, s: PartStyle, ry = 0) {
    this.add(cylGeo(rTop, rBot, h, seg), mat4(x, y + h / 2, z, ry), s);
  }
  cone(r: number, h: number, seg: number, x: number, y: number, z: number, s: PartStyle, ry = 0) {
    this.add(cylGeo(0, r, h, seg), mat4(x, y + h / 2, z, ry), s);
  }

  build(): { castle: THREE.BufferGeometry | null; water: THREE.BufferGeometry | null; emitters: number[] } {
    let castle: THREE.BufferGeometry | null = null;
    if (this.pos.length) {
      castle = new THREE.BufferGeometry();
      castle.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      castle.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      castle.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      castle.setAttribute('aFx', new THREE.Float32BufferAttribute(this.fx, 4));
      castle.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sw, 4));
      castle.computeBoundingSphere();
      castle.computeBoundingBox();
    }
    let water: THREE.BufferGeometry | null = null;
    if (this.water.length) {
      water = mergeSimple(this.water);
      this.water.forEach((g) => g.dispose());
    }
    return { castle, water, emitters: this.emitters };
  }
}

// --- cached primitive geometries -------------------------------------------

const cache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry) {
  let g = cache.get(key);
  if (!g) {
    g = make();
    cache.set(key, g);
  }
  return g;
}
export const boxGeo = (w: number, h: number, d: number) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
export const cylGeo = (rt: number, rb: number, h: number, seg: number) =>
  cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1));
export const sphereGeo = (r: number, detail = 0) => cached(`s${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
export const dodecaGeo = (r: number) => cached(`d${r}`, () => new THREE.DodecahedronGeometry(r, 0));

export function mergeSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const g of geos) {
    const p = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}
