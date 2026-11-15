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
  /** glass with a painted room behind it (interior mapping) */
  interior: 13,
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
  /**
   * window pane of this size (part space: x in −w/2…w/2, y in 0…h, facing +Z): every vertex
   * records where it sits on the pane, for the interior-mapping shader
   */
  win?: { w: number; h: number };
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

/** Lit window panes (leaded glass, interior rooms): the ones that can be dark at night. */
const WINDOW_MATS = new Set([6, 13]);

/**
 * A stable id in (0, 1] for the window a lit pane belongs to (aFx.w; 0 = not switchable).
 * Pieces of one window (pane, arch, tracery) sit close together, so they share the id of
 * their coarse spot on the facade; the shader and the ground light use it to leave some
 * windows dark (`windowOff`).
 */
function windowSeed(p: THREE.BufferAttribute, s: PartStyle): number {
  if (!(s.emi && s.emi > 0) || !WINDOW_MATS.has(s.mat)) return 0;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < p.count; i++) (x += p.getX(i)), (y += p.getY(i)), (z += p.getZ(i));
  const n = Math.max(1, p.count);
  const kx = Math.round(x / n / 0.9), ky = Math.round(y / n / 1.5), kz = Math.round(z / n / 0.9);
  let h = (kx * 73856093) ^ (ky * 19349663) ^ (kz * 83492791);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return (((h ^ (h >>> 15)) >>> 0) % 9973) / 9973 + 1e-4;
}

/** Share of switchable windows left dark at night. */
export const WINDOWS_OFF = 0.28;

/**
 * Is this window dark in the copy of its module at instance position (x, y, z)? Mirrors the
 * castle shader exactly (fract arithmetic only, so CPU and GPU agree).
 */
export function windowOff(seed: number, x: number, y: number, z: number): boolean {
  if (seed <= 0) return false;
  const fr = (v: number) => v - Math.floor(v);
  return fr(seed * 7.13 + fr(x * 0.1031) + fr(y * 0.0973) + fr(z * 0.1099)) < WINDOWS_OFF;
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
  /** aWin = (u, v, pane width, pane height); zero outside interior windows */
  private win: number[] = [];
  private water: THREE.BufferGeometry[] = [];
  /** first vertex of each part added, and what it looks like (coplanar parts are told apart in `build`) */
  private parts: { start: number; look: string; sway: boolean }[] = [];
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
    if (s.win) {
      const lp = g.attributes.position;
      for (let i = 0; i < lp.count; i++) this.win.push(lp.getX(i) / s.win.w + 0.5, lp.getY(i) / s.win.h, s.win.w, s.win.h);
    } else for (let i = 0; i < g.attributes.position.count; i++) this.win.push(0, 0, 0, 0);
    _m.copy(this.matrix);
    if (local) _m.multiply(local);
    g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position as THREE.BufferAttribute;
    const n = g.attributes.normal as THREE.BufferAttribute;
    const c = new THREE.Color(s.color);
    const lamp = windowSeed(p, s);
    const dir = s.swayDir ? s.swayDir.clone().transformDirection(_m) : null;
    const amp = s.sway ?? 0;
    this.parts.push({ start: this.pos.length / 3, look: `${c.getHexString()}|${s.mat}|${s.emi ?? 0}`, sway: amp > 0 });
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      this.pos.push(p.getX(i), y, p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c.r, c.g, c.b);
      this.fx.push(s.emi ?? 0, s.flick ?? 0, s.mat, lamp);
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
      separateCoplanar(this.pos, this.parts);
      castle = new THREE.BufferGeometry();
      castle.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      castle.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
      castle.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      castle.setAttribute('aFx', new THREE.Float32BufferAttribute(this.fx, 4));
      // aAux carries the pane coordinates on interior windows and the sway everywhere else (a
      // vertex never needs both): with one fewer attribute, geometry + instance matrix fit
      // three's 8 vertex buffers, and instanced meshes share one shader build instead of each
      // compiling its own
      const aux = new Float32Array(this.sw.length);
      for (let i = 0; i < aux.length; i += 4) {
        const src = this.win[i + 2] > 0 ? this.win : this.sw;
        aux[i] = src[i];
        aux[i + 1] = src[i + 1];
        aux[i + 2] = src[i + 2];
        aux[i + 3] = src[i + 3];
      }
      castle.setAttribute('aAux', new THREE.Float32BufferAttribute(aux, 4));
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

// --- coplanar faces ------------------------------------------------------------

/** how far a part that shares a face with an earlier one is grown, per step of the chain */
const COPLANAR_STEP = 0.001;

/**
 * Parts are built from overlapping boxes, so faces of different parts often lie in the same plane
 * (a cornice's top flush with the wall's, a plinth's end flush with the slab above it). Where two
 * such faces look different they z-fight. Here every part with a face flush against an earlier,
 * different-looking part is grown by a few millimetres (one step more than the part it sits on), so
 * the later part always wins the depth test.
 */
function separateCoplanar(pos: number[], parts: { start: number; look: string; sway: boolean }[]) {
  const nv = pos.length / 3;
  const partOf = new Int32Array(nv);
  for (let i = 0; i < parts.length; i++) partOf.fill(i, parts[i].start, i + 1 < parts.length ? parts[i + 1].start : nv);
  type Tri = { part: number; d: number; p: number[]; box: number[] };
  const buckets = new Map<string, Tri[]>();
  for (let t = 0; t < nv; t += 3) {
    const part = partOf[t];
    if (parts[part].sway) continue;
    const o = t * 3;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
    const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) continue;
    nx /= len; ny /= len; nz /= len;
    // project on the plane's dominant axes
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const [i0, i1] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1];
    const p = [pos[o + i0], pos[o + i1], pos[o + 3 + i0], pos[o + 3 + i1], pos[o + 6 + i0], pos[o + 6 + i1]];
    const box = [Math.min(p[0], p[2], p[4]), Math.max(p[0], p[2], p[4]), Math.min(p[1], p[3], p[5]), Math.max(p[1], p[3], p[5])];
    const key = `${Math.round(nx * 200)},${Math.round(ny * 200)},${Math.round(nz * 200)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push({ part, d: nx * pos[o] + ny * pos[o + 1] + nz * pos[o + 2], p, box });
  }
  // earlier parts each part is flush against
  const under = new Map<number, Set<number>>();
  for (const b of buckets.values()) {
    if (b.length < 2) continue;
    b.sort((a, c) => a.d - c.d);
    for (let i = 0; i < b.length; i++) {
      const t = b[i];
      for (let j = i + 1; j < b.length && b[j].d - t.d < 5e-4; j++) {
        const u = b[j];
        if (u.part === t.part || parts[u.part].look === parts[t.part].look) continue;
        if (u.box[1] <= t.box[0] || u.box[0] >= t.box[1] || u.box[3] <= t.box[2] || u.box[2] >= t.box[3]) continue;
        if (overlapArea(t.p, u.p) < 1e-5) continue;
        const lo = Math.min(t.part, u.part), hi = Math.max(t.part, u.part);
        let s = under.get(hi);
        if (!s) under.set(hi, (s = new Set()));
        s.add(lo);
      }
    }
  }
  if (!under.size) return;
  const level = new Int32Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const s = under.get(i);
    if (s) for (const j of s) level[i] = Math.max(level[i], level[j] + 1);
  }
  // grow each such part about its centre, every face moving out by `level` steps
  for (let i = 0; i < parts.length; i++) {
    if (!level[i]) continue;
    const a = parts[i].start, z = i + 1 < parts.length ? parts[i + 1].start : nv;
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = a; v < z; v++) for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k], pos[v * 3 + k]);
      hi[k] = Math.max(hi[k], pos[v * 3 + k]);
    }
    const grow = COPLANAR_STEP * level[i];
    for (let k = 0; k < 3; k++) {
      const size = hi[k] - lo[k];
      const c = (lo[k] + hi[k]) / 2;
      if (size > 1e-4) {
        const f = 1 + (2 * grow) / size;
        for (let v = a; v < z; v++) pos[v * 3 + k] = c + (pos[v * 3 + k] - c) * f;
      }
    }
    // flat parts (a plane) can't grow: lift them off the face instead
    for (let k = 0; k < 3; k++) {
      if (hi[k] - lo[k] > 1e-4) continue;
      for (let v = a; v < z; v++) pos[v * 3 + k] += grow * Math.sign(flatNormal(pos, a, k));
    }
  }
}

/** sign source for a flat part's lift: its first triangle's normal along axis k */
function flatNormal(pos: number[], a: number, k: number) {
  const o = a * 3;
  const u = [pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]];
  const v = [pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  return n[k] || 1;
}

/** area shared by two 2D triangles (flat xy pairs), by clipping one against the other */
function overlapArea(a: number[], b: number[]) {
  let poly: number[][] = [[a[0], a[1]], [a[2], a[3]], [a[4], a[5]]];
  const clipP = [[b[0], b[1]], [b[2], b[3]], [b[4], b[5]]];
  const ccw = (clipP[1][0] - clipP[0][0]) * (clipP[2][1] - clipP[0][1]) - (clipP[1][1] - clipP[0][1]) * (clipP[2][0] - clipP[0][0]) > 0;
  for (let i = 0; i < 3 && poly.length; i++) {
    const p0 = clipP[i], p1 = clipP[(i + 1) % 3];
    const ex = p1[0] - p0[0], ey = p1[1] - p0[1];
    const side = (q: number[]) => {
      const c = ex * (q[1] - p0[1]) - ey * (q[0] - p0[0]);
      return ccw ? c : -c;
    };
    const out: number[][] = [];
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j], q = poly[(j + 1) % poly.length];
      const sp = side(p), sq = side(q);
      if (sp > 1e-9) out.push(p);
      if ((sp > 1e-9) !== (sq > 1e-9) && sp !== sq) {
        const k = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
      }
    }
    poly = out;
  }
  if (poly.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
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
