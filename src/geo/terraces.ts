import * as THREE from 'three';
import { CELL_H } from '../config';
import { GeoBuilder, MAT, PartStyle, boxGeo, cylGeo, dodecaGeo, mat4, sphereGeo } from './builder';
import {
  C, S, archFrameGeo, banner, bush, cypress, door, finial, gableRoof, gothicWindow, hangingLantern, ivy, lampPost, lantern,
  outward, pick, pinnacle, prismGeo, range, roseWindow, tree,
} from './parts';
import { BASE_Y, HALF, HALL_H, HALL_HW, WALL_H, grassBase, hallBody, plinth, wallRun } from './modules';
import { Build, register } from './registry';

/**
 * Third wave: terraces and stairs (a second ground height), sky bridges and
 * wall galleries, chapels, and more gardens. Same local frame as modules.ts.
 */

const shapes = new Map<string, THREE.BufferGeometry>();
function shaped(key: string, make: () => THREE.BufferGeometry) {
  let g = shapes.get(key);
  if (!g) shapes.set(key, (g = make()));
  return g;
}

/** Thin beam between two points. */
function beam(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, t: number, style: PartStyle) {
  const dir = to.clone().sub(from);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  b.add(boxGeo(t, dir.length(), t), new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)), style);
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// --- terraces ----------------------------------------------------------------------

/**
 * A raised plateau. The solid stops one unit below the top (world y = 2), where
 * the base of whatever ground module sits on top takes over, so raised canals
 * keep their depth. Faces, parapets and waterfalls are neighbour-aware decor.
 */
const terrace: Build = (b) => {
  b.block(4, CELL_H - 1 - BASE_Y, 4, 0, BASE_Y, 0, S.stone(C.stoneDark));
  b.block(4.06, 0.14, 4.06, 0, 0.8, 0, S.stone());
  b.block(4.14, 0.16, 4.14, 0, CELL_H - 1.16, 0, S.stone(C.stoneLight));
};

/** Decor: retaining-wall face on the +X side of a terrace. */
const terraceFace: Build = (b, rng, style) => {
  const fx = HALF;
  for (const z of [-1.35, 1.35]) {
    b.block(0.32, CELL_H - 1.1 - BASE_Y, 0.4, fx + 0.12, BASE_Y, z, S.stone());
    b.cone(0.3, 0.35, 4, fx + 0.12, CELL_H - 1.1, z, S.stone(C.stoneLight), Math.PI / 4);
  }
  b.add(archFrameGeo(1.5, 1.7, 0.14, 0.08), mat4(fx, 0.0, 0, outward(0)), S.stone(C.stoneLight));
  if (style === 0) {
    door(b, fx, 0.02, 0, outward(0), 0.7, 1.15);
    lantern(b, fx, 1.6, 0.75, outward(0));
  } else {
    b.add(archFrameGeo(1.5, 1.7, 0.01, 0.01), mat4(fx + 0.005, 0, 0, outward(0)), S.stone(C.stoneDark));
    ivy(b, rng, fx + 0.03, -0.9, range(rng, -1, 1), outward(0), 1.4, 2.6, 4, rng() < 0.6);
  }
};

/** Decor: balustrade along the +X top edge of a terrace (level with the tile on top). */
const terraceParapet: Build = (b) => {
  const y = CELL_H, x = HALF - 0.14;
  b.block(0.24, 0.1, 4, x, y, 0, S.stone(C.stoneLight));
  b.block(0.26, 0.08, 4, x, y + 0.5, 0, S.stone(C.stoneLight));
  for (let z = -1.85; z <= 1.86; z += 0.22) b.block(0.07, 0.4, 0.07, x, y + 0.1, z, S.stone(C.stoneLight));
  for (const z of [-1.9, 1.9]) {
    b.block(0.3, 0.7, 0.3, x, y, z, S.stone());
    finial(b, x, y + 0.7, z, 0.7);
  }
};

/** Decor: waterfall pouring off the +X edge of a raised canal into the level below. */
const waterfall: Build = (b, rng) => {
  b.block(0.18, 0.12, 4, HALF - 0.09, -0.36, 0, S.stone(C.stoneLight));
  const fall: PartStyle = { color: '#bfe4ff', mat: MAT.fall, emi: 0.35, sway: 0.03 };
  for (let i = 0; i < 9; i++) {
    const z = -1.6 + i * 0.4 + range(rng, -0.05, 0.05);
    const w = range(rng, 0.32, 0.46);
    b.add(boxGeo(0.05, CELL_H - 0.25, w), mat4(HALF + 0.1 + range(rng, 0, 0.08), -0.28 - (CELL_H - 0.25) / 2, z), fall);
  }
  for (let i = 0; i < 14; i++) {
    const r = range(rng, 0.15, 0.3);
    b.add(sphereGeo(1, 0), mat4(HALF + range(rng, 0.15, 0.6), -CELL_H - 0.15, range(rng, -1.8, 1.8), 0, 0, 0, r, r * 0.5, r), { color: '#e8f6ff', mat: MAT.plain, emi: 0.4, sway: 0.03 });
  }
};

// --- grand stairs -------------------------------------------------------------------

/** Stairs climbing from open ground on -X up to a terrace on +X. */
const stairs: Build = (b, rng, style) => {
  plinth(b);
  const n = 12, run = 4 / n, rise = CELL_H / n;
  for (let i = 0; i < n; i++) {
    b.block(run + 0.01, (i + 1) * rise, 2.3, -HALF + run * (i + 0.5), 0, 0, S.paving(C.stoneLight));
    b.block(0.06, 0.04, 2.3, -HALF + run * (i + 1) - 0.03, (i + 1) * rise, 0, S.stone(C.stoneDark));
  }
  const wedge = shaped('stairWall', () => {
    const s = new THREE.Shape();
    s.moveTo(-HALF, 0);
    s.lineTo(HALF, 0);
    s.lineTo(HALF, CELL_H + 0.5);
    s.lineTo(-HALF, 0.5);
    s.lineTo(-HALF, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false });
    g.translate(0, 0, -0.15);
    return g;
  });
  const slope = Math.atan2(CELL_H, 4);
  for (const z of [-1.3, 1.3]) {
    b.add(wedge, mat4(0, 0, z), S.stone());
    b.add(boxGeo(5.0, 0.12, 0.4), mat4(0, (CELL_H + 1) / 2 + 0.06, z, 0, 0, slope), S.stone(C.stoneLight));
    b.block(0.44, 1.1, 0.44, -1.85, 0, z, S.stone(C.stoneLight));
    b.block(0.16, 0.24, 0.16, -1.85, 1.1, z, S.flame());
    b.cone(0.17, 0.18, 4, -1.85, 1.34, z, S.iron(), Math.PI / 4);
    b.block(0.44, 0.7, 0.44, 1.85, CELL_H, z, S.stone(C.stoneLight));
    finial(b, 1.85, CELL_H + 0.7, z, 0.9);
  }
  // planting either side of the flight
  for (const z of [-1.75, 1.75]) {
    b.block(4, 0.05, 0.45, 0, 0.05, z, S.grass());
    if (style === 0) for (const x of [-1.2, 0.2, 1.4]) cypress(b, rng, x, z, 0.7 + (x + 2) * 0.12);
    else for (const x of [-1, 0.6]) bush(b, rng, x, z, 0.8, 0.05);
  }
};

// --- galleries: sky bridges, wall galleries -------------------------------------------

/**
 * Covered gallery along X from x0 to x1, floor at deckY, half width hw.
 * style 0: timber with leaded windows; style 1: stone corridor.
 */
function galleryRun(b: GeoBuilder, x0: number, x1: number, deckY: number, hw: number, style: number) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  const wallH = 1.85;
  b.block(len, 0.16, hw * 2 + 0.2, cx, deckY - 0.16, 0, S.stone(C.stoneLight));
  b.block(len, 0.04, hw * 2, cx, deckY, 0, S.wood());
  if (style === 0) {
    const n = Math.max(1, Math.round(len / 0.95));
    const pitch = len / n;
    for (const side of [1, -1]) {
      const z = side * hw, ry = side > 0 ? 0 : Math.PI;
      for (let i = 0; i <= n; i++) b.block(0.12, wallH, 0.12, x0 + pitch * i, deckY, z, S.wood(C.woodDark));
      for (let i = 0; i < n; i++) {
        const bx = x0 + pitch * (i + 0.5);
        b.block(pitch - 0.12, 0.5, 0.05, bx, deckY, z, S.wood());
        if (pitch > 0.6) gothicWindow(b, bx, deckY + 0.68, z, ry, Math.min(0.55, pitch - 0.35), 0.95, false, C.wood);
      }
      b.block(len, 0.14, 0.18, cx, deckY + wallH - 0.14, z, S.wood(C.woodDark));
    }
  } else {
    for (const side of [1, -1]) {
      const z = side * hw, ry = side > 0 ? 0 : Math.PI;
      b.block(len, wallH, 0.22, cx, deckY, z, S.stone());
      const n = Math.max(1, Math.round(len / 1.4));
      for (let i = 0; i < n; i++) gothicWindow(b, x0 + (len / n) * (i + 0.5), deckY + 0.5, z, ry, 0.42, 0.95, i % 2 === 1);
      b.block(len, 0.1, 0.32, cx, deckY + wallH - 0.1, z, S.stone(C.stoneLight));
    }
  }
  b.with(mat4(0, deckY + wallH, 0), () => gableRoof(b, x0, x1, hw + 0.3, 0.95, {}));
}

const DECK = 0.55;
const SKY_HW = 0.85;

/**
 * Underside of a floating gallery along X over [x0, x1]: a moulded stone deck,
 * timber soffit beams, stepped corbels at each bay and a lantern hanging below.
 * No arches or piers: it reads as a corridor held up by magic.
 */
function floatingDeck(b: GeoBuilder, x0: number, x1: number, deckY: number, hw: number, lantern: boolean) {
  const len = x1 - x0, cx = (x0 + x1) / 2;
  b.block(len, 0.3, hw * 2 + 0.3, cx, deckY - 0.46, 0, S.stone());
  b.block(len, 0.1, hw * 2 + 0.44, cx, deckY - 0.56, 0, S.stone(C.stoneLight));
  for (const z of [-0.5, 0, 0.5]) b.block(len, 0.12, 0.14, cx, deckY - 0.68, z, S.wood(C.woodDark));
  const n = Math.max(1, Math.round(len / 1.33));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (len / n) * i;
    if (x <= x0 + 0.05 && x0 > -HALF + 0.05) continue; // stubs start at a tower wall
    b.block(0.16, 0.12, hw * 2 + 0.1, x, deckY - 0.7, 0, S.wood(C.woodDark));
    for (const side of [1, -1]) {
      // three stepped stones tapering down under the outer edge
      for (let k = 0; k < 3; k++) b.block(0.3 - k * 0.07, 0.14, 0.34 - k * 0.09, x, deckY - 0.7 - k * 0.14, side * (hw + 0.05 - k * 0.05), S.stone(C.stoneLight));
      b.add(sphereGeo(0.05, 0), mat4(x, deckY - 1.12, side * (hw - 0.05)), S.gold());
    }
  }
  if (lantern) hangingLantern(b, cx, deckY - 0.7, 0);
}

function skyPiece(kind: 'single' | 'half' | 'end' | 'mid'): Build {
  return (b, _rng, style) => {
    floatingDeck(b, -HALF, HALF, DECK, SKY_HW, true);
    galleryRun(b, -HALF, HALF, DECK, SKY_HW, style);
    for (const x of [-1, 1]) hangingLantern(b, x, DECK + 1.75, 0);
    if (style === 0 && kind !== 'mid') {
      for (const side of [1, -1]) banner(b, 0, DECK - 0.62, side * (SKY_HW + 0.25), side > 0 ? 0 : Math.PI, 0.45, 1.1, side > 0 ? 0 : 3, 0);
    }
    if (kind === 'mid' || kind === 'single') {
      // little lantern cupola on the ridge marks the middle of the span
      const y = DECK + 1.85 + 0.95;
      b.block(0.5, 0.45, 0.5, 0, y - 0.3, 0, S.wood(C.woodDark));
      for (const side of [1, -1]) {
        b.add(boxGeo(0.3, 0.26, 0.02), mat4(0, y - 0.05, side * 0.26), S.glass());
        b.add(boxGeo(0.02, 0.26, 0.3), mat4(side * 0.26, y - 0.05, 0), S.glass());
      }
      b.cone(0.45, 0.6, 4, 0, y + 0.15, 0, S.roof(), Math.PI / 4);
      finial(b, 0, y + 0.72, 0, 0.8);
    }
  };
}

/** Decor: gallery stub from a tower floor out to a sky bridge on +X (style = bridge style). */
const skyStub: Build = (b, _rng, style) => {
  floatingDeck(b, 1.05, HALF, DECK, SKY_HW, false);
  galleryRun(b, 1.05, HALF, DECK, SKY_HW, style);
};
/** Decor: gallery extension from a sky bridge into a hall facade on +X. */
const skyToHall: Build = (b, _rng, style) => {
  floatingDeck(b, HALF, HALF + 0.45, DECK, SKY_HW, false);
  galleryRun(b, HALF, HALF + 0.45, DECK, SKY_HW, style);
};

const wallGallery: Build = (b, rng) => {
  plinth(b);
  wallRun(b, rng, -HALF, HALF, 0, true, false);
  // jettied timber gallery on corbels along the wall walk
  for (let x = -1.75; x <= 1.76; x += 0.5) for (const side of [1, -1]) b.block(0.14, 0.2, 0.3, x, WALL_H - 0.2, side * 0.6, S.stone(C.stoneLight));
  galleryRun(b, -HALF, HALF, WALL_H, 0.72, 0);
  hangingLantern(b, 0, WALL_H + 1.75, 0);
};

// --- chapels ------------------------------------------------------------------------

const hallChapel: Build = (b, rng, style) => {
  plinth(b);
  const x0 = -HALL_HW - 0.1;
  hallBody(b, rng, x0, HALF, 1, false);
  const ry = outward(Math.PI);
  roseWindow(b, x0 - 0.02, 2.2, 0, ry, 0.56, true);
  door(b, x0 - 0.01, 0.02, 0, ry, 0.9, 1.3);
  for (let i = 0; i < 3; i++) b.block(0.25, 0.1, 1.5 - i * 0.2, x0 - 0.45 + i * 0.12, -0.05 + i * 0.08, 0, S.paving(C.stoneLight));
  for (const sz of [1, -1]) {
    b.block(0.55, HALL_H + 0.4, 0.55, x0, 0, sz * HALL_HW, S.stone(C.stoneLight));
    pinnacle(b, x0, HALL_H + 0.4, sz * HALL_HW, 0.38, 0.6);
    if (style === 0) lantern(b, x0, 1.25, sz * 0.8, ry);
    else banner(b, x0 - 0.02, 2.0, sz * 0.95, ry, 0.36, 1.4, sz > 0 ? 3 : 1, 0);
  }
};

const hallNave: Build = (b, rng, style) => {
  plinth(b);
  b.block(4, 0.35, HALL_HW * 2 + 0.22, 0, 0, 0, S.stone(C.stoneDark));
  b.block(4, HALL_H, HALL_HW * 2, 0, 0, 0, S.stone());
  b.block(4, 0.16, HALL_HW * 2 + 0.2, 0, HALL_H - 0.16, 0, S.stone(C.stoneLight));
  for (const side of [1, -1]) {
    const z = side * HALL_HW, ry = side > 0 ? 0 : Math.PI;
    for (const x of [-1, 1]) gothicWindow(b, x, 0.42, z, ry, 0.82, 2.3, (x > 0) !== (side > 0));
    // flying buttress: pier at the cell edge, strut up to the wall head
    const pz = side * 1.95;
    b.block(0.34, 2.2, 0.36, 0, 0, pz, S.stone(C.stoneLight));
    pinnacle(b, 0, 2.2, pz, 0.26, 0.35);
    beam(b, V(0, 2.0, pz - side * 0.1), V(0, 2.85, z + side * 0.05), 0.16, S.stone(C.stoneLight));
    if (style === 1) {
      lantern(b, 0, 1.3, z, ry);
      ivy(b, rng, range(rng, -1.6, 1.6), 0.1, z + side * 0.02, ry, 0.7, 2.4, 2, true);
    }
  }
};

// --- gardens ----------------------------------------------------------------------

const glassGreen: PartStyle = { color: '#d6efc4', mat: MAT.glass, emi: 0.32, flick: 0.05 };

const greenhouse: Build = (b, rng, style) => {
  grassBase(b);
  const L = 3.0, W = 2.2, wall = 0.45, glassH = 1.25;
  b.block(L + 0.3, 0.05, W + 0.3, 0, 0, 0, S.paving(C.stoneLight));
  for (const side of [1, -1]) {
    b.block(L, wall, 0.14, 0, 0, side * W / 2, S.stone());
    b.block(0.14, wall, W, side * L / 2, 0, 0, S.stone());
    b.add(boxGeo(L, glassH, 0.03), mat4(0, wall + glassH / 2, side * W / 2), glassGreen);
    b.add(boxGeo(0.03, glassH, W), mat4(side * L / 2, wall + glassH / 2, 0), glassGreen);
    for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 6) b.block(0.04, glassH, 0.05, x, wall, side * W / 2, S.iron());
  }
  const roofY = wall + glassH;
  b.add(prismGeo(L, W / 2 + 0.08, 0.95), mat4(-L / 2, roofY, 0), glassGreen);
  b.box(L + 0.06, 0.06, 0.06, 0, roofY + 0.96, 0, S.iron());
  for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 6) {
    for (const side of [1, -1]) beam(b, V(x, roofY, side * (W / 2 + 0.06)), V(x, roofY + 0.95, 0), 0.04, S.iron());
  }
  b.add(sphereGeo(0.12, 1), mat4(0, roofY + 1.05, 0), S.gold());
  finial(b, L / 2, roofY + 0.95, 0, 0.8);
  // plants inside
  for (let i = 0; i < 5; i++) bush(b, rng, range(rng, -1.2, 1.2), range(rng, -0.7, 0.7), 0.8, 0.05, true);
  if (style === 1) tree(b, rng, 0, 0, 0.55, 0.05);
  else cypress(b, rng, 0.9, 0.4, 0.6, 0.05);
  hangingLantern(b, -0.6, roofY + 0.6, 0);
  for (let i = 0; i < 3; i++) bush(b, rng, range(rng, -1.8, 1.8), (i % 2 ? 1 : -1) * 1.65, 0.7);
};

const well: Build = (b, rng, style) => {
  grassBase(b);
  b.cyl(1.0, 1.05, 0.05, 14, 0, 0, 0, S.paving(C.stoneLight));
  b.cyl(0.55, 0.6, 0.72, 12, 0, 0.04, 0, S.stone());
  b.cyl(0.64, 0.64, 0.08, 12, 0, 0.74, 0, S.stone(C.stoneLight));
  if (style === 0) b.addWater(cylGeo(0.47, 0.47, 0.02, 12), mat4(0, 0.6, 0));
  else {
    b.cyl(0.47, 0.47, 0.02, 12, 0, 0.6, 0, { color: C.magic, mat: MAT.magic, emi: 2.0, flick: 0.4 });
    for (let i = 0; i < 6; i++) b.add(sphereGeo(0.04, 0), mat4(range(rng, -0.4, 0.4), range(rng, 0.9, 1.8), range(rng, -0.4, 0.4)), { color: C.magic, mat: MAT.magic, emi: 2.5, sway: 0.15, swayDir: V(0, 1, 0) });
  }
  for (const x of [-0.55, 0.55]) b.block(0.1, 1.45, 0.1, x, 0.78, 0, S.wood(C.woodDark));
  b.add(cylGeo(0.04, 0.04, 1.2, 6), mat4(0, 1.95, 0, 0, 0, Math.PI / 2), S.wood());
  b.add(prismGeo(1.5, 0.55, 0.45), mat4(-0.75, 2.15, 0), S.roof());
  b.box(0.012, 0.6, 0.012, 0.1, 1.62, 0, S.iron());
  b.cyl(0.08, 0.1, 0.16, 8, 0.1, 1.2, 0, S.wood());
  for (let i = 0; i < 4; i++) bush(b, rng, Math.cos(i * 1.6 + 0.4) * 1.45, Math.sin(i * 1.6 + 0.4) * 1.45, 0.8);
  lampPost(b, 1.4, -1.4);
};

const pond: Build = (b, rng, style) => {
  grassBase(b);
  b.addWater(cylGeo(1.4, 1.4, 0.02, 24), mat4(0, 0.035, 0));
  b.cyl(1.38, 1.38, 0.02, 24, 0, -0.01, 0, S.stone('#3b4a52'));
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + range(rng, -0.08, 0.08);
    const s = range(rng, 0.14, 0.24);
    b.add(dodecaGeo(1), mat4(Math.cos(a) * 1.45, 0.05, Math.sin(a) * 1.45, rng() * 6, 0, 0, s, s * 0.55, s), S.stone(pick(rng, [C.stoneLight, C.stone, '#8a8090'])));
  }
  if (style === 0) {
    for (let i = 0; i < 4; i++) {
      const t = -1.05 + i * 0.7;
      b.cyl(0.2, 0.22, 0.08, 7, t, 0.0, t * 0.35 + range(rng, -0.1, 0.1), S.stone(C.stoneLight));
    }
  } else {
    // stone lantern on an islet
    b.cyl(0.35, 0.4, 0.1, 8, 0.3, 0, -0.2, S.stone());
    b.block(0.14, 0.4, 0.14, 0.3, 0.1, -0.2, S.stone(C.stoneLight));
    b.block(0.3, 0.22, 0.3, 0.3, 0.5, -0.2, S.stone(C.stoneLight));
    b.block(0.14, 0.14, 0.14, 0.3, 0.54, -0.2, S.flame());
    b.cone(0.3, 0.2, 4, 0.3, 0.72, -0.2, S.stone(), Math.PI / 4);
  }
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2, r = range(rng, 0.3, 1.15);
    b.cyl(0.16, 0.16, 0.015, 7, Math.cos(a) * r, 0.04, Math.sin(a) * r, S.leaf(pick(rng, C.leaf), 0.01));
    if (rng() < 0.4) b.add(sphereGeo(0.06, 0), mat4(Math.cos(a) * r, 0.08, Math.sin(a) * r, 0, 0, 0, 1, 0.6, 1), { color: '#f0a0c8', mat: MAT.foliage, emi: 0.3 });
  }
  for (let i = 0; i < 12; i++) {
    const a = -0.8 + range(rng, -0.4, 0.4);
    b.add(boxGeo(0.03, range(rng, 0.4, 0.7), 0.03), mat4(Math.cos(a) * 1.3 + range(rng, -0.1, 0.1), 0.25, Math.sin(a) * 1.3 + range(rng, -0.1, 0.1), 0, range(rng, -0.15, 0.15), range(rng, -0.15, 0.15)), S.leaf('#6f8a3a', 0.04));
  }
  for (const [x, z] of [[1.7, 1.7], [-1.7, 1.6], [1.6, -1.7]]) bush(b, rng, x, z, 0.7);
};

function wizardStatue(b: GeoBuilder, x: number, y: number, z: number, ry: number) {
  b.at(x, y, z, ry, () => {
    const st = S.stone(C.stoneLight);
    b.cone(0.3, 1.0, 8, 0, 0, 0, st);
    b.add(sphereGeo(1, 0), mat4(0, 0.78, 0.02, 0, 0, 0, 0.2, 0.12, 0.18), st);
    b.add(sphereGeo(0.12, 1), mat4(0, 1.0, 0), st);
    b.add(cylGeo(0.2, 0.2, 0.025, 10), mat4(0, 1.1, 0), st);
    b.add(cylGeo(0, 0.12, 0.42, 8), mat4(0.03, 1.32, 0, 0, 0, -0.25), st);
    b.add(cylGeo(0.02, 0.025, 1.3, 5), mat4(0.26, 0.65, 0.1, 0, 0, 0.08), S.wood(C.woodDark));
    b.add(sphereGeo(0.06, 1), mat4(0.31, 1.32, 0.1), { color: C.magic, mat: MAT.magic, emi: 2.2, flick: 0.4 });
  });
}

const statues: Build = (b, rng) => {
  grassBase(b);
  b.block(4, 0.03, 1.3, 0, 0, 0, S.paving(C.stoneLight));
  for (const side of [1, -1]) {
    for (const x of [-1.1, 1.1]) {
      b.block(0.55, 0.55, 0.55, x, 0, side * 1.15, S.stone());
      b.block(0.62, 0.06, 0.62, x, 0.55, side * 1.15, S.stone(C.stoneLight));
      wizardStatue(b, x, 0.61, side * 1.15, side > 0 ? Math.PI : 0);
    }
    cypress(b, rng, 0, side * 1.45, 0.95);
    for (const x of [-1.8, 1.8]) bush(b, rng, x, side * 1.6, 0.6);
  }
};

register({
  terrace,
  stairs,
  skyBridge: skyPiece('single'),
  skySpan: skyPiece('half'),
  skyLongEnd: skyPiece('end'),
  skyMid: skyPiece('mid'),
  wallGallery,
  hallChapel,
  hallNave,
  greenhouse,
  well,
  pond,
  statues,
  // neighbour-aware decor
  terraceFace,
  terraceParapet,
  waterfall,
  skyStub,
  skyToHall,
});


