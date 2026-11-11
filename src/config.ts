// World units per grid cell. Cells are W x H x W boxes, origin at bottom-center.
export const CELL_W = 4;
export const CELL_H = 3;

// Horizontal directions in rotation order: rotating a module by +90deg around Y
// (three.js convention) maps +X -> -Z -> -X -> +Z, so side i becomes side (i + r) % 4.
export const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], // 0: +X
  [0, 0, -1], // 1: -Z
  [-1, 0, 0], // 2: -X
  [0, 0, 1], // 3: +Z
  [0, 1, 0], // 4: +Y (up)
  [0, -1, 0], // 5: -Y (down)
];

export const UP = 4;
export const DOWN = 5;

export function opposite(d: number): number {
  return d < 4 ? (d + 2) % 4 : d === UP ? DOWN : UP;
}

export const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

export function hash3(x: number, y: number, z: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + salt * 144665) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type RNG = () => number;
