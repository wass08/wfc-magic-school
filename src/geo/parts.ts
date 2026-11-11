import * as THREE from 'three';
import { RNG } from '../config';
import { GeoBuilder, MAT, PartStyle, boxGeo, cylGeo, dodecaGeo, mat4, sphereGeo } from './builder';

// --- palette (sampled from the reference sheets) ----------------------------

export const C = {
  stone: '#a4808a',
  stoneLight: '#b8929a',
  stoneDark: '#7d5f6a',
  paving: '#9c8590',
  roof: '#4a5266',
  roofDark: '#3c4356',
  wood: '#6a4330',
  woodDark: '#4a2e22',
  gold: '#d9aa52',
  iron: '#2e2a30',
  glass: '#ff9838',
  magic: '#a070ff',
  grass: '#6f8a45',
  hedge: '#4f6d34',
  leaf: ['#5f7d3a', '#6c8a40', '#4d6b30', '#7a9548'],
  cypress: '#3e5a35',
  trunk: '#5a3d2b',
  flowers: ['#b58ee0', '#e39ac4', '#f2d27a', '#9a7ad0'],
  banners: ['#8e1f33', '#1f2f57', '#1d4d3d', '#4c2a6b'],
};

export const S = {
  stone: (color: string = C.stone): PartStyle => ({ color, mat: MAT.stone }),
  paving: (color: string = C.paving): PartStyle => ({ color, mat: MAT.paving }),
  roof: (color: string = C.roof): PartStyle => ({ color, mat: MAT.roof }),
  wood: (color: string = C.wood): PartStyle => ({ color, mat: MAT.wood }),
  gold: (): PartStyle => ({ color: C.gold, mat: MAT.gold }),
  iron: (): PartStyle => ({ color: C.iron, mat: MAT.iron }),
  glass: (purple = false): PartStyle => (purple ? { color: C.magic, mat: MAT.glass, emi: 1.5, flick: 0.15 } : { color: C.glass, mat: MAT.glass, emi: 1.15, flick: 0.12 }),
  flame: (): PartStyle => ({ color: '#ffa040', mat: MAT.plain, emi: 2.6, flick: 0.7 }),
  magic: (): PartStyle => ({ color: C.magic, mat: MAT.magic, emi: 2.6, flick: 0.45 }),
  leaf: (color: string, sway = 0.025): PartStyle => ({ color, mat: MAT.foliage, sway }),
  grass: (): PartStyle => ({ color: C.grass, mat: MAT.grass }),
};

export const pick = <T>(rng: RNG, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];
export const range = (rng: RNG, a: number, b: number) => a + rng() * (b - a);

/** ry that makes a part's local +Z face outward at angle a on a circle (x=cos a, z=sin a). */
export const outward = (a: number) => Math.PI / 2 - a;

// --- shapes -----------------------------------------------------------------

function archShape(w: number, h: number): THREE.Shape {
  const r = w / 2;
  const rise = Math.min(h * 0.55, w * 0.8);
  const spring = h - rise;
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(-r, spring);
  s.quadraticCurveTo(-r, spring + rise * 0.62, 0, h);
  s.quadraticCurveTo(r, spring + rise * 0.62, r, spring);
  s.lineTo(r, 0);
  s.lineTo(-r, 0);
  return s;
}

/**
 * Arch openings rising from a wall's base line can't be holes (earcut drops
 * holes that touch the outline), so the outline itself walks up and over
 * each arch. Call between moveTo(x0, y0) and the closing top edge.
 */
function notchArches(s: THREE.Shape, y0: number, arches: [cx: number, w: number, h: number][]) {
  for (const [cx, w, h] of [...arches].sort((a, b) => a[0] - b[0])) {
    const pts = archShape(w, h).getPoints(6);
    pts.pop(); // drop the closing point back at the start
    for (const p of pts) s.lineTo(p.x + cx, p.y + y0);
  }
}


const shapeCache = new Map<string, THREE.BufferGeometry>();
function shaped(key: string, make: () => THREE.BufferGeometry) {
  let g = shapeCache.get(key);
  if (!g) {
    g = make();
    shapeCache.set(key, g);
  }
  return g;
}

export const archFrameGeo = (w: number, h: number, t: number, depth: number) =>
  shaped(`af${w},${h},${t},${depth}`, () => {
    // U-shaped band: base line, up and over the inner arch, then back over the outer arch
    const s = new THREE.Shape();
    s.moveTo(-w / 2 - t, 0);
    notchArches(s, 0, [[0, w, h]]);
    const outer = archShape(w + t * 2, h + t).getPoints(6);
    outer.pop();
    for (const p of outer.reverse()) s.lineTo(p.x, p.y);
    return new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  });

export const archFillGeo = (w: number, h: number) => shaped(`afill${w},${h}`, () => new THREE.ShapeGeometry(archShape(w, h), 6));

/** Rectangle wall with a pointed-arch opening, extruded along Z (centred). */
export const archedWallGeo = (x0: number, x1: number, height: number, depth: number, holeW: number, holeH: number) =>
  shaped(`aw${x0},${x1},${height},${depth},${holeW},${holeH}`, () => {
    const s = new THREE.Shape();
    s.moveTo(x0, 0);
    notchArches(s, 0, [[(x0 + x1) / 2, holeW, holeH]]);
    s.lineTo(x1, 0);
    s.lineTo(x1, height);
    s.lineTo(x0, height);
    s.lineTo(x0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 8 });
    g.translate(0, 0, -depth / 2);
    return g;
  });

/** Triangular prism along +X from 0 to len: base half-width hw at y=0, apex at y=h. */
export const prismGeo = (len: number, hw: number, h: number) =>
  shaped(`pr${len},${hw},${h}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-hw, 0);
    s.lineTo(hw, 0);
    s.lineTo(0, h);
    s.lineTo(-hw, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.rotateY(Math.PI / 2);
    return g;
  });

/** Hanging banner with a V-notched tail, top edge at y=0, hanging down -Y, facing +Z. */
export const bannerGeo = (w: number, h: number) =>
  shaped(`bn${w},${h}`, () => {
    const rows = 8;
    const pos: number[] = [];
    const notch = w * 0.45;
    const row = (i: number) => {
      const y = (-h * i) / rows;
      const mid = i === rows ? y + notch : y;
      return [
        [-w / 2, y],
        [0, mid],
        [w / 2, y],
      ];
    };
    for (let i = 0; i < rows; i++) {
      const a = row(i);
      const b = row(i + 1);
      for (let c = 0; c < 2; c++) {
        const quad = [a[c], b[c], b[c + 1], a[c], b[c + 1], a[c + 1]];
        for (const [x, y] of quad) pos.push(x, y, 0.004);
        // back face (reversed winding)
        const back = [a[c], b[c + 1], b[c], a[c], a[c + 1], b[c + 1]];
        for (const [x, y] of back) pos.push(x, y, -0.004);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
  });

export const starGeo = (r: number, points = 8) =>
  shaped(`st${r},${points}`, () => {
    const s = new THREE.Shape();
    for (let i = 0; i <= points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2 + Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.35;
      if (i === 0) s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    return new THREE.ShapeGeometry(s);
  });

export const torusGeo = (r: number, t: number) => shaped(`to${r},${t}`, () => new THREE.TorusGeometry(r, t, 5, 28));

// --- architectural parts ----------------------------------------------------

/**
 * Gothic window on a face whose outward normal is local +Z (after ry).
 * (x,y,z) is the bottom-centre of the opening on the face plane.
 */
export function gothicWindow(b: GeoBuilder, x: number, y: number, z: number, ry: number, w: number, h: number, purple = false, frame = C.stoneLight) {
  b.at(x, y, z, ry, () => {
    b.add(archFillGeo(w, h), mat4(0, 0, 0.012), S.glass(purple));
    b.add(archFrameGeo(w, h, 0.07, 0.1), mat4(0, 0, -0.03), S.stone(frame));
    b.box(0.05, h * 0.82, 0.05, 0, h * 0.41, 0.03, S.stone(frame));
    if (h > w * 1.6) b.box(w, 0.045, 0.05, 0, h * 0.5, 0.03, S.stone(frame));
    b.box(w + 0.24, 0.08, 0.18, 0, -0.04, 0.05, S.stone(frame));
  });
}

export function door(b: GeoBuilder, x: number, y: number, z: number, ry: number, w: number, h: number) {
  b.at(x, y, z, ry, () => {
    b.add(archFillGeo(w, h), mat4(0, 0, 0.015), S.wood(C.woodDark));
    b.add(archFrameGeo(w, h, 0.12, 0.16), mat4(0, 0, -0.04), S.stone(C.stoneLight));
    // planks + iron straps
    for (const yy of [h * 0.25, h * 0.55]) b.box(w * 0.9, 0.05, 0.03, 0, yy, 0.03, S.iron());
    b.add(archFillGeo(w * 0.18, w * 0.3), mat4(0, h * 0.62, 0.025), { color: C.glass, mat: MAT.plain, emi: 1.5, flick: 0.3 });
  });
}

/** Merlons along X from x0 to x1 at height y, centred on z. */
export function merlons(b: GeoBuilder, x0: number, x1: number, y: number, z: number, thick: number, h = 0.42, pitch = 0.62, style = S.stone()) {
  const len = x1 - x0;
  const n = Math.max(1, Math.round(len / pitch));
  const step = len / n;
  b.block(len, 0.16, thick, (x0 + x1) / 2, y, z, style);
  for (let i = 0; i < n; i++) b.block(step * 0.55, h, thick, x0 + step * (i + 0.5), y + 0.16, z, style);
}

export function finial(b: GeoBuilder, x: number, y: number, z: number, s = 1) {
  b.add(sphereGeo(0.09 * s, 1), mat4(x, y + 0.09 * s, z), S.gold());
  b.cone(0.05 * s, 0.45 * s, 6, x, y + 0.14 * s, z, S.gold());
}

/** Square pinnacle: shaft + pyramid cap + gold finial. Base at y. */
export function pinnacle(b: GeoBuilder, x: number, y: number, z: number, size = 0.3, shaft = 0.35) {
  b.block(size, shaft, size, x, y, z, S.stone(C.stoneLight));
  b.cone(size * 0.75, size * 2.2, 4, x, y + shaft, z, S.stone(C.stoneLight), Math.PI / 4);
  finial(b, x, y + shaft + size * 2.1, z, size * 2);
}

/** Wall-mounted lantern on a face with outward normal local +Z. */
export function lantern(b: GeoBuilder, x: number, y: number, z: number, ry: number) {
  b.at(x, y, z, ry, () => {
    b.box(0.05, 0.05, 0.38, 0, 0.32, 0.19, S.iron());
    b.box(0.04, 0.12, 0.04, 0, 0.24, 0.36, S.iron());
    b.box(0.22, 0.04, 0.22, 0, 0.17, 0.36, S.iron());
    b.box(0.15, 0.24, 0.15, 0, 0.03, 0.36, S.flame());
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.025, 0.26, 0.025, dx * 0.09, 0.03, 0.36 + dz * 0.09, S.iron());
    b.cone(0.17, 0.14, 4, 0, 0.19, 0.36, S.iron(), Math.PI / 4);
    b.box(0.2, 0.04, 0.2, 0, -0.11, 0.36, S.iron());
  });
}

export function lampPost(b: GeoBuilder, x: number, z: number, y = 0) {
  b.block(0.3, 0.3, 0.3, x, y, z, S.stone(C.stoneLight));
  b.cyl(0.04, 0.05, 1.5, 6, x, y + 0.3, z, S.iron());
  b.box(0.22, 0.04, 0.22, x, y + 1.8, z, S.iron());
  b.block(0.16, 0.26, 0.16, x, y + 1.82, z, S.flame());
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.block(0.025, 0.28, 0.025, x + dx * 0.095, y + 1.81, z + dz * 0.095, S.iron());
  b.cone(0.18, 0.18, 4, x, y + 2.08, z, S.iron(), Math.PI / 4);
  finial(b, x, y + 2.22, z, 0.6);
}

/** Hanging banner on a face with outward normal local +Z, top edge at y. */
export function banner(b: GeoBuilder, x: number, y: number, z: number, ry: number, w: number, h: number, colorIdx: number, emblem = 0) {
  b.at(x, y, z, ry, () => {
    const top = y; // module-space height of the rod (sway weight reference)
    b.add(cylGeo(0.035, 0.035, w + 0.2, 6), mat4(0, 0, 0.12, 0, 0, Math.PI / 2), S.gold());
    for (const sx of [-1, 1]) b.add(sphereGeo(0.05, 0), mat4((sx * (w + 0.2)) / 2, 0, 0.12), S.gold());
    const sway = { sway: 0.12, swayDir: new THREE.Vector3(0, 0, 1), swayTop: top, swayLen: h };
    b.add(bannerGeo(w, h), mat4(0, -0.02, 0.12), { color: C.banners[colorIdx % 4], mat: MAT.cloth, ...sway });
    // gold trim band + emblem
    b.add(boxGeo(w, 0.05, 0.012), mat4(0, -0.1, 0.13), { ...S.gold(), ...sway });
    if (emblem === 0) b.add(starGeo(w * 0.28, 8), mat4(0, -h * 0.42, 0.135), { color: C.gold, mat: MAT.gold, emi: 0.25, ...sway });
    else {
      b.add(torusGeo(w * 0.2, 0.018), mat4(0, -h * 0.42, 0.135), { color: C.gold, mat: MAT.gold, emi: 0.25, ...sway });
      b.add(boxGeo(0.025, w * 0.62, 0.01), mat4(0, -h * 0.42, 0.14), { color: C.gold, mat: MAT.gold, emi: 0.25, ...sway });
    }
  });
}

/** Ivy climbing a flat face (outward normal local +Z after ry), growing from y0. */
export function ivy(b: GeoBuilder, rng: RNG, x: number, y0: number, z: number, ry: number, width: number, height: number, vines = 3, wisteria = false) {
  b.at(x, y0, z, ry, () => {
    for (let v = 0; v < vines; v++) {
      let u = range(rng, -width / 2, width / 2);
      const top = height * range(rng, 0.45, 1);
      for (let yy = 0; yy < top; yy += 0.13) {
        u += range(rng, -0.1, 0.1);
        u = THREE.MathUtils.clamp(u, -width / 2, width / 2);
        const spread = 0.28 * (1 - yy / (top + 0.5));
        for (let k = 0; k < 2; k++) {
          const s = range(rng, 0.09, 0.17);
          b.add(dodecaGeo(1), mat4(u + range(rng, -spread, spread), yy, range(rng, 0.0, 0.06), rng() * 6, rng() * 6, 0, s, s, s * 0.55), S.leaf(pick(rng, C.leaf), 0.015));
        }
      }
    }
    if (wisteria) {
      for (let i = 0; i < 6; i++) {
        const u = range(rng, -width / 2, width / 2);
        const yy = height * range(rng, 0.55, 0.95);
        b.add(dodecaGeo(1), mat4(u, yy, 0.08, 0, 0, 0, 0.08, 0.26, 0.08), S.leaf(pick(rng, [C.flowers[0], C.flowers[3]]), 0.02));
      }
    }
  });
}

/** Ivy on a cylinder of radius r around angle a. */
export function ivyCyl(b: GeoBuilder, rng: RNG, r: number, a: number, y0: number, height: number, spreadAngle = 0.5) {
  for (let v = 0; v < 3; v++) {
    let ang = a + range(rng, -spreadAngle, spreadAngle);
    const top = height * range(rng, 0.4, 1);
    for (let yy = 0; yy < top; yy += 0.13) {
      ang += range(rng, -0.05, 0.05);
      const sp = 0.16 * (1 - yy / (top + 0.5));
      for (let k = 0; k < 2; k++) {
        const aa = ang + range(rng, -sp, sp);
        const s = range(rng, 0.09, 0.17);
        b.add(dodecaGeo(1), mat4(Math.cos(aa) * (r + 0.03), y0 + yy, Math.sin(aa) * (r + 0.03), outward(aa), 0, 0, s, s, s * 0.55), S.leaf(pick(rng, C.leaf), 0.015));
      }
    }
  }
}

export function tree(b: GeoBuilder, rng: RNG, x: number, z: number, s = 1, y = 0) {
  b.cyl(0.1 * s, 0.17 * s, 1.3 * s, 6, x, y, z, S.wood(C.trunk));
  for (let i = 0; i < 3; i++) {
    const a = rng() * Math.PI * 2;
    b.add(cylGeo(0.03 * s, 0.06 * s, 0.7 * s, 5), mat4(x + Math.cos(a) * 0.25 * s, y + 1.2 * s, z + Math.sin(a) * 0.25 * s, 0, Math.cos(a) * 0.6, Math.sin(a) * 0.6), S.wood(C.trunk));
  }
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng();
    const rr = i === 0 ? 0 : range(rng, 0.35, 0.65) * s;
    const r = range(rng, 0.42, 0.62) * s;
    b.add(sphereGeo(1, 1), mat4(x + Math.cos(a) * rr, y + range(rng, 1.55, 2.2) * s, z + Math.sin(a) * rr, rng() * 6, 0, 0, r, r * 0.85, r), S.leaf(pick(rng, C.leaf), 0.03));
  }
}

export function cypress(b: GeoBuilder, rng: RNG, x: number, z: number, s = 1, y = 0) {
  b.cyl(0.05 * s, 0.07 * s, 0.3 * s, 5, x, y, z, S.wood(C.trunk));
  b.add(sphereGeo(1, 1), mat4(x, y + 1.05 * s, z, rng() * 6, 0, 0, 0.32 * s, 0.95 * s, 0.32 * s), S.leaf(C.cypress, 0.02));
  b.add(sphereGeo(1, 1), mat4(x, y + 1.7 * s, z, rng() * 6, 0, 0, 0.2 * s, 0.5 * s, 0.2 * s), S.leaf(C.cypress, 0.03));
}

export function bush(b: GeoBuilder, rng: RNG, x: number, z: number, s = 1, y = 0, flowers = true) {
  for (let i = 0; i < 3; i++) {
    const r = range(rng, 0.16, 0.26) * s;
    b.add(sphereGeo(1, 0), mat4(x + range(rng, -0.2, 0.2) * s, y + r * 0.7, z + range(rng, -0.2, 0.2) * s, rng() * 6, 0, 0, r, r * 0.8, r), S.leaf(pick(rng, C.leaf), 0.01));
  }
  if (flowers) {
    const fc = pick(rng, C.flowers);
    for (let i = 0; i < 4; i++) b.add(sphereGeo(0.05, 0), mat4(x + range(rng, -0.25, 0.25) * s, y + range(rng, 0.2, 0.38) * s, z + range(rng, -0.25, 0.25) * s), S.leaf(fc, 0.01));
  }
}

/** Small dormer facing local +Z, sitting at (x,y,z). */
export function dormer(b: GeoBuilder, x: number, y: number, z: number, ry: number, s = 1) {
  b.at(x, y, z, ry, () => {
    b.block(0.5 * s, 0.5 * s, 0.7 * s, 0, 0, -0.25 * s, S.stone());
    b.add(archFillGeo(0.24 * s, 0.34 * s), mat4(0, 0.06 * s, 0.105 * s), S.glass());
    b.add(archFrameGeo(0.24 * s, 0.34 * s, 0.05 * s, 0.05), mat4(0, 0.06 * s, 0.08 * s), S.wood());
    b.add(prismGeo(0.86 * s, 0.33 * s, 0.32 * s), mat4(0, 0.5 * s, 0.13 * s, Math.PI / 2), S.roof());
    finial(b, 0, 0.8 * s, 0.1 * s, 0.5 * s);
  });
}

/**
 * Gable roof along X from x0 to x1 resting on y=0: stone prism core + slate slabs,
 * ridge cap and optional dormers. `overhang` extends slabs past x-ends.
 */
export function gableRoof(b: GeoBuilder, x0: number, x1: number, hw: number, h: number, opts: { ovMin?: number; ovMax?: number; dormers?: number[]; color?: string } = {}) {
  const len = x1 - x0;
  b.add(prismGeo(len, hw, h), mat4(x0, 0, 0), S.stone());
  const ovE = 0.28; // eave overhang
  const t = 0.12;
  const L = Math.hypot(hw, h);
  const a = Math.atan2(h, hw);
  const sx0 = x0 - (opts.ovMin ?? 0);
  const sx1 = x1 + (opts.ovMax ?? 0);
  const slabLen = sx1 - sx0;
  const cx = (sx0 + sx1) / 2;
  for (const side of [1, -1]) {
    // slab centre: slope midpoint, pushed out by t/2 along normal and toward the eave by ovE/2
    const nz = Math.sin(a) * side, ny = Math.cos(a);
    const dz = (hw / L) * side, dy = -h / L;
    const mz = (hw / 2) * side + nz * (t / 2) + dz * (ovE / 2);
    const my = h / 2 + ny * (t / 2) + dy * (ovE / 2);
    b.add(boxGeo(slabLen, t, L + ovE), mat4(cx, my, mz, 0, a * side), S.roof(opts.color));
  }
  b.box(slabLen + 0.02, 0.1, 0.16, cx, h + 0.08, 0, S.roof(C.roofDark));
  for (const dx of opts.dormers ?? []) {
    for (const side of [1, -1]) {
      const zz = hw * 0.5 * side;
      dormer(b, dx, h * 0.38, zz + 0.12 * side, side > 0 ? 0 : Math.PI, 1);
    }
  }
}

/** Wall along X from x0 to x1 (y 0..h) with n evenly spaced pointed arches, extruded along Z (centred). */
export const arcadeWallGeo = (x0: number, x1: number, h: number, depth: number, n: number, holeW: number, holeH: number) =>
  shaped(`acw${x0},${x1},${h},${depth},${n},${holeW},${holeH}`, () => {
    const s = new THREE.Shape();
    const pitch = (x1 - x0) / n;
    s.moveTo(x0, 0);
    notchArches(s, 0, Array.from({ length: n }, (_, i) => [x0 + pitch * (i + 0.5), holeW, holeH] as [number, number, number]));
    s.lineTo(x1, 0);
    s.lineTo(x1, h);
    s.lineTo(x0, h);
    s.lineTo(x0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    return g;
  });

/**
 * Bridge body along X over [-half, half], from botY up to a humpbacked deck
 * (topY at the ends, topY + hump in the middle), with one arch over the water.
 */
export const bridgeGeo = (half: number, botY: number, topY: number, hump: number, depth: number, archW: number, archH: number) =>
  shaped(`br${half},${botY},${topY},${hump},${depth},${archW},${archH}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-half, botY);
    notchArches(s, botY, [[0, archW, archH]]);
    s.lineTo(half, botY);
    s.lineTo(half, topY);
    s.quadraticCurveTo(0, topY + hump * 2, -half, topY);
    s.lineTo(-half, botY);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    return g;
  });

/** Height of the humpbacked deck at x (matches bridgeGeo's quadratic). */
export const humpY = (x: number, half: number, topY: number, hump: number) => topY + hump * (1 - (x / half) ** 2);

/** Band of height h following the hump curve (deck paving, parapets), extruded along Z (centred). */
export const humpBandGeo = (half: number, topY: number, hump: number, h: number, depth: number) =>
  shaped(`hb${half},${topY},${hump},${h},${depth}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-half, topY);
    s.quadraticCurveTo(0, topY + hump * 2, half, topY);
    s.lineTo(half, topY + h);
    s.quadraticCurveTo(0, topY + h + hump * 2, -half, topY + h);
    s.lineTo(-half, topY);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
    g.translate(0, 0, -depth / 2);
    return g;
  });

/** Lantern hanging from a ceiling at (x, y, z); y is the hook height. */
export function hangingLantern(b: GeoBuilder, x: number, y: number, z: number) {
  b.box(0.02, 0.3, 0.02, x, y - 0.15, z, S.iron());
  b.cone(0.13, 0.1, 6, x, y - 0.38, z, S.iron());
  b.block(0.13, 0.2, 0.13, x, y - 0.58, z, S.flame());
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.block(0.02, 0.22, 0.02, x + dx * 0.075, y - 0.59, z + dz * 0.075, S.iron());
  b.box(0.16, 0.03, 0.16, x, y - 0.6, z, S.iron());
}

/** Candle with a flame; sway makes it bob gently when floating. */
export function candle(b: GeoBuilder, x: number, y: number, z: number, h: number, float = 0) {
  const bob = float ? { sway: float, swayDir: new THREE.Vector3(0, 1, 0) } : {};
  b.add(cylGeo(0.045, 0.05, h, 7), mat4(x, y + h / 2, z), { color: '#efe2c4', mat: MAT.plain, emi: float ? 0.15 : 0, ...bob });
  b.add(sphereGeo(0.035, 1), mat4(x, y + h + 0.05, z, 0, 0, 0, 1, 1.6, 1), { ...S.flame(), ...bob });
}

/** Balcony on a face with outward normal local +Z (after ry); (x, y, z) = floor centre on the face. */
export function balcony(b: GeoBuilder, rng: RNG, x: number, y: number, z: number, ry: number, w = 1.4) {
  b.at(x, y, z, ry, () => {
    b.block(w, 0.12, 0.62, 0, 0, 0.31, S.stone(C.stoneLight));
    for (let i = 0; i < 3; i++) b.add(boxGeo(0.14, 0.3, 0.5), mat4(-w / 2 + 0.2 + i * ((w - 0.4) / 2), -0.15, 0.25, 0, 0.5), S.stone());
    b.block(w, 0.07, 0.1, 0, 0.62, 0.58, S.stone(C.stoneLight));
    for (let x2 = -w / 2 + 0.08; x2 <= w / 2 - 0.07; x2 += 0.16) b.block(0.05, 0.5, 0.05, x2, 0.12, 0.58, S.stone(C.stoneLight));
    for (const sx of [-1, 1]) b.block(0.07, 0.5, 0.56, sx * (w / 2 - 0.035), 0.12, 0.3, S.stone(C.stoneLight));
    const fc = pick(rng, C.flowers);
    for (const sx of [-1, 1]) {
      b.block(0.22, 0.16, 0.22, sx * (w / 2 - 0.22), 0.12, 0.38, S.stone('#9a6a55'));
      for (let i = 0; i < 4; i++) b.add(sphereGeo(0.06, 0), mat4(sx * (w / 2 - 0.22) + range(rng, -0.08, 0.08), 0.33, 0.38 + range(rng, -0.08, 0.08)), S.leaf(i % 2 ? fc : pick(rng, C.leaf), 0.01));
    }
  });
}

/** Swaying pennant flying from a pole top at (x, y, z), streaming along +X. */
export function pennant(b: GeoBuilder, x: number, y: number, z: number, len: number, colorIdx: number) {
  const pos: number[] = [];
  const n = 6;
  const top = (t: number) => -(0.35 * t) / 2;
  const bot = (t: number) => -0.35 + (0.35 * t) / 2;
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n;
    const a = [t0 * len, top(t0)], b1 = [t1 * len, top(t1)], c = [t1 * len, bot(t1)], d = [t0 * len, bot(t0)];
    for (const [px, py] of [a, c, b1, a, d, c]) pos.push(px, py, 0.005);
    for (const [px, py] of [a, b1, c, a, c, d]) pos.push(px, py, -0.005);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  b.cyl(0.025, 0.03, 1.0, 5, x, y - 1.0, z, S.iron());
  b.add(g, mat4(x, y, z), { color: C.banners[colorIdx % 4], mat: MAT.cloth, sway: 0.18, swayDir: new THREE.Vector3(0, 0, 1), swayOrigin: new THREE.Vector3(x, y, z), swayLen: len });
  b.add(sphereGeo(0.05, 0), mat4(x, y + 0.04, z), S.gold());
}

/** Rose window on a face with outward normal local +Z (after ry), centred at (x, y, z). */
export function roseWindow(b: GeoBuilder, x: number, y: number, z: number, ry: number, r: number, purple = true) {
  b.at(x, y, z, ry, () => {
    b.add(cached2(`rose${r}`, () => new THREE.CircleGeometry(r, 24)), mat4(0, 0, 0.012), S.glass(purple));
    b.add(torusGeo(r + 0.04, 0.07), mat4(0, 0, 0.04), S.stone(C.stoneLight));
    b.add(torusGeo(r * 0.32, 0.035), mat4(0, 0, 0.04), S.stone(C.stoneLight));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      b.add(boxGeo(0.04, r * 0.68, 0.04), mat4(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66, 0.04, 0, 0, a - Math.PI / 2), S.stone(C.stoneLight));
      b.add(torusGeo(r * 0.16, 0.022), mat4(Math.cos(a + Math.PI / 8) * r * 0.7, Math.sin(a + Math.PI / 8) * r * 0.7, 0.04), S.stone(C.stoneLight));
    }
  });
}

const cache2 = new Map<string, THREE.BufferGeometry>();
function cached2(key: string, make: () => THREE.BufferGeometry) {
  let g = cache2.get(key);
  if (!g) cache2.set(key, (g = make()));
  return g;
}
