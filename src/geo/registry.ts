import * as THREE from 'three';
import { mulberry32, RNG } from '../config';
import { GeoBuilder } from './builder';

export type Build = (b: GeoBuilder, rng: RNG, style: number) => void;

/** Module id -> procedural builder. Filled by the module files on import. */
export const BUILDERS: Record<string, Build> = {};

export function register(builders: Record<string, Build>) {
  Object.assign(BUILDERS, builders);
}

export interface ModuleGeometry {
  castle: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
  /** chimney smoke sources, module space, flat xyz */
  emitters: number[];
}

const geoCache = new Map<string, ModuleGeometry>();

export function moduleGeometry(id: string, style: number): ModuleGeometry {
  const key = `${id}:${style}`;
  let g = geoCache.get(key);
  if (!g) {
    const build = BUILDERS[id];
    if (!build) throw new Error(`no geometry builder for module "${id}"`);
    const b = new GeoBuilder();
    // fixed seed per (module, style) so each style is a stable, reusable mesh
    let seed = style * 7919 + 17;
    for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
    build(b, mulberry32(seed), style);
    g = b.build();
    geoCache.set(key, g);
  }
  return g;
}
