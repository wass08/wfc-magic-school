import * as THREE from 'three';
import { GeoBuilder, MAT, boxGeo, cylGeo, dodecaGeo, mat4, sphereGeo } from './builder';
import {
  C, S, archFrameGeo, archedWallGeo, arcadeWallGeo, banner, bridgeGeo, bush, candle, cypress, dormer, finial, gableRoof,
  gothicWindow, hangingLantern, humpBandGeo, humpY, ivy, lantern, merlons, outward, pick, pinnacle, range, torusGeo,
} from './parts';
import { BASE_Y, HALF, HALL_HW, ROOF_H, ROOF_HW, grassBase, hallBody, pier, plinth, wallArms, wallRun } from './modules';
import { Build, register } from './registry';

/**
 * Second wave of modules: hall junctions, square towers, gatehouse, bridges,
 * cloisters and special gardens. Same local frame as modules.ts.
 */

/** Rotation that maps local +X onto direction d (0:+X 1:-Z 2:-X 3:+Z). */
const rotY = (d: number) => mat4(0, 0, 0, (d * Math.PI) / 2);
const up = (y: number) => mat4(0, y, 0);

// --- shared: junction roofs ----------------------------------------------------

/** Timber-framed gable face at x = x0, facing -X. Scaled to the roof height. */
export function gableFace(b: GeoBuilder, x0: number, hw: number, h: number, purple: boolean) {
  const fx = x0 - 0.02;
  const k = h / ROOF_H;
  const a = Math.atan2(h, hw);
  b.add(boxGeo(0.06, h * 0.9, 0.1 * k), mat4(fx, h * 0.45, 0), S.wood());
  for (const sz of [1, -1]) b.add(boxGeo(0.07, Math.hypot(hw, h) * 0.97, 0.1), mat4(fx - 0.04, h / 2, (sz * hw) / 2, 0, -sz * (Math.PI / 2 - a)), S.wood(C.woodDark));
  b.add(boxGeo(0.06, 0.08, hw * 2), mat4(fx, 0.06, 0), S.wood());
  gothicWindow(b, fx, 0.45 * k, 0, outward(Math.PI), 0.42 * k, 0.75 * k, purple);
  finial(b, x0 - 0.2, h + 0.06, 0, 1.3 * k);
}

/** Small octagonal lantern spire sitting on a roof crossing. */
export function fleche(b: GeoBuilder, y: number, s = 1) {
  b.cyl(0.45 * s, 0.45 * s, 0.9 * s, 8, 0, y, 0, S.stone(C.stoneLight));
  for (let k = 0; k < 8; k++) {
    const a = ((k + 0.5) / 8) * Math.PI * 2;
    b.add(boxGeo(0.12 * s, 0.4 * s, 0.03), mat4(Math.cos(a) * 0.43 * s, y + 0.45 * s, Math.sin(a) * 0.43 * s, outward(a)), S.glass());
  }
  b.cyl(0.55 * s, 0.5 * s, 0.1 * s, 8, 0, y + 0.88 * s, 0, S.stone(C.stoneLight));
  b.cone(0.56 * s, 2.1 * s, 8, 0, y + 0.95 * s, 0, S.roof());
  finial(b, 0, y + 3.0 * s, 0, 1.4 * s);
}

/**
 * Gable roofs meeting at the cell centre. Opposite arms become one straight
 * ridge; a lone branch starts at the centre (tucked under the main ridge);
 * corners/ends start at the far eave and show a timber gable at the back.
 */
function roofJunction(b: GeoBuilder, arms: number[], hw: number, h: number, opts: { dormers?: boolean; purple?: boolean } = {}) {
  const has = (d: number) => arms.includes(d);
  const straights = [0, 1].filter((axis) => has(axis) && has(axis + 2));
  const ridge = (d: number, x0: number, gable: boolean, dormers: number[]) =>
    b.with(rotY(d), () => {
      gableRoof(b, x0, HALF, hw, h, { ovMin: gable ? 0.2 : 0, dormers: opts.dormers ? dormers : [] });
      if (gable) gableFace(b, x0, hw, h, !!opts.purple);
    });
  for (const axis of straights) ridge(axis, -HALF, false, [-1.1, 1.1]);
  for (const d of arms) {
    if (straights.includes(d % 2)) continue;
    ridge(d, straights.length ? 0 : -hw, straights.length === 0, [1.1]);
  }
}

// --- hall junctions ----------------------------------------------------------------

const HALL_ARMS: Record<string, number[]> = { Corner: [0, 1], T: [0, 1, 2], Cross: [0, 1, 2, 3] };

function hallJunction(arms: number[], upper: boolean): Build {
  return (b, rng, style) => {
    if (!upper) plinth(b);
    for (const d of arms) b.with(rotY(d), () => hallBody(b, rng, -HALL_HW, HALF, style, upper));
  };
}

function hallRoofJunction(arms: number[]): Build {
  return (b, _rng, style) => {
    roofJunction(b, arms, ROOF_HW, ROOF_H, { dormers: true, purple: style === 1 });
    if (arms.length === 4 || (arms.length === 3 && style === 1)) fleche(b, ROOF_H - 0.35);
  };
}

const hallJunctions: Record<string, Build> = {};
for (const [name, arms] of Object.entries(HALL_ARMS)) {
  hallJunctions[`hall${name}`] = hallJunction(arms, false);
  hallJunctions[`hall${name}Upper`] = hallJunction(arms, true);
  hallJunctions[`hallRoof${name}`] = hallRoofJunction(arms);
}

// --- square towers ---------------------------------------------------------------

const SQ = 1.5;
/** Faces of the square tower: outward angle a, normal (cos a, sin a). */
const FACES = [0, 1, 2, 3].map((k) => (k * Math.PI) / 2);

function sqShaft(b: GeoBuilder) {
  b.block(SQ * 2, 3, SQ * 2, 0, 0, 0, S.stone());
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.block(0.36, 3, 0.36, x * SQ, 0, z * SQ, S.stone(C.stoneLight));
  b.block(SQ * 2 + 0.24, 0.14, SQ * 2 + 0.24, 0, 2.86, 0, S.stone(C.stoneLight));
}

const sqTowerBase: Build = (b, rng, style) => {
  plinth(b);
  b.block(SQ * 2 + 0.5, 0.55, SQ * 2 + 0.5, 0, 0, 0, S.stone(C.stoneDark));
  sqShaft(b);
  // windows off-centre: the face centres are kept free for the neighbour-aware door
  for (const a of FACES) {
    const nx = Math.cos(a), nz = Math.sin(a);
    for (const t of [-0.85, 0.85]) gothicWindow(b, nx * SQ - nz * t, 1.5, nz * SQ + nx * t, outward(a), 0.3, 0.7);
  }
  if (style === 1) ivy(b, rng, SQ * 0.4, 0.1, SQ + 0.02, 0, 1.4, 2.6, 3, true);
};

const sqTowerMid: Build = (b, rng, style) => {
  sqShaft(b);
  for (const a of FACES) {
    const nx = Math.cos(a), nz = Math.sin(a);
    gothicWindow(b, nx * SQ, 0.75, nz * SQ, outward(a), 0.5, 1.2, style === 1 && a === 0);
    if (style === 1 && (a === Math.PI / 2 || a === (3 * Math.PI) / 2)) {
      for (const t of [-0.95, 0.95]) banner(b, nx * SQ - nz * t, 2.7, nz * SQ + nx * t, outward(a), 0.45, 1.7, a > 2 ? 0 : 3, 0);
    }
  }
  if (style === 0) lantern(b, SQ, 2.1, 0.75, outward(0));
  if (style === 0 && rng() < 0.6) ivy(b, rng, -0.6, 0, -SQ - 0.02, Math.PI, 1, 2.6, 2);
};

const sqTowerRoof: Build = (b, _rng, style) => {
  b.block(SQ * 2 + 0.4, 0.3, SQ * 2 + 0.4, 0, 0, 0, S.stone(C.stoneLight));
  for (const a of FACES) {
    for (let i = -3; i <= 3; i++) {
      const nx = Math.cos(a), nz = Math.sin(a);
      b.block(0.14, 0.22, 0.14, nx * (SQ + 0.1) - nz * i * 0.42, -0.2, nz * (SQ + 0.1) + nx * i * 0.42, S.stone(C.stoneLight));
    }
  }
  const tall = style === 0;
  const h = tall ? 4.4 : 3.1;
  const half = SQ + 0.32;
  b.cone(half * Math.SQRT2, h, 4, 0, 0.3, 0, S.roof(), Math.PI / 4);
  for (const a of FACES) {
    const yd = 0.85;
    const rd = half * (1 - (yd + 0.25) / h);
    dormer(b, Math.cos(a) * rd, 0.3 + yd, Math.sin(a) * rd, outward(a), 1.15);
  }
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pinnacle(b, x * (SQ + 0.08), 0.3, z * (SQ + 0.08), 0.26, 0.4);
  if (tall) finial(b, 0, 0.3 + h - 0.1, 0, 2.2);
  else fleche(b, 0.3 + h - 0.5, 0.7);
};

// --- walls ----------------------------------------------------------------------

const wallCross: Build = (b, rng) => {
  plinth(b);
  wallArms(b, rng, 0, [0, 1, 2, 3], 0.6);
  pier(b, rng, undefined);
};

const wallGatehouse: Build = (b, rng) => {
  plinth(b);
  wallRun(b, rng, -HALF, -1.3, 0, false);
  wallRun(b, rng, 1.3, HALF, 0, false);
  const holeW = 1.5, holeH = 2.1, depth = 1.4, top = 3.0;
  b.add(archedWallGeo(-1.3, 1.3, top, depth, holeW, holeH), null, S.stone());
  b.block(2.6, 0.14, depth + 0.16, 0, top - 0.2, 0, S.stone(C.stoneLight));
  for (const side of [1, -1]) merlons(b, -0.9, 0.9, top, side * (depth / 2 - 0.09), 0.18);
  b.block(holeW, 0.06, depth + 0.6, 0, 0, 0, S.paving(C.stoneLight));
  for (const side of [1, -1]) {
    const ry = side > 0 ? 0 : Math.PI;
    b.add(archFrameGeo(holeW, holeH, 0.22, 0.14), mat4(0, 0, side * (depth / 2 - 0.04), ry), S.stone(C.stoneLight));
    lantern(b, side * 0.9, 1.4, depth / 2, 0);
    lantern(b, side * 0.9, 1.4, -depth / 2, Math.PI);
  }
  // raised portcullis
  for (let i = -3; i <= 3; i++) b.block(0.05, 0.9, 0.05, i * 0.2, 1.35, 0, S.iron());
  for (const y of [1.55, 1.95]) b.box(1.4, 0.05, 0.05, 0, y, 0, S.iron());
  for (let i = -3; i <= 3; i++) b.cone(0.04, 0.12, 4, i * 0.2, 1.23, 0, S.iron(), 0);
  // twin turrets
  const r = 0.75;
  for (const x of [-1.3, 1.3]) {
    b.cyl(r, r + 0.12, 0.4, 12, x, 0, 0, S.stone(C.stoneDark));
    b.cyl(r, r, 3.6, 12, x, 0, 0, S.stone());
    b.cyl(r + 0.15, r, 0.25, 12, x, 3.5, 0, S.stone(C.stoneLight));
    b.cone(r + 0.28, 1.9, 12, x, 3.75, 0, S.roof());
    finial(b, x, 5.6, 0, 1.2);
    for (const side of [1, -1]) {
      const ry = side > 0 ? 0 : Math.PI;
      gothicWindow(b, x, 2.45, side * r, ry, 0.22, 0.5);
      banner(b, x, 2.15, side * r, ry, 0.42, 1.4, x > 0 ? 0 : 3, x > 0 ? 0 : 1);
    }
  }
};

// --- bridges ----------------------------------------------------------------------

const DECK = 0.16;

function canalBase(b: GeoBuilder) {
  b.block(4, 0.1, 4, 0, BASE_Y, 0, S.stone(C.stoneDark));
  b.addWater(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2), mat4(0, -0.28, 0));
}

const canalBridge: Build = (b, rng) => {
  canalBase(b);
  const hump = 0.55, depth = 1.8;
  b.add(bridgeGeo(HALF, BASE_Y, DECK, hump, depth, 2.6, 1.45), null, S.stone());
  b.add(humpBandGeo(HALF, DECK, hump, 0.04, depth - 0.3), null, S.paving());
  for (const side of [1, -1]) {
    const z = side * (depth / 2 - 0.1);
    b.add(humpBandGeo(HALF, DECK, hump, 0.12, 0.22), mat4(0, 0, z), S.stone(C.stoneLight));
    b.add(humpBandGeo(HALF, DECK + 0.44, hump, 0.08, 0.24), mat4(0, 0, z), S.stone(C.stoneLight));
    for (let x = -1.6; x <= 1.61; x += 0.32) b.block(0.08, 0.32, 0.08, x, humpY(x, HALF, DECK, hump) + 0.12, z, S.stone(C.stoneLight));
    for (const x of [-1.88, 1.88]) {
      b.block(0.28, 0.7, 0.28, x, DECK - 0.02, z, S.stone());
      if (x * side > 0) {
        b.block(0.14, 0.2, 0.14, x, DECK + 0.68, z, S.flame());
        b.cone(0.14, 0.14, 4, x, DECK + 0.88, z, S.iron(), Math.PI / 4);
      } else finial(b, x, DECK + 0.68, z, 0.8);
    }
    b.add(archFrameGeo(2.6, 1.45, 0.14, 0.06), mat4(0, BASE_Y, side * (depth / 2), side > 0 ? 0 : Math.PI), S.stone(C.stoneLight));
    if (rng() < 0.7) ivy(b, rng, range(rng, -1.6, 1.6), -0.3, side * (depth / 2 + 0.02), side > 0 ? 0 : Math.PI, 0.6, 0.6, 2);
  }
};

const coveredBridge: Build = (b) => {
  canalBase(b);
  const depth = 1.9;
  b.add(bridgeGeo(HALF, BASE_Y, DECK, 0, depth, 2.6, 1.05), null, S.stone());
  for (const side of [1, -1]) b.add(archFrameGeo(2.6, 1.05, 0.14, 0.06), mat4(0, BASE_Y, side * (depth / 2), side > 0 ? 0 : Math.PI), S.stone(C.stoneLight));
  const y0 = DECK;
  b.block(4, 0.05, 1.7, 0, y0, 0, S.wood());
  const posts = [-1.9, -0.95, 0, 0.95, 1.9];
  for (const side of [1, -1]) {
    const z = side * 0.85;
    const ry = side > 0 ? 0 : Math.PI;
    for (const x of posts) b.block(0.14, 2.0, 0.14, x, y0, z, S.wood(C.woodDark));
    for (let i = 0; i < 4; i++) {
      const cx = (posts[i] + posts[i + 1]) / 2;
      b.block(0.8, 0.55, 0.06, cx, y0, z, S.wood());
      gothicWindow(b, cx, y0 + 0.72, z, ry, 0.56, 1.05, false, C.wood);
    }
    b.block(4, 0.16, 0.2, 0, y0 + 1.9, z, S.wood(C.woodDark));
    b.block(4, 0.1, 0.2, 0, y0 + 0.55, z, S.wood(C.woodDark));
  }
  b.with(up(y0 + 2.05), () => gableRoof(b, -HALF, HALF, 1.2, 1.15, { ovMin: 0.1, ovMax: 0.1 }));
  for (const x of [-1, 1]) hangingLantern(b, x, y0 + 2.05, 0);
  for (const x of [-HALF, HALF]) finial(b, x, y0 + 3.25, 0, 1);
};

// --- cloisters ----------------------------------------------------------------------

const AH = 2.2; // arcade wall height
const AZ = 1.0; // half width of the walkway
const AROOF_HW = 1.28;
const AROOF_H = 1.0;

/** One side of a cloister walkway along X from x0 to x1 at z. */
function arcadeSide(b: GeoBuilder, x0: number, x1: number, z: number, style: number) {
  const len = x1 - x0;
  const n = Math.max(1, Math.round(len));
  const cx = (x0 + x1) / 2;
  if (style === 0) {
    b.add(arcadeWallGeo(x0, x1, AH, 0.24, n, 0.64, 1.6), mat4(0, 0, z), S.stone());
    b.block(len, 0.1, 0.34, cx, AH - 0.1, z, S.stone(C.stoneLight));
    b.block(len, 0.12, 0.32, cx, 0, z, S.stone(C.stoneDark));
    return;
  }
  // timber gallery: posts, top beam, braces and a balustrade
  const pitch = len / n;
  for (let i = 0; i <= n; i++) b.block(0.14, AH, 0.14, x0 + pitch * i, 0, z, S.wood(C.woodDark));
  b.block(len, 0.16, 0.18, cx, AH - 0.16, z, S.wood(C.woodDark));
  for (let i = 0; i < n; i++) {
    const bx = x0 + pitch * (i + 0.5);
    for (const s of [-1, 1]) b.add(boxGeo(0.06, 0.45, 0.08), mat4(bx + s * pitch * 0.32, AH - 0.38, z, 0, 0, s * 0.8), S.wood());
  }
  b.block(len, 0.06, 0.1, cx, 0.78, z, S.wood());
  for (let x = x0 + 0.1; x < x1 - 0.05; x += 0.2) b.block(0.04, 0.72, 0.04, x, 0.06, z, S.wood());
}

function cloister(arms: number[], pavilion = false): Build {
  return (b, rng, style) => {
    plinth(b);
    const has = (d: number) => arms.includes(d);
    if (arms.length === 2 && has(0) && has(2)) {
      for (const z of [AZ, -AZ]) arcadeSide(b, -HALF, HALF, z, style);
    } else {
      for (let d = 0; d < 4; d++)
        b.with(rotY(d), () => {
          if (has(d)) for (const z of [AZ, -AZ]) arcadeSide(b, AZ, HALF, z, style);
          else b.with(mat4(AZ, 0, 0, Math.PI / 2), () => arcadeSide(b, -AZ, AZ, 0, style));
        });
      const corner = style === 0 ? S.stone(C.stoneLight) : S.wood(C.woodDark);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.block(0.32, AH, 0.32, x * AZ, 0, z * AZ, corner);
    }
    b.with(up(AH), () => roofJunction(b, arms, AROOF_HW, AROOF_H));
    hangingLantern(b, 0, AH, 0);
    if (pavilion) {
      // a quiet end: stone bench, potted cypress and a reading lectern
      b.block(1.1, 0.1, 0.36, -0.3, 0.38, 0, S.stone(C.stoneLight), Math.PI / 2);
      for (const dz of [-0.4, 0.4]) b.block(0.3, 0.38, 0.14, -0.3, 0, dz, S.stone(), Math.PI / 2);
      cypress(b, rng, -1.55, 1.5, 0.8);
      cypress(b, rng, -1.55, -1.5, 0.8);
      b.cyl(0.05, 0.07, 0.9, 6, 0.45, 0, 0, S.wood(C.woodDark));
      b.add(boxGeo(0.4, 0.04, 0.3), mat4(0.45, 0.92, 0, 0, 0, 0.35), S.wood());
      candle(b, 0.6, 0.94, 0.1, 0.18);
    }
  };
}

// --- special gardens ------------------------------------------------------------------

const maze: Build = (b, rng, style) => {
  grassBase(b);
  const N = 5, cell = 0.7, o = -(N * cell) / 2;
  // recursive backtracker over an N x N grid; walls[x][z] = [east, south]
  const east = Array.from({ length: N }, () => Array(N).fill(true));
  const south = Array.from({ length: N }, () => Array(N).fill(true));
  const seen = Array.from({ length: N }, () => Array(N).fill(false));
  const stack: [number, number][] = [[2, 2]];
  seen[2][2] = true;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const opts = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).filter(([dx, dz]) => {
      const nx = x + dx, nz = z + dz;
      return nx >= 0 && nx < N && nz >= 0 && nz < N && !seen[nx][nz];
    });
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const [dx, dz] = pick(rng, opts);
    if (dx === 1) east[x][z] = false;
    if (dx === -1) east[x - 1][z] = false;
    if (dz === 1) south[x][z] = false;
    if (dz === -1) south[x][z - 1] = false;
    seen[x + dx][z + dz] = true;
    stack.push([x + dx, z + dz]);
  }
  const hedge = S.leaf(C.hedge, 0);
  const H = 0.48, T = 0.18;
  for (let x = 0; x < N; x++)
    for (let z = 0; z < N; z++) {
      if (east[x][z] && x < N - 1) b.block(T, H, cell + T, o + (x + 1) * cell, 0, o + (z + 0.5) * cell, hedge);
      if (south[x][z] && z < N - 1) b.block(cell + T, H, T, o + (x + 0.5) * cell, 0, o + (z + 1) * cell, hedge);
    }
  // outer ring with an entrance in the middle of each side
  for (let i = 0; i < N; i++) {
    if (i === 2) continue;
    const p = o + (i + 0.5) * cell;
    for (const e of [o, -o]) {
      b.block(cell + T, H, T, p, 0, e, hedge);
      b.block(T, H, cell + T, e, 0, p, hedge);
    }
  }
  b.block(N * cell, 0.02, N * cell, 0, 0, 0, S.paving(C.stoneLight));
  if (style === 0) {
    b.block(0.3, 0.5, 0.3, 0, 0, 0, S.stone(C.stoneLight));
    b.add(torusGeo(0.22, 0.02), mat4(0, 0.78, 0), S.gold());
    b.add(torusGeo(0.22, 0.02), mat4(0, 0.78, 0, 0.6, Math.PI / 2), S.gold());
    b.add(sphereGeo(0.07, 1), mat4(0, 0.78, 0), { color: C.magic, mat: MAT.magic, emi: 2.5, flick: 0.3 });
  } else {
    b.cyl(0.32, 0.34, 0.25, 8, 0, 0, 0, S.stone(C.stoneLight));
    b.addWater(cylGeo(0.28, 0.28, 0.02, 12), mat4(0, 0.24, 0));
    b.cyl(0.05, 0.07, 0.45, 6, 0, 0.2, 0, S.stone());
  }
  for (const [x, z] of [[1.95, 1.95], [-1.95, -1.95]]) cypress(b, rng, x * 0.94, z * 0.94, 0.8);
};

const greatTree: Build = (b, rng, style) => {
  grassBase(b);
  // trunk, roots and limbs
  b.cyl(0.28, 0.48, 2.3, 8, 0, 0, 0, S.wood(C.trunk));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rng();
    b.add(boxGeo(0.7, 0.16, 0.2), mat4(Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5, -a, 0, -0.25), S.wood(C.trunk));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng();
    b.add(cylGeo(0.07, 0.14, 1.3, 5), mat4(Math.cos(a) * 0.45, 2.3, Math.sin(a) * 0.45, 0, Math.sin(a) * 0.8, -Math.cos(a) * 0.8), S.wood(C.trunk));
  }
  const wisteria = style === 1;
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const rr = range(rng, 0, 1.35);
    const r = range(rng, 0.55, 0.9);
    const color = wisteria && rng() < 0.45 ? pick(rng, [C.flowers[0], C.flowers[3]]) : pick(rng, C.leaf);
    b.add(sphereGeo(1, 1), mat4(Math.cos(a) * rr, range(rng, 2.5, 3.6), Math.sin(a) * rr, rng() * 6, 0, 0, r, r * 0.8, r), S.leaf(color, 0.03));
  }
  if (wisteria) {
    for (let i = 0; i < 16; i++) {
      const a = rng() * Math.PI * 2, rr = range(rng, 0.9, 1.6);
      b.add(sphereGeo(1, 0), mat4(Math.cos(a) * rr, range(rng, 2.0, 2.5), Math.sin(a) * rr, 0, 0, 0, 0.09, 0.32, 0.09), S.leaf(pick(rng, [C.flowers[0], C.flowers[3]]), 0.05));
    }
  }
  // hanging lanterns in the branches
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4, rr = 1.05;
    const sw = { sway: 0.05, swayDir: new THREE.Vector3(1, 0, 0) };
    b.add(boxGeo(0.015, 0.4, 0.015), mat4(Math.cos(a) * rr, 2.25, Math.sin(a) * rr), { ...S.iron(), ...sw });
    b.add(boxGeo(0.12, 0.17, 0.12), mat4(Math.cos(a) * rr, 1.98, Math.sin(a) * rr), { ...S.flame(), ...sw });
  }
  // ring bench + flower bed
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    b.block(0.72, 0.08, 0.3, Math.cos(a) * 1.15, 0.36, Math.sin(a) * 1.15, S.stone(C.stoneLight), outward(a));
    b.block(0.14, 0.36, 0.24, Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15, S.stone(), outward(a));
  }
  b.cyl(0.75, 0.8, 0.12, 12, 0, 0, 0, S.stone(C.stoneDark));
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2, rr = range(rng, 0.5, 0.72);
    b.add(sphereGeo(0.07, 0), mat4(Math.cos(a) * rr, 0.16, Math.sin(a) * rr), S.leaf(pick(rng, C.flowers), 0));
  }
};

const CRYSTAL_COLORS = ['#b48cff', '#8fc8ff'];

const crystals: Build = (b, rng, style) => {
  grassBase(b);
  const color = CRYSTAL_COLORS[style % 2];
  const glow = { color, mat: MAT.magic, emi: 0.75, flick: 0.35 };
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, rr = range(rng, 0.4, 1.5);
    const s = range(rng, 0.25, 0.5);
    b.add(dodecaGeo(1), mat4(Math.cos(a) * rr, s * 0.3, Math.sin(a) * rr, rng() * 6, 0, 0, s, s * 0.7, s), S.stone('#6f6478'));
  }
  const cluster = (cx: number, cz: number, scale: number) => {
    b.add(new THREE.OctahedronGeometry(1, 0), mat4(cx, 0.75 * scale, cz, rng(), 0, 0, 0.26 * scale, 0.95 * scale, 0.26 * scale), glow);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rng();
      const h = range(rng, 0.35, 0.65) * scale;
      b.add(new THREE.OctahedronGeometry(1, 0), mat4(cx + Math.cos(a) * 0.22 * scale, h * 0.7, cz + Math.sin(a) * 0.22 * scale, a, Math.sin(a) * 0.5, -Math.cos(a) * 0.5, 0.13 * scale, h, 0.13 * scale), glow);
    }
  };
  cluster(0, 0, 1.3);
  cluster(range(rng, 0.9, 1.3), range(rng, -1.3, -0.8), 0.6);
  cluster(range(rng, -1.4, -0.9), range(rng, 0.6, 1.2), 0.5);
  // floating motes
  for (let i = 0; i < 9; i++) {
    const a = rng() * Math.PI * 2, rr = range(rng, 0.5, 1.7);
    b.add(sphereGeo(0.04, 0), mat4(Math.cos(a) * rr, range(rng, 0.8, 2.4), Math.sin(a) * rr), { ...glow, emi: 1.8, sway: 0.15, swayDir: new THREE.Vector3(0, 1, 0) });
  }
  for (let i = 0; i < 3; i++) bush(b, rng, range(rng, -1.6, 1.6), range(rng, -1.6, 1.6), 0.7, 0, true);
};

function owl(b: GeoBuilder, x: number, y: number, z: number, ry: number) {
  b.at(x, y, z, ry, () => {
    const st = S.stone(C.stoneLight);
    b.add(sphereGeo(1, 1), mat4(0, 0.42, 0, 0, 0, 0, 0.3, 0.42, 0.27), st);
    b.add(sphereGeo(1, 1), mat4(0, 0.9, 0.02, 0, 0, 0, 0.24, 0.21, 0.22), st);
    for (const sx of [-1, 1]) {
      b.add(cylGeo(0, 0.06, 0.18, 4), mat4(sx * 0.14, 1.1, 0, 0, 0, -sx * 0.35), st);
      b.add(sphereGeo(0.055, 1), mat4(sx * 0.09, 0.93, 0.2), { color: '#ffb347', mat: MAT.plain, emi: 2.2, flick: 0.2 });
      b.add(sphereGeo(1, 1), mat4(sx * 0.26, 0.42, -0.03, 0, 0, sx * 0.22, 0.1, 0.33, 0.22), S.stone());
    }
    b.add(cylGeo(0, 0.04, 0.1, 4), mat4(0, 0.84, 0.23, 0, Math.PI), S.gold());
    b.block(0.32, 0.06, 0.22, 0, 0, 0.04, S.stone());
  });
}

const shrine: Build = (b, rng, style) => {
  b.block(4, 0.02 - BASE_Y, 4, 0, BASE_Y, 0, S.paving());
  b.cyl(1.25, 1.35, 0.16, 12, 0, 0, 0, S.stone(C.stoneLight));
  // pedestal + owl
  b.block(0.75, 0.9, 0.75, 0, 0.16, 0, S.stone());
  b.block(0.85, 0.1, 0.85, 0, 1.06, 0, S.stone(C.stoneLight));
  b.add(archFrameGeo(0.18, 0.32, 0.03, 0.02), mat4(0, 0.35, 0.38), { color: C.glass, mat: MAT.glass, emi: 1.6, flick: 0.3 });
  owl(b, 0, 1.16, 0, rng() * 0.6 - 0.3);
  ivy(b, rng, 0.2, 0.16, 0.39, 0, 0.5, 0.85, 2);
  if (style === 0) {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      for (let k = 0; k < 3; k++) candle(b, Math.cos(a) * 1.05 + range(rng, -0.12, 0.12), 0.16, Math.sin(a) * 1.05 + range(rng, -0.12, 0.12), range(rng, 0.15, 0.35));
    }
  } else {
    // candle altar along one side, like the reference balustrade
    b.block(2.2, 0.55, 0.45, 0, 0, -1.55, S.stone());
    b.block(2.3, 0.08, 0.55, 0, 0.55, -1.55, S.stone(C.stoneLight));
    for (let i = 0; i < 4; i++) b.add(archFrameGeo(0.2, 0.28, 0.03, 0.02), mat4(-0.75 + i * 0.5, 0.1, -1.32), { color: C.glass, mat: MAT.glass, emi: 1.4, flick: 0.4 });
    for (let i = 0; i < 7; i++) candle(b, -0.95 + i * 0.32, 0.63, -1.55 + range(rng, -0.1, 0.1), range(rng, 0.15, 0.4));
    ivy(b, rng, 0.8, 0, -1.32, 0, 0.6, 0.55, 2, true);
  }
  // floating candles
  for (let i = 0; i < 10; i++) {
    const a = rng() * Math.PI * 2, rr = range(rng, 0.7, 1.6);
    candle(b, Math.cos(a) * rr, range(rng, 1.5, 2.6), Math.sin(a) * rr, range(rng, 0.18, 0.32), 0.07);
  }
  for (const [x, z] of [[1.6, 1.6], [-1.6, 1.6]]) bush(b, rng, x, z, 0.9);
};

// --- neighbour-aware decor -------------------------------------------------------------

/** Cloister stub bridging a round/square tower to a cloister arriving on +X. */
function towerCloisterStub(style: number): Build {
  return (b) => {
    for (const z of [AZ, -AZ]) arcadeSide(b, 1.0, HALF, z, style);
    b.with(up(AH), () => gableRoof(b, 1.0, HALF, AROOF_HW, AROOF_H));
  };
}

/** Short cloister extension past the cell edge so it meets a hall facade on +X. */
function cloisterToHall(style: number): Build {
  return (b) => {
    const mat = style === 0 ? S.stone() : S.wood(C.woodDark);
    for (const z of [AZ, -AZ]) b.block(0.44, AH, 0.24, HALF + 0.22, 0, z, mat);
    b.with(up(AH), () => gableRoof(b, HALF, HALF + 0.45, AROOF_HW, AROOF_H));
  };
}

register({
  ...hallJunctions,
  sqTowerBase,
  sqTowerMid,
  sqTowerRoof,
  wallCross,
  wallGatehouse,
  canalBridge,
  coveredBridge,
  arcade: cloister([0, 2]),
  arcadeCorner: cloister([0, 1]),
  arcadeT: cloister([0, 1, 2]),
  arcadeEnd: cloister([0], true),
  maze,
  greatTree,
  crystals,
  shrine,
});

// decor builders take the neighbour's style as their style index
register({
  towerCloisterStub: (b, rng, style) => towerCloisterStub(style)(b, rng, style),
  cloisterToHall: (b, rng, style) => cloisterToHall(style)(b, rng, style),
});
