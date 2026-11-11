import * as THREE from 'three';
import { CELL_H, CELL_W, RNG } from '../config';
import { Build, register } from './registry';
import { GeoBuilder, MAT, cylGeo, mat4, sphereGeo, boxGeo } from './builder';
import {
  C, S, archFrameGeo, archedWallGeo, banner, bush, cypress, door, finial, gableRoof, gothicWindow, ivy, ivyCyl,
  lampPost, lantern, merlons, outward, pick, pinnacle, range, torusGeo, tree, dormer, balcony, pennant,
} from './parts';

/**
 * Procedural geometry for every module. Local frame: origin at the cell's
 * bottom-centre, cell spans x,z in [-2, 2] and y in [0, 3] (roofs may overflow
 * into the air cell above). Sockets on +X are built along +X, then rotated.
 */

export const HALF = CELL_W / 2;
export const WALL_H = 2.3;
export const WALL_T = 1.0;
export const TOWER_R = 1.5;
export const HALL_HW = 1.6;
export const HALL_H = 3.0;


// Every ground tile is a little diorama block reaching down to BASE_Y,
// so canals (which dip below 0) sit inside a continuous ground slab.
export const BASE_Y = -1.0;

export function plinth(b: GeoBuilder) {
  b.block(CELL_W, 0.05 - BASE_Y, CELL_W, 0, BASE_Y, 0, S.paving());
}

export function grassBase(b: GeoBuilder) {
  b.block(CELL_W, -0.3 - BASE_Y, CELL_W, 0, BASE_Y, 0, S.stone(C.stoneDark));
  b.block(CELL_W, 0.3, CELL_W, 0, -0.3, 0, S.grass());
}

// --- walls -------------------------------------------------------------------

/** Straight run of crenellated wall along X, faces at z = +-WALL_T/2. */
export function wallRun(b: GeoBuilder, rng: RNG, x0: number, x1: number, style: number, windows = true, parapet = true) {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  b.block(len, 0.35, WALL_T + 0.24, cx, 0, 0, S.stone(C.stoneDark));
  b.block(len, WALL_H, WALL_T, cx, 0, 0, S.stone());
  b.block(len, 0.12, WALL_T + 0.14, cx, WALL_H - 0.18, 0, S.stone(C.stoneLight));
  b.block(len, 0.04, WALL_T - 0.3, cx, WALL_H, 0, S.paving());
  if (parapet) for (const side of [1, -1]) merlons(b, x0, x1, WALL_H, side * (WALL_T / 2 - 0.09), 0.18);
  // decorative arch frieze under the parapet (like the reference wall sheet)
  const n = Math.max(1, Math.round(len / 0.5));
  for (const side of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const x = x0 + (len / n) * (i + 0.5);
      b.add(archFrameGeo(0.22, 0.2, 0.04, 0.04), mat4(x, WALL_H - 0.45, side * (WALL_T / 2), side > 0 ? 0 : Math.PI), S.stone(C.stoneLight));
    }
  }
  if (!windows || len < 1.5) return;
  for (const side of [1, -1]) {
    const ry = side > 0 ? 0 : Math.PI;
    const z = side * (WALL_T / 2);
    if (style === 0) {
      for (const f of [0.3, 0.7]) gothicWindow(b, x0 + len * f, 0.9, z, ry, 0.3, 0.75);
    } else if (style === 1) {
      const k = len > 3 ? 3 : 2;
      for (let i = 0; i < k; i++) gothicWindow(b, x0 + (len / k) * (i + 0.5), 0.6, z, ry, 0.5, 1.15, rng() < 0.15);
    } else {
      gothicWindow(b, cx + (side > 0 ? 0.7 : -0.7), 0.7, z, ry, 0.45, 1.0);
      if (side > 0) banner(b, cx - 0.6, WALL_H - 0.3, z, ry, 0.5, 1.4, Math.floor(rng() * 4), Math.floor(rng() * 2));
      else lantern(b, cx + 0.2, 1.3, z, ry);
    }
    if (rng() < 0.6) ivy(b, rng, x0 + len * range(rng, 0.15, 0.85), 0.1, z + 0.02 * side, ry, 0.8, WALL_H - 0.2, 2, rng() < 0.4);
  }
}

/** Square pier where walls meet. */
export function pier(b: GeoBuilder, rng: RNG, bannerSide?: number) {
  const s = 1.3;
  b.block(s + 0.2, 0.4, s + 0.2, 0, 0, 0, S.stone(C.stoneDark));
  b.block(s, 2.9, s, 0, 0, 0, S.stone());
  b.block(s + 0.14, 0.14, s + 0.14, 0, 2.9, 0, S.stone(C.stoneLight));
  b.cone(0.98, 1.0, 4, 0, 3.04, 0, S.roof(), Math.PI / 4);
  finial(b, 0, 3.95, 0, 1.2);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pinnacle(b, (dx * s) / 2, 3.04, (dz * s) / 2, 0.18, 0.2);
  if (bannerSide !== undefined) {
    const a = -bannerSide * (Math.PI / 2); // direction index -> angle on xz circle
    banner(b, Math.cos(a) * (s / 2), 2.75, Math.sin(a) * (s / 2), outward(a), 0.55, 1.7, Math.floor(rng() * 4), Math.floor(rng() * 2));
  }
}

export function wallArms(b: GeoBuilder, rng: RNG, style: number, arms: number[], from: number) {
  for (const d of arms) b.with(mat4(0, 0, 0, (d * Math.PI) / 2), () => wallRun(b, rng, from, HALF, style));
}

const wall: Build = (b, rng, style) => {
  plinth(b);
  wallRun(b, rng, -HALF, HALF, style);
};

const wallGate: Build = (b, rng) => {
  plinth(b);
  const holeW = 1.6, holeH = 2.0;
  b.add(archedWallGeo(-HALF, HALF, WALL_H, WALL_T, holeW, holeH), null, S.stone());
  b.block(CELL_W, 0.12, WALL_T + 0.14, 0, WALL_H - 0.18, 0, S.stone(C.stoneLight));
  for (const side of [1, -1]) merlons(b, -HALF, HALF, WALL_H, side * (WALL_T / 2 - 0.09), 0.18);
  b.block(holeW, 0.06, WALL_T + 0.6, 0, 0.0, 0, S.paving(C.stoneLight));
  for (const side of [1, -1]) {
    const ry = side > 0 ? 0 : Math.PI;
    const z = side * (WALL_T / 2);
    b.add(archFrameGeo(holeW, holeH, 0.2, 0.14), mat4(0, 0, z - side * 0.04, ry), S.stone(C.stoneLight));
    // glowing runes around the arch
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const ang = Math.PI * (1 - t);
      const x = Math.cos(ang) * (holeW / 2 + 0.32);
      const y = holeH * 0.55 + Math.sin(ang) * (holeH * 0.5);
      b.add(boxGeo(0.12, 0.12, 0.03), mat4(x, y, z + side * 0.11, ry, 0, Math.PI / 4 + i), S.magic());
    }
    lantern(b, side * 1.35, 1.25, z, ry);
    if (rng() < 0.5) ivy(b, rng, -side * 1.5, 0.1, z + side * 0.02, ry, 0.6, 2, 2, true);
  }
  // portcullis teeth peeking from the top of the arch
  for (let i = -3; i <= 3; i++) b.block(0.05, 0.35, 0.05, i * 0.2, holeH - 0.55 + Math.abs(i) * -0.03, 0, S.iron());
};

const wallCorner: Build = (b, rng, style) => {
  plinth(b);
  wallArms(b, rng, style, [0, 1], 0.6);
  pier(b, rng, style === 1 ? 3 : undefined);
};

const wallT: Build = (b, rng) => {
  plinth(b);
  wallArms(b, rng, 0, [0, 1, 2], 0.6);
  pier(b, rng, 3);
};

const wallEnd: Build = (b, rng) => {
  plinth(b);
  wallArms(b, rng, 0, [0], 0.4);
  const r = 0.85;
  b.cyl(r, r + 0.15, 0.4, 12, 0, 0, 0, S.stone(C.stoneDark));
  b.cyl(r, r, 3.0, 12, 0, 0, 0, S.stone());
  b.cyl(r + 0.12, r, 0.25, 12, 0, 2.9, 0, S.stone(C.stoneLight));
  b.cone(r + 0.25, 1.8, 12, 0, 3.15, 0, S.roof());
  finial(b, 0, 4.9, 0, 1.2);
  for (const a of [Math.PI / 2, Math.PI, -Math.PI / 2]) gothicWindow(b, Math.cos(a) * r, 1.6, Math.sin(a) * r, outward(a), 0.24, 0.55);
  ivyCyl(b, rng, r, rng() * 6, 0.1, 2.2);
};

// --- towers ------------------------------------------------------------------

const towerBase: Build = (b, rng, style) => {
  plinth(b);
  b.cyl(TOWER_R, TOWER_R + 0.25, 0.6, 16, 0, 0, 0, S.stone(C.stoneDark));
  b.cyl(TOWER_R, TOWER_R, CELL_H, 16, 0, 0, 0, S.stone());
  b.cyl(TOWER_R + 0.08, TOWER_R + 0.08, 0.12, 16, 0, 2.86, 0, S.stone(C.stoneLight));
  // doors and wall joints are neighbour-aware decor (see World.rebuildDecor);
  // windows sit on the diagonals so they never collide with a door
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4]) gothicWindow(b, Math.cos(a) * TOWER_R, 1.4, Math.sin(a) * TOWER_R, outward(a), 0.4, 0.85);
  if (style === 1) {
    ivyCyl(b, rng, TOWER_R, Math.PI + range(rng, -0.6, 0.6), 0.2, 2.6, 0.6);
    bush(b, rng, Math.cos(2.4) * 1.75, Math.sin(2.4) * 1.75, 1.2);
  }
};

const towerMid: Build = (b, rng, style) => {
  b.cyl(TOWER_R, TOWER_R, CELL_H, 16, 0, 0, 0, S.stone());
  b.cyl(TOWER_R + 0.08, TOWER_R + 0.08, 0.12, 16, 0, 2.86, 0, S.stone(C.stoneLight));
  const off = Math.PI / 4;
  for (let k = 0; k < 4; k++) {
    const a = off + (k * Math.PI) / 2;
    const purple = style === 2 && k === 1;
    gothicWindow(b, Math.cos(a) * TOWER_R, 0.9, Math.sin(a) * TOWER_R, outward(a), purple ? 0.6 : 0.42, purple ? 1.4 : 0.95, purple);
  }
  if (style === 1) banner(b, TOWER_R, 2.7, 0, outward(0), 0.6, 2.0, Math.floor(rng() * 4), Math.floor(rng() * 2));
  if (style === 2) ivyCyl(b, rng, TOWER_R, -Math.PI / 2 + range(rng, -0.5, 0.5), 0, 2.8, 0.5);
  if (style === 0 && rng() < 0.5) lantern(b, TOWER_R, 1.9, 0, outward(0));
};

const towerRoof: Build = (b, rng, style) => {
  // corbelled eave ring
  b.cyl(TOWER_R + 0.22, TOWER_R, 0.35, 16, 0, 0, 0, S.stone(C.stoneLight));
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.block(0.14, 0.3, 0.18, Math.cos(a) * (TOWER_R + 0.06), -0.25, Math.sin(a) * (TOWER_R + 0.06), S.stone(C.stoneLight), outward(a));
  }
  const tall = style === 0;
  const h = tall ? 5.2 : 3.8;
  const r = TOWER_R + 0.4;
  b.cone(r, h, 16, 0, 0.3, 0, S.roof());
  b.cyl(r, r, 0.08, 16, 0, 0.26, 0, S.roof(C.roofDark));
  const nd = tall ? 3 : 4;
  for (let k = 0; k < nd; k++) {
    const a = (k / nd) * Math.PI * 2 + rng() * 0.3;
    const yd = 0.9;
    const rd = r * (1 - (yd + 0.2) / h);
    dormer(b, Math.cos(a) * rd, 0.3 + yd, Math.sin(a) * rd, outward(a), 1.1);
  }
  b.add(sphereGeo(0.16, 1), mat4(0, 0.3 + h + 0.05, 0), S.gold());
  b.cone(0.07, 0.9, 6, 0, 0.3 + h + 0.15, 0, S.gold());
  if (!tall) pennant(b, 0, 0.3 + h + 1.25, 0, 1.1, Math.floor(rng() * 4));
};

const towerCrown: Build = (b, rng, style) => {
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    b.block(0.16, 0.35, 0.22, Math.cos(a) * (TOWER_R + 0.06), 0, Math.sin(a) * (TOWER_R + 0.06), S.stone(C.stoneLight), outward(a));
  }
  b.cyl(TOWER_R + 0.22, TOWER_R + 0.22, 0.55, 16, 0, 0.3, 0, S.stone());
  b.cyl(TOWER_R, TOWER_R, 0.02, 16, 0, 0.85, 0, S.paving());
  const n = 14;
  for (let k = 0; k < n; k++) {
    const a = ((k + 0.5) / n) * Math.PI * 2;
    b.block(0.38, 0.45, 0.22, Math.cos(a) * (TOWER_R + 0.11), 0.85, Math.sin(a) * (TOWER_R + 0.11), S.stone(), outward(a));
  }
  if (style === 1) {
    // armillary sphere
    b.cyl(0.25, 0.32, 0.6, 8, 0, 0.85, 0, S.stone(C.stoneLight));
    const y = 1.85;
    b.add(torusGeo(0.5, 0.035), mat4(0, y, 0), S.gold());
    b.add(torusGeo(0.5, 0.035), mat4(0, y, 0, 0.5, Math.PI / 2), S.gold());
    b.add(torusGeo(0.44, 0.03), mat4(0, y, 0, 0, 0.4, 0.9), S.gold());
    b.add(cylGeo(0.02, 0.02, 1.3, 4), mat4(0, y, 0, 0, 0.4, 0.4), S.gold());
    b.add(sphereGeo(0.12, 1), mat4(0, y, 0), { color: C.magic, mat: MAT.magic, emi: 3, flick: 0.4 });
  } else {
    b.cyl(0.03, 0.03, 2.2, 5, 0.6, 0.85, 0, S.iron());
    banner(b, 0.6, 3.0, 0.04, outward(Math.PI / 2), 0.5, 0.9, Math.floor(rng() * 4), 0);
    lampPost(b, -0.5, 0.4, 0.85);
  }
};

// --- halls ---------------------------------------------------------------------

export function hallBody(b: GeoBuilder, rng: RNG, x0: number, x1: number, style: number, upper: boolean) {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  if (!upper) b.block(len, 0.35, HALL_HW * 2 + 0.22, cx, 0, 0, S.stone(C.stoneDark));
  else b.block(len, 0.16, HALL_HW * 2 + 0.12, cx, 0, 0, S.stone(C.stoneLight));
  b.block(len, HALL_H, HALL_HW * 2, cx, 0, 0, S.stone());
  b.block(len, 0.16, HALL_HW * 2 + 0.2, cx, HALL_H - 0.16, 0, S.stone(C.stoneLight));
  const winW = upper ? 0.6 : 0.78;
  const winH = upper ? 1.35 : 1.9;
  const winY = upper ? 0.75 : 0.55;
  for (const side of [1, -1]) {
    const ry = side > 0 ? 0 : Math.PI;
    const z = side * HALL_HW;
    const slots = len > 3 ? [-1, 1] : [0.2];
    slots.forEach((sx, i) => {
      const purple = style === 1 && (i + (side > 0 ? 0 : 1)) % 2 === 0;
      gothicWindow(b, cx + sx, winY, z, ry, winW, winH, purple);
    });
    // buttress between bays
    if (len > 3) {
      b.block(0.32, HALL_H - 0.3, 0.3, cx, 0, z + side * 0.15, S.stone(C.stoneLight));
      pinnacle(b, cx, HALL_H - 0.3, z + side * 0.15, 0.24, 0.3);
    }
    if (style === 1 && side > 0 && len > 3) banner(b, cx, HALL_H - 0.35, z + 0.3, ry, 0.45, 1.6, Math.floor(rng() * 4), Math.floor(rng() * 2));
    if (style === 3 && upper && side > 0) balcony(b, rng, cx + (len > 3 ? 1 : 0.2), winY - 0.08, z, ry, 1.3);
    if (style === 2 && !upper) {
      if (side > 0) lantern(b, cx, 1.5, z + 0.3, ry);
      ivy(b, rng, cx + range(rng, -1.4, 1.4), 0.1, z + side * 0.02, ry, 0.9, 2.6, 3, rng() < 0.5);
    }
  }
}

const hall: Build = (b, rng, style) => {
  plinth(b);
  hallBody(b, rng, -HALF, HALF, style, false);
};
const hallUpper: Build = (b, rng, style) => hallBody(b, rng, -HALF, HALF, style, true);

function hallEndBody(b: GeoBuilder, rng: RNG, style: number, upper: boolean) {
  const x0 = -HALL_HW - 0.1;
  hallBody(b, rng, x0, HALF, 0, upper);
  // gable end facade at x0 facing -X
  const big = !upper;
  gothicWindow(b, x0, big ? 0.55 : 0.6, 0, outward(Math.PI), big ? 1.3 : 1.0, big ? 2.15 : 1.6, style === 1);
  for (const sz of [1, -1]) {
    b.block(0.5, HALL_H + 0.1, 0.5, x0, 0, sz * HALL_HW, S.stone(C.stoneLight));
    pinnacle(b, x0, HALL_H + 0.1, sz * HALL_HW, 0.32, 0.35);
  }
  if (!upper) {
    if (style === 0) lantern(b, x0, 1.6, 1.0, outward(Math.PI));
    bush(b, rng, x0 - 0.5, -1.1, 1);
  }
}

const hallEnd: Build = (b, rng, style) => {
  plinth(b);
  hallEndBody(b, rng, style, false);
};
const hallEndUpper: Build = (b, rng, style) => hallEndBody(b, rng, style, true);

export const ROOF_H = 2.3;
export const ROOF_HW = HALL_HW + 0.05;

const hallRoof: Build = (b, _rng, style) => {
  gableRoof(b, -HALF, HALF, ROOF_HW, ROOF_H, { dormers: style === 0 ? [0] : style === 1 ? [-1, 1] : [] });
  if (style === 2) {
    // chimney stack
    b.block(0.5, 1.6, 0.5, 0.8, 0.9, 0.5, S.stone());
    b.block(0.62, 0.12, 0.62, 0.8, 2.5, 0.5, S.stone(C.stoneLight));
    for (const dx of [-0.12, 0.12]) b.cyl(0.07, 0.07, 0.35, 6, 0.8 + dx, 2.62, 0.5, S.stone('#b0705a'));
    b.emitter(0.8, 3.0, 0.5);
  }
};

const hallRoofEnd: Build = (b, rng, style) => {
  const x0 = -HALL_HW - 0.1;
  gableRoof(b, x0, HALF, ROOF_HW, ROOF_H, { ovMin: 0.22, dormers: [0.9] });
  // timber framed gable face
  const fx = x0 - 0.02;
  const sw = S.wood();
  b.add(boxGeo(0.06, ROOF_H * 0.95, 0.1), mat4(fx, ROOF_H * 0.47, 0), sw);
  const a = Math.atan2(ROOF_H, ROOF_HW);
  for (const sz of [1, -1]) {
    b.add(boxGeo(0.07, Math.hypot(ROOF_HW, ROOF_H) * 0.95, 0.1), mat4(fx - 0.04, ROOF_H / 2, (sz * ROOF_HW) / 2, 0, -sz * (Math.PI / 2 - a)), S.wood(C.woodDark));
    b.add(boxGeo(0.05, 0.9, 0.08), mat4(fx, 0.5, sz * 0.62, 0, -sz * 0.5), sw);
  }
  b.add(boxGeo(0.06, 0.08, ROOF_HW * 2), mat4(fx, 0.08, 0), sw);
  gothicWindow(b, fx, 0.55, 0, outward(Math.PI), 0.45, 0.8, style === 1);
  finial(b, x0 - 0.2, ROOF_H + 0.08, 0, 1.4);
  if (rng() < 0.5) finial(b, HALF - 0.05, ROOF_H + 0.1, 0, 0.9);
};

// --- ground --------------------------------------------------------------------

const grass: Build = (b, rng, style) => {
  grassBase(b);
  const r = (s: number) => range(rng, -s, s);
  // scattered tufts / flowers everywhere
  for (let i = 0; i < 6; i++) {
    const fc = pick(rng, C.flowers);
    b.add(sphereGeo(0.06, 0), mat4(r(1.8), 0.04, r(1.8)), S.leaf(fc, 0));
  }
  if (style === 0) {
    for (let i = 0; i < 3; i++) bush(b, rng, r(1.4), r(1.4), range(rng, 0.8, 1.3));
  } else if (style === 1) {
    tree(b, rng, r(0.4), r(0.4), range(rng, 0.95, 1.2));
    bush(b, rng, 1.3, -1.2, 1);
  } else if (style === 2) {
    // hedge parterre around a gravel cross
    const hs = S.leaf(C.hedge, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.block(1.3, 0.35, 0.22, x, 0, z * 1.55 - z * 0.0, hs);
      b.block(0.22, 0.35, 1.3, x * 1.55, 0, z, hs);
      b.block(0.9, 0.04, 0.9, x * 0.95, 0, z * 0.95, S.leaf('#55703a', 0));
      const fc = pick(rng, C.flowers);
      for (let i = 0; i < 7; i++) b.add(sphereGeo(0.07, 0), mat4(x * 0.95 + range(rng, -0.35, 0.35), 0.08, z * 0.95 + range(rng, -0.35, 0.35)), S.leaf(fc, 0));
    }
    b.block(4, 0.02, 0.5, 0, 0, 0, S.paving(C.stoneLight));
    b.block(0.5, 0.02, 4, 0, 0, 0, S.paving(C.stoneLight));
    cypress(b, rng, 0, 0, 0.9);
  } else if (style === 3) {
    cypress(b, rng, -1.2, -1.1, range(rng, 1, 1.4));
    cypress(b, rng, -0.6, -1.4, range(rng, 0.8, 1.1));
    lampPost(b, 1.1, 1.1);
    bush(b, rng, 1.2, -1, 1);
  } else {
    // stone bench + lantern + flowers
    b.block(1.1, 0.1, 0.4, 0.4, 0.35, 1.2, S.stone(C.stoneLight));
    for (const dx of [-0.4, 0.4]) b.block(0.15, 0.35, 0.35, 0.4 + dx, 0, 1.2, S.stone());
    tree(b, rng, -0.9, -0.6, 0.85);
    for (let i = 0; i < 4; i++) bush(b, rng, r(1.6), r(1.6), 0.7);
  }
};

const court: Build = (b, rng, style) => {
  b.block(CELL_W, 0.02 - BASE_Y, CELL_W, 0, BASE_Y, 0, S.paving());
  if (style === 0) {
    for (const [x, z] of [[-1.4, -1.4], [1.4, 1.4]]) {
      b.block(0.7, 0.35, 0.7, x, 0, z, S.stone(C.stoneLight));
      bush(b, rng, x, z, 0.9, 0.35);
    }
  } else if (style === 1) {
    // fountain
    b.cyl(1.15, 1.2, 0.45, 8, 0, 0, 0, S.stone(C.stoneLight));
    b.cyl(1.0, 1.0, 0.05, 8, 0, 0.42, 0, S.stone(C.stoneDark));
    b.addWater(cylGeo(0.98, 0.98, 0.02, 16), mat4(0, 0.4, 0));
    b.cyl(0.18, 0.25, 0.9, 8, 0, 0.45, 0, S.stone());
    b.cyl(0.55, 0.3, 0.18, 8, 0, 1.2, 0, S.stone(C.stoneLight));
    b.addWater(cylGeo(0.48, 0.48, 0.02, 12), mat4(0, 1.36, 0));
    b.cyl(0.08, 0.12, 0.45, 6, 0, 1.3, 0, S.stone());
    b.add(sphereGeo(0.12, 1), mat4(0, 1.8, 0), S.gold());
    // falling water sheets (sway gives a little shimmer)
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      b.add(boxGeo(0.035, 0.8, 0.035), mat4(Math.cos(a) * 0.52, 0.85, Math.sin(a) * 0.52, outward(a)), { color: '#9fd2ee', mat: MAT.plain, emi: 0.12, sway: 0.015 });
    }
  } else if (style === 2) {
    // armillary sphere on a pedestal
    b.block(0.9, 0.25, 0.9, 0, 0, 0, S.stone(C.stoneDark));
    b.block(0.6, 0.85, 0.6, 0, 0.25, 0, S.stone());
    for (const [ry, z] of [[0, 0.31], [Math.PI, -0.31]]) b.add(archFrameGeo(0.18, 0.3, 0.03, 0.02), mat4(0, 0.4, z, ry), { color: C.glass, mat: MAT.glass, emi: 1.8, flick: 0.2 });
    const y = 1.75;
    b.cyl(0.03, 0.08, 0.4, 6, 0, 1.1, 0, S.gold());
    b.add(torusGeo(0.42, 0.03), mat4(0, y, 0), S.gold());
    b.add(torusGeo(0.42, 0.03), mat4(0, y, 0, 0.8, Math.PI / 2), S.gold());
    b.add(torusGeo(0.36, 0.025), mat4(0, y, 0, 0, 0.45, 0.7), S.gold());
    b.add(cylGeo(0.015, 0.015, 1.1, 4), mat4(0, y, 0, 0, 0.45, 0.45), S.gold());
    b.add(sphereGeo(0.1, 1), mat4(0, y, 0), S.gold());
    for (let i = 0; i < 4; i++) bush(b, rng, (i % 2 ? 1 : -1) * 1.4, (i < 2 ? 1 : -1) * 1.4, 0.8);
  } else {
    lampPost(b, -1.3, -1.3);
    lampPost(b, 1.3, 1.3);
    b.block(1.1, 0.1, 0.4, -0.6, 0.35, 1.3, S.stone(C.stoneLight));
    for (const dx of [-0.4, 0.4]) b.block(0.15, 0.35, 0.35, -0.6 + dx, 0, 1.3, S.stone());
    cypress(b, rng, 1.3, -1.3, 1);
  }
};

const water: Build = (b, rng, style) => {
  b.block(CELL_W, 0.1, CELL_W, 0, BASE_Y, 0, S.stone(C.stoneDark));
  b.addWater(new THREE.PlaneGeometry(CELL_W, CELL_W).rotateX(-Math.PI / 2), mat4(0, -0.28, 0));
  if (style === 1) {
    for (let i = 0; i < 5; i++) {
      const x = range(rng, -1.4, 1.4), z = range(rng, -1.4, 1.4);
      b.cyl(0.2, 0.2, 0.02, 7, x, -0.27, z, S.leaf(pick(rng, C.leaf), 0.01));
      if (rng() < 0.5) b.add(sphereGeo(0.07, 0), mat4(x + 0.05, -0.22, z, 0, 0, 0, 1, 0.6, 1), { color: '#f0a0c8', mat: MAT.foliage, emi: 0.3 });
    }
  }
};

/** Decoration: tower entrance facing +X (placed on a side with walkable ground). */
const towerDoor: Build = (b) => {
  door(b, TOWER_R - 0.02, 0.02, 0, outward(0), 0.85, 1.5);
  for (let i = 0; i < 3; i++) b.block(0.5 - i * 0.14, 0.1, 1.3 - i * 0.12, TOWER_R + 0.38 - i * 0.07, i * 0.1 - 0.05, 0, S.paving(C.stoneLight));
  lantern(b, TOWER_R, 1.85, 0, outward(0));
};

/** Decoration: small door on a wall turret, facing +X. */
const turretDoor: Build = (b) => {
  door(b, 0.83, 0.02, 0, outward(0), 0.5, 0.95);
  b.block(0.3, 0.08, 0.8, 1.0, -0.03, 0, S.paving(C.stoneLight));
};

/** Decoration: wall stub bridging a tower to a wall arriving on its +X side. */
const towerWallStub: Build = (b, rng) => wallRun(b, rng, 1.0, HALF, 0, false);

/** Decoration: canal bank on +X side of a water cell. */
const bank: Build = (b) => {
  b.block(0.25, 1.1, CELL_W, HALF - 0.125, -1.0, 0, S.stone());
  b.block(0.34, 0.12, CELL_W, HALF - 0.17, 0.0, 0, S.paving(C.stoneLight));
};
/** Decoration: corner post at (+X,+Z) of a water cell. */
const bankCorner: Build = (b) => {
  b.block(0.25, 1.1, 0.25, HALF - 0.125, -1.0, HALF - 0.125, S.stone());
  b.block(0.34, 0.12, 0.34, HALF - 0.17, 0.0, HALF - 0.17, S.paving(C.stoneLight));
};

register({
  air: () => {},
  grass,
  court,
  water,
  wall,
  wallGate,
  wallCorner,
  wallT,
  wallEnd,
  towerBase,
  towerMid,
  towerRoof,
  towerCrown,
  hall,
  hallUpper,
  hallEnd,
  hallEndUpper,
  hallRoof,
  hallRoofEnd,
  bank,
  bankCorner,
  towerDoor,
  turretDoor,
  towerWallStub,
});
