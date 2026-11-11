import { DOWN, UP } from '../config';
import { HSocket, MODULES, ModuleDef, socketsFit, vKey } from './modules';

/** A module at a fixed rotation: the unit the solver actually reasons about. */
export interface Variant {
  index: number;
  module: ModuleDef;
  rot: number;
  sides: HSocket[]; // world-space sockets, indexed by direction 0..3
  topKey: string;
  bottomKey: string;
  weight: number;
}

export const VARIANTS: Variant[] = [];
for (const module of MODULES) {
  for (const rot of module.rotations) {
    const sides: HSocket[] = new Array(4);
    for (let i = 0; i < 4; i++) sides[(i + rot) % 4] = module.sides[i];
    VARIANTS.push({
      index: VARIANTS.length,
      module,
      rot,
      sides,
      topKey: vKey(module.top, rot),
      bottomKey: vKey(module.bottom, rot),
      weight: module.weight / module.rotations.length,
    });
  }
}

export const NV = VARIANTS.length;
export const WORDS = Math.ceil(NV / 32);
export const AIR_INDEX = VARIANTS.findIndex((v) => v.module.id === 'air');

/** Can variant `b` sit on side `d` of variant `a`? */
export function fits(a: Variant, b: Variant, d: number): boolean {
  if (d < 4) return socketsFit(a.sides[d], b.sides[(d + 2) % 4]);
  if (d === UP) return a.topKey === b.bottomKey;
  return a.bottomKey === b.topKey;
}

/** compat[(v * 6 + d) * WORDS + k]: bitset of variants allowed on side d of v. */
export const COMPAT = new Uint32Array(NV * 6 * WORDS);
for (const a of VARIANTS) {
  for (let d = 0; d < 6; d++) {
    for (const b of VARIANTS) {
      if (fits(a, b, d)) COMPAT[(a.index * 6 + d) * WORDS + (b.index >> 5)] |= 1 << (b.index & 31);
    }
  }
}

export function variantsOf(moduleId: string): Variant[] {
  return VARIANTS.filter((v) => v.module.id === moduleId);
}

export { UP, DOWN };
