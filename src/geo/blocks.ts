import * as THREE from 'three';
import { GeoBuilder, PartStyle, boxGeo, mat4 } from './builder';
import { fleche, gableFace } from './extra';
import { C, S, balcony, banner, bush, cypress, finial, gableRoof, gothicWindow, ivy, lantern, outward, pinnacle, range, tree } from './parts';
import { HALF, plinth } from './modules';
import { Build, register } from './registry';
import { BLOCK_SHAPES } from '../wfc/modules';
import { RNG } from '../config';

/**
 * Wide buildings: footprint tiles that assemble into blocks of any rectilinear
 * shape. Bodies put facades on 'hf' sides and run through on interior sides;
 * roofs put a pitched wing along the perimeter and flat roofs in the middle.
 */

const FAC = 1.75; // facade plane distance from the cell centre
const WING_HW = 2.0;
const WING_H = 2.7;
const H = 3.0;

const rotY = (d: number) => mat4(0, 0, 0, (d * Math.PI) / 2);

/** Facade details in a frame where the facade is the plane x = FAC facing +X, spanning z0..z1. */
function facade(b: GeoBuilder, rng: RNG, style: number, upper: boolean, z0: number, z1: number, cornerAtZ1: boolean) {
  const winW = upper ? 0.62 : 0.8;
  const winH = upper ? 1.35 : 1.95;
  const winY = upper ? 0.75 : 0.55;
  const ry = outward(0);
  for (const z of [-1, 1]) if (z > z0 + 0.4 && z < z1 - 0.4) gothicWindow(b, FAC, winY, z, ry, winW, winH, style === 1 && (z > 0) === upper);
  if (style === 3 && upper) balcony(b, rng, FAC, winY - 0.08, 1, ry, 1.3);
  if (style === 1 && !upper) banner(b, FAC + 0.02, H - 0.3, 0, ry, 0.45, 1.7, Math.floor(rng() * 4), Math.floor(rng() * 2));
  else {
    b.block(0.3, H - 0.3, 0.32, FAC + 0.15, 0, 0, S.stone(C.stoneLight));
    pinnacle(b, FAC + 0.15, H - 0.3, 0, 0.24, 0.3);
  }
  if (style === 2 && !upper) {
    lantern(b, FAC, 1.5, 0.45, ry);
    ivy(b, rng, FAC + 0.02, 0.1, range(rng, -1.3, 1.3), ry, 0.9, 2.6, 3, rng() < 0.5);
  }
  // corner pier (each corner is owned by the facade whose +Z end it is)
  if (cornerAtZ1) {
    b.block(0.5, H + 0.1, 0.5, FAC, 0, FAC, S.stone(C.stoneLight));
    pinnacle(b, FAC, H + 0.1, FAC, 0.34, 0.4);
  }
}

function blockBody(facades: number[], upper: boolean): Build {
  return (b, rng, style) => {
    if (!upper) plinth(b);
    const has = (d: number) => facades.includes(d);
    const box = (pad: number, y: number, h: number, s: ReturnType<typeof S.stone>) => {
      const x0 = has(2) ? -FAC - pad : -HALF, x1 = has(0) ? FAC + pad : HALF;
      const z0 = has(1) ? -FAC - pad : -HALF, z1 = has(3) ? FAC + pad : HALF;
      b.block(x1 - x0, h, z1 - z0, (x0 + x1) / 2, y, (z0 + z1) / 2, s);
    };
    box(0, 0, H, S.stone());
    if (!upper) box(0.12, 0, 0.35, S.stone(C.stoneDark));
    else box(0.06, 0, 0.16, S.stone(C.stoneLight));
    if (facades.length) box(0.1, H - 0.16, 0.16, S.stone(C.stoneLight));
    for (const d of facades) {
      // in the rotated frame local -Z is direction d+1 and local +Z is d+3
      const zMin = has((d + 1) % 4) ? -FAC : -HALF;
      const zMax = has((d + 3) % 4) ? FAC : HALF;
      b.with(rotY(d), () => facade(b, rng, style, upper, zMin, zMax, has((d + 3) % 4)));
    }
  };
}

interface Arm {
  d: number;
  from: number;
  gable?: boolean;
}

/** Flat-roof furniture for interior cells: what makes the middle of a block interesting. */
function interiorRoof(b: GeoBuilder, rng: RNG, style: number) {
  if (style === 0) {
    // leaded terrace with chimney stacks and a small roof lantern
    for (const [x, z] of [[-1.1, -1.1], [1.2, 0.9]]) {
      b.block(0.55, 1.3, 0.55, x, 0.1, z, S.stone());
      b.block(0.66, 0.1, 0.66, x, 1.4, z, S.stone(C.stoneLight));
      for (const dx of [-0.12, 0.12]) b.cyl(0.07, 0.07, 0.3, 6, x + dx, 1.5, z, S.stone('#b0705a'));
      b.emitter(x, 1.85, z);
    }
    b.block(0.9, 0.5, 0.9, 0.6, 0.1, -0.8, S.stone(C.stoneLight));
    b.cone(0.75, 0.5, 4, 0.6, 0.6, -0.8, { color: C.glass, mat: 6, emi: 0.9, flick: 0.1 }, Math.PI / 4);
  } else if (style === 1) {
    // glass atrium over a light well
    b.block(3.0, 0.3, 3.0, 0, 0.1, 0, S.stone(C.stoneLight));
    b.cone(2.05, 1.3, 4, 0, 0.4, 0, { color: '#b49cff', mat: 6, emi: 0.55, flick: 0.1 }, Math.PI / 4);
    const apex = new THREE.Vector3(0, 1.7, 0);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) beam(b, new THREE.Vector3(x * 1.45, 0.4, z * 1.45), apex, 0.06, S.gold());
    for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) beam(b, new THREE.Vector3(x * 1.45, 0.4, z * 1.45), apex, 0.035, S.gold());
    finial(b, 0, 1.7, 0, 1.1);
  } else if (style === 3) {
    // plain leads with a hatch and vents
    b.block(0.7, 0.35, 0.5, -0.9, 0.1, 0.7, S.stone(C.stoneLight));
    b.add(boxGeo(0.72, 0.06, 0.6), mat4(-0.9, 0.5, 0.7, 0, 0.35), S.wood(C.woodDark));
    for (const [x, z] of [[1.1, -1.0], [0.6, -1.3]]) b.cyl(0.08, 0.1, 0.45, 6, x, 0.1, z, S.iron());
  } else if (style === 4) {
    // lantern-lit terrace
    b.block(1.1, 0.1, 0.36, 0, 0.48, -1.2, S.stone(C.stoneLight));
    for (const dx of [-0.4, 0.4]) b.block(0.15, 0.38, 0.3, dx, 0.1, -1.2, S.stone());
    for (const [x, z] of [[-1.4, 1.4], [1.4, 1.4]]) {
      b.block(0.5, 0.45, 0.5, x, 0.1, z, S.stone(C.stoneLight));
      bush(b, rng, x, z, 0.6, 0.55);
    }
  } else {
    // roof garden
    b.block(3.2, 0.12, 3.2, 0, 0.1, 0, S.grass());
    b.block(3.4, 0.25, 0.12, 0, 0.1, 1.66, S.stone(C.stoneLight));
    b.block(3.4, 0.25, 0.12, 0, 0.1, -1.66, S.stone(C.stoneLight));
    tree(b, rng, range(rng, -0.5, 0.5), range(rng, -0.5, 0.5), 0.75, 0.22);
    for (let i = 0; i < 3; i++) bush(b, rng, range(rng, -1.3, 1.3), range(rng, -1.3, 1.3), 0.8, 0.22);
    cypress(b, rng, 1.3, -1.2, 0.7, 0.22);
  }
}

/** Thin beam between two points (atrium ribs). */
function beam(b: GeoBuilder, from: THREE.Vector3, to: THREE.Vector3, t: number, style: PartStyle) {
  const dir = to.clone().sub(from);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const m = new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  b.add(boxGeo(t, dir.length(), t), m, style);
}

function blockRoof(arms: Arm[], flat: boolean, interior: boolean): Build {
  return (b, rng, style) => {
    if (flat) b.block(4, 0.1, 4, 0, 0, 0, S.paving(C.stoneLight));
    if (interior) interiorRoof(b, rng, style);
    if (arms.length === 2 && arms.every((a) => a.from === -HALF)) fleche(b, WING_H - 0.4);
    for (const arm of arms) {
      b.with(rotY(arm.d), () => {
        const len = HALF - arm.from;
        const dormers = len > 3.5 ? [-1, 1] : [arm.from + len * 0.55];
        gableRoof(b, arm.from, HALF, WING_HW, WING_H, { ovMin: arm.gable ? 0.15 : 0, dormers });
        if (arm.gable) gableFace(b, arm.from, WING_HW, WING_H, style === 1);
      });
    }
  };
}

// roof wings per footprint, in the rotation-0 frame (sides +X, -Z, -X, +Z)
const ROOF_ARMS: Record<string, { arms: Arm[]; flat: boolean }> = {
  In: { arms: [], flat: true },
  Edge: { arms: [{ d: 0, from: -HALF }], flat: true },
  Corner: { arms: [{ d: 2, from: -1.9, gable: true }, { d: 1, from: -1.9, gable: true }], flat: false },
  Inner: { arms: [{ d: 0, from: 0 }, { d: 3, from: 0 }], flat: true },
  Strip: { arms: [{ d: 0, from: -HALF }], flat: false },
  End: { arms: [{ d: 0, from: -1.9, gable: true }], flat: false },
  T: { arms: [{ d: 0, from: -HALF }, { d: 1, from: 0 }], flat: false },
  Wing: { arms: [{ d: 0, from: -HALF }], flat: true },
  WingT: { arms: [{ d: 0, from: -HALF }, { d: 1, from: 0 }], flat: true },
  Cross: { arms: [{ d: 0, from: -HALF }, { d: 1, from: -HALF }], flat: false },
};

const builders: Record<string, Build> = {};
for (const [suffix, , body] of BLOCK_SHAPES) {
  const facades = [0, 1, 2, 3].filter((d) => body[d] === 'hf');
  const { arms, flat } = ROOF_ARMS[suffix];
  builders[`blk${suffix}`] = blockBody(facades, false);
  builders[`blk${suffix}Upper`] = blockBody(facades, true);
  builders[`blkRoof${suffix}`] = blockRoof(arms, flat, suffix === 'In');
}
register(builders);
