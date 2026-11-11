import * as THREE from 'three';
import { CELL_H, CELL_W, DIRS, cellKey, hash3 } from '../config';
import { moduleGeometry } from '../geo';
import { VARIANTS } from '../wfc/variants';
import { createCastleMaterial, createWaterMaterial } from './materials';

const WATERY = new Set(['water', 'canalBridge', 'coveredBridge']);
const DOOR_TOWERS = new Set(['towerBase', 'sqTowerBase']);
const CLOISTERS = new Set(['arcade', 'arcadeCorner', 'arcadeT', 'arcadeEnd']);
const WALKABLE = new Set(['grass', 'court', 'maze', 'greatTree', 'shrine', 'well', 'statues', 'pond', 'greenhouse', 'crystals']);
const TOWER_FLOORS = new Set(['towerMid', 'sqTowerMid']);
const SKY_BRIDGES = new Set(['skyBridge', 'skySpan', 'skyLongEnd', 'skyMid']);
/** modules whose decor depends on their neighbours */
const DECOR_MODULES = new Set([...WATERY, ...DOOR_TOWERS, ...CLOISTERS, ...TOWER_FLOORS, 'wallEnd', 'terrace', ...SKY_BRIDGES]);

export interface CellRec {
  x: number;
  y: number;
  z: number;
  v: number; // variant index
  style: number;
  vrot: number; // extra visual rotation (rotation-invariant modules only)
  spawn: number;
}

interface Inst {
  x: number;
  y: number;
  z: number;
  rot: number;
  spawn: number;
}

class RenderGroup {
  castle: THREE.InstancedMesh | null = null;
  water: THREE.InstancedMesh | null = null;
  cap = 0;
  members = new Set<string>();

  constructor(
    readonly moduleId: string,
    readonly style: number,
    private parent: THREE.Object3D,
    private castleMat: THREE.Material,
    private waterMat: THREE.Material,
  ) {}

  private ensure(n: number) {
    if (n <= this.cap) return;
    let cap = Math.max(8, this.cap);
    while (cap < n) cap *= 2;
    this.cap = cap;
    const g = moduleGeometry(this.moduleId, this.style);
    this.dispose();
    if (g.castle) {
      g.castle.setAttribute('aSpawn', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1));
      this.castle = new THREE.InstancedMesh(g.castle, this.castleMat, cap);
      this.castle.castShadow = this.castle.receiveShadow = true;
      this.castle.frustumCulled = false;
      this.parent.add(this.castle);
    }
    if (g.water) {
      this.water = new THREE.InstancedMesh(g.water, this.waterMat, cap);
      this.water.receiveShadow = true;
      this.water.frustumCulled = false;
      this.parent.add(this.water);
    }
  }

  write(list: Inst[]) {
    this.ensure(list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    const spawn = this.castle?.geometry.getAttribute('aSpawn') as THREE.InstancedBufferAttribute | undefined;
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, (it.rot * Math.PI) / 2);
      m.compose(p.set(it.x * CELL_W, it.y * CELL_H, it.z * CELL_W), q, one);
      this.castle?.setMatrixAt(i, m);
      this.water?.setMatrixAt(i, m);
      if (spawn) spawn.setX(i, it.spawn);
    });
    for (const mesh of [this.castle, this.water]) {
      if (!mesh) continue;
      mesh.count = list.length;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (spawn) spawn.needsUpdate = true;
  }

  dispose() {
    for (const mesh of [this.castle, this.water]) {
      if (!mesh) continue;
      this.parent.remove(mesh);
      mesh.dispose();
    }
    this.castle = this.water = null;
  }
}

/**
 * Sparse voxel world of decided module variants + the instanced renderer for it.
 * One InstancedMesh per (module, style); rendering is flushed lazily.
 */
export class World {
  readonly root = new THREE.Group();
  readonly cells = new Map<string, CellRec>();
  readonly castleMat = createCastleMaterial();
  readonly waterMat = createWaterMaterial();
  private groups = new Map<string, RenderGroup>();
  private dirty = new Set<string>();
  private decorDirty = false;
  private decorKeys = new Set<string>();
  /** ground cells whose decor depends on neighbours */
  private decorCells = new Set<string>();
  version = 0;

  get(x: number, y: number, z: number) {
    return this.cells.get(cellKey(x, y, z));
  }
  variantAt(x: number, y: number, z: number): number | undefined {
    return this.cells.get(cellKey(x, y, z))?.v;
  }

  private group(id: string, style: number) {
    const key = `${id}:${style}`;
    let g = this.groups.get(key);
    if (!g) {
      g = new RenderGroup(id, style, this.root, this.castleMat, this.waterMat);
      this.groups.set(key, g);
    }
    return { g, key };
  }

  set(x: number, y: number, z: number, v: number, spawn = -100) {
    const key = cellKey(x, y, z);
    this.removeKey(key);
    const m = VARIANTS[v].module;
    const rec: CellRec = {
      x, y, z, v,
      // spans share one style: hash ignores the coordinate along the span axis
      style: Math.floor((SKY_BRIDGES.has(m.id) ? (VARIANTS[v].rot % 2 ? hash3(x, y, 0, 1) : hash3(0, y, z, 1)) : hash3(x, y, z, 1)) * m.styles),
      vrot: m.randomVisualRot ? Math.floor(hash3(x, y, z, 2) * 4) : 0,
      spawn,
    };
    this.cells.set(key, rec);
    if (m.id !== 'air') {
      const { g, key: gk } = this.group(m.id, rec.style);
      g.members.add(key);
      this.dirty.add(gk);
    }
    if (DECOR_MODULES.has(m.id)) this.decorCells.add(key);
    this.decorDirty = true;
    this.version++;
  }

  remove(x: number, y: number, z: number) {
    this.removeKey(cellKey(x, y, z));
  }

  private removeKey(key: string) {
    const rec = this.cells.get(key);
    if (!rec) return;
    const m = VARIANTS[rec.v].module;
    if (m.id !== 'air') {
      const { g, key: gk } = this.group(m.id, rec.style);
      g.members.delete(key);
      this.dirty.add(gk);
    }
    this.decorCells.delete(key);
    this.decorDirty = true;
    this.cells.delete(key);
    this.version++;
  }

  clear() {
    this.cells.clear();
    this.decorCells.clear();
    for (const [k, g] of this.groups) {
      g.members.clear();
      this.dirty.add(k);
    }
    this.decorDirty = true;
    this.version++;
  }

  /** Push pending changes to the GPU. Call once per frame. */
  flush() {
    for (const key of this.dirty) {
      const g = this.groups.get(key)!;
      const list: Inst[] = [];
      for (const k of g.members) {
        const c = this.cells.get(k)!;
        list.push({ x: c.x, y: c.y, z: c.z, rot: VARIANTS[c.v].rot + c.vrot, spawn: c.spawn });
      }
      g.write(list);
    }
    this.dirty.clear();
    if (this.decorDirty) this.rebuildDecor();
  }

  /**
   * Details derived from neighbours rather than being WFC modules:
   * canal banks, tower/turret doors (into a cloister if one arrives, else onto
   * walkable ground), stubs bridging round/square towers to walls and
   * cloisters, and cloister extensions that reach a hall facade.
   */
  private rebuildDecor() {
    this.decorDirty = false;
    const out = new Map<string, Inst[]>();
    const emit = (id: string, style: number, it: Inst) => {
      const k = `${id}:${style}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(it);
    };
    const cellAt = (x: number, y: number, z: number) => this.cells.get(cellKey(x, y, z));
    const idAt = (x: number, y: number, z: number) => {
      const c = cellAt(x, y, z);
      return c ? VARIANTS[c.v].module.id : undefined;
    };
    const isWater = (x: number, y: number, z: number) => WATERY.has(idAt(x, y, z) ?? '');
    const isEmpty = (x: number, y: number, z: number) => {
      const id = idAt(x, y, z);
      return id === undefined || id === 'air';
    };
    // empty neighbours count as walkable so lone towers in build mode get a door
    const walkable = (x: number, y: number, z: number) => {
      const id = idAt(x, y, z);
      return id === undefined || WALKABLE.has(id);
    };
    for (const key of this.decorCells) {
      const c = this.cells.get(key)!;
      const v = VARIANTS[c.v];
      const id = v.module.id;
      const { x, y, z } = c;
      const inst = (rot: number): Inst => ({ x, y, z, rot, spawn: c.spawn });
      const nb = (d: number) => [x + DIRS[d][0], y, z + DIRS[d][2]] as const;
      const facing = (d: number) => {
        const n = cellAt(...nb(d));
        return n ? { socket: VARIANTS[n.v].sides[(d + 2) % 4], style: n.style } : undefined;
      };

      if (WATERY.has(id)) {
        for (let d = 0; d < 4; d++) {
          const [nx, , nz] = nb(d);
          // a raised canal reaching the terrace edge pours down instead of being banked
          // only pour into water on the level below; anything else gets a bank
          if (y > 0 && isEmpty(nx, y, nz) && isWater(nx, y - 1, nz)) emit('waterfall', 0, inst(d));
          else if (!isWater(nx, y, nz)) emit('bank', 0, inst(d));
          const e = (d + 3) % 4;
          const ex = DIRS[e][0], ez = DIRS[e][2];
          if (isWater(nx, y, nz) && isWater(x + ex, y, z + ez) && !isWater(nx + ex, y, nz + ez)) emit('bankCorner', 0, inst(d));
        }
        continue;
      }

      if (id === 'terrace') {
        const top = idAt(x, y + 1, z);
        const openTop = top !== undefined && (WALKABLE.has(top) || top === 'terrace');
        for (let d = 0; d < 4; d++) {
          const [nx, , nz] = nb(d);
          const n = idAt(nx, y, nz);
          if (n === 'terrace' || n === 'stairs') continue;
          emit('terraceFace', c.style, inst(d));
          if (openTop && top !== 'terrace' && isEmpty(nx, y + 1, nz)) emit('terraceParapet', 0, inst(d));
        }
        continue;
      }

      if (CLOISTERS.has(id)) {
        for (let d = 0; d < 4; d++) if (v.sides[d] === 'c' && facing(d)?.socket === 'hf') emit('cloisterToHall', c.style, inst(d));
        continue;
      }

      if (SKY_BRIDGES.has(id)) {
        for (let d = 0; d < 4; d++) if (v.sides[d] === 'sb' && facing(d)?.socket === 'hf') emit('skyToHall', c.style, inst(d));
        continue;
      }

      if (TOWER_FLOORS.has(id)) {
        for (let d = 0; d < 4; d++) {
          const f = facing(d);
          if (f?.socket === 'sb') emit('skyStub', f.style, inst(d));
        }
        continue;
      }

      // tower bases and turrets: joints first, then one door
      let door = -1;
      if (DOOR_TOWERS.has(id)) {
        for (let d = 0; d < 4; d++) {
          const f = facing(d);
          if (f?.socket === 'w') emit('towerWallStub', 0, inst(d));
          if (f?.socket === 'c') {
            emit('towerCloisterStub', f.style, inst(d));
            if (door < 0) door = d;
          }
        }
      }
      if (door < 0) {
        const first = id === 'wallEnd' ? (v.rot + 2) % 4 : Math.floor(hash3(x, y, z, 3) * 4);
        for (let k = 0; k < 4 && door < 0; k++) {
          const d = (first + k) % 4;
          const [nx, , nz] = nb(d);
          if (v.sides[d] !== 'w' && walkable(nx, y, nz)) door = d;
        }
      }
      if (door >= 0) emit(id === 'wallEnd' ? 'turretDoor' : 'towerDoor', 0, inst(door));
    }
    // clear groups that had decor last time but none now
    for (const k of this.decorKeys) if (!out.has(k)) out.set(k, []);
    this.decorKeys = new Set([...out.keys()].filter((k) => out.get(k)!.length));
    for (const [k, list] of out) {
      const [gid, style] = k.split(':');
      this.group(gid, +style).g.write(list);
    }
  }

  private smokeCache: { version: number; data: Float32Array } = { version: -1, data: new Float32Array(0) };

  /** World-space chimney smoke sources (flat xyz), recomputed when the world changes. */
  smokeSources(): Float32Array {
    if (this.smokeCache.version === this.version) return this.smokeCache.data;
    const pts: number[] = [];
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const c of this.cells.values()) {
      const m = VARIANTS[c.v].module;
      if (m.id === 'air') continue;
      const em = moduleGeometry(m.id, c.style).emitters;
      for (let i = 0; i < em.length; i += 3) {
        p.set(em[i], em[i + 1], em[i + 2]).applyAxisAngle(up, ((VARIANTS[c.v].rot + c.vrot) * Math.PI) / 2);
        pts.push(p.x + c.x * CELL_W, p.y + c.y * CELL_H, p.z + c.z * CELL_W);
      }
    }
    this.smokeCache = { version: this.version, data: new Float32Array(pts) };
    return this.smokeCache.data;
  }

  /** Bounds of non-air cells (for camera framing). */
  bounds(): THREE.Box3 | null {
    if (!this.cells.size) return null;
    const b = new THREE.Box3();
    for (const c of this.cells.values()) {
      if (VARIANTS[c.v].module.id === 'air') continue;
      b.expandByPoint(new THREE.Vector3(c.x * CELL_W, c.y * CELL_H, c.z * CELL_W));
    }
    return b.isEmpty() ? null : b;
  }
}
