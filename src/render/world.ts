import * as THREE from 'three';
import { CELL_H, CELL_W, DIRS, cellKey, hash3 } from '../config';
import { BUILDERS, moduleGeometry } from '../geo';
import { windowOff } from '../geo/builder';
import { ROOMS, roomOfWindow } from './interior';
import { MODULE_BY_ID } from '../wfc/modules';
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
  /** visual offset in world units (the museum lays exhibits out off the cell grid) */
  ox: number;
  oz: number;
}

interface Inst {
  x: number;
  y: number;
  z: number;
  rot: number;
  spawn: number;
  ox: number;
  oz: number;
}

/**
 * World units per culling region. Each module keeps its instances sorted per region and only the
 * regions in view are packed into its single instanced mesh: one draw per module whatever the
 * world's size (three's WebGPU renderer spends ~10 µs of CPU per draw, so one mesh per region per
 * module made ~1600 draws a frame and the CPU, not the GPU, set the frame rate).
 */
const REGION = 32;
/** sway and the pop-in overshoot reach a little past an instance's own bounds */
const CULL_MARGIN = 1.5;

/** One region's share of a module's instances, ready to copy into the instance buffers. */
interface Slice {
  n: number;
  mat: Float32Array;
  inst: Float32Array;
  spawn: Float32Array;
  box: THREE.Box3;
}

const regionOf = (it: Inst) => `${Math.floor((it.x * CELL_W + it.ox) / REGION)},${Math.floor((it.z * CELL_W + it.oz) / REGION)}`;

class RenderGroup {
  members = new Set<string>();
  readonly slices = new Map<string, Slice>();
  private castle: THREE.InstancedMesh | null = null;
  private water: THREE.InstancedMesh | null = null;
  private cap = 0;
  private spawn: THREE.InstancedBufferAttribute | null = null;
  private inst: THREE.InstancedBufferAttribute | null = null;
  /** slices changed since the last pack */
  private stale = true;
  /** regions packed last time (skips re-uploading when the view moves but this module's part didn't) */
  private packed = '';
  /** horizontal reach and height of the module's geometry, for the region bounds */
  private reach = CELL_W / 2;
  private top = CELL_H;

  constructor(
    readonly moduleId: string,
    readonly style: number,
    private parent: THREE.Object3D,
    private castleMat: THREE.Material,
    private waterMat: THREE.Material,
  ) {
    const g = moduleGeometry(moduleId, style);
    const b = new THREE.Box3();
    for (const geo of [g.castle, g.water]) {
      if (!geo) continue;
      if (!geo.boundingBox) geo.computeBoundingBox();
      b.union(geo.boundingBox!);
    }
    if (!b.isEmpty()) {
      this.reach = Math.max(-b.min.x, b.max.x, -b.min.z, b.max.z) + CULL_MARGIN;
      this.top = b.max.y + CULL_MARGIN;
    }
  }

  private ensure(n: number) {
    if (n <= this.cap) return;
    let cap = Math.max(8, this.cap);
    while (cap < n) cap *= 2;
    this.cap = cap;
    const g = moduleGeometry(this.moduleId, this.style);
    this.dispose();
    // castle and water place their instances the same way (pop-in included): one shared set of
    // per-instance attributes on wrappers around the module's vertex buffers (old wrappers are
    // left to the GC, not disposed: disposing would free the shared vertex buffers)
    const spawn = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    const inst = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    const wrap = (src: THREE.BufferGeometry) => {
      const geo = new THREE.BufferGeometry();
      for (const [name, attr] of Object.entries(src.attributes)) geo.setAttribute(name, attr);
      if (src.index) geo.setIndex(src.index);
      geo.setAttribute('aSpawn', spawn);
      geo.setAttribute('aInst', inst);
      return geo;
    };
    if (g.castle) {
      this.castle = new THREE.InstancedMesh(wrap(g.castle), this.castleMat, cap);
      this.castle.castShadow = this.castle.receiveShadow = true;
    }
    if (g.water) {
      this.water = new THREE.InstancedMesh(wrap(g.water), this.waterMat, cap);
      this.water.receiveShadow = true;
    }
    this.spawn = spawn;
    this.inst = inst;
    for (const mesh of [this.castle, this.water]) {
      if (!mesh) continue;
      // culled per region in `pack`; the mesh's own bounds would span every packed region
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.visible = false;
      this.parent.add(mesh);
    }
    this.packed = '\0';
  }

  /** Sort the module's instances into regions (the GPU buffers are filled by `pack`). */
  write(list: Inst[]) {
    const buckets = new Map<string, Inst[]>();
    for (const it of list) {
      const k = regionOf(it);
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = []));
      b.push(it);
    }
    this.slices.clear();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const one = new THREE.Vector3(1, 1, 1);
    const up = new THREE.Vector3(0, 1, 0);
    for (const [k, items] of buckets) {
      const n = items.length;
      const sl: Slice = { n, mat: new Float32Array(n * 16), inst: new Float32Array(n * 4), spawn: new Float32Array(n), box: new THREE.Box3() };
      items.forEach((it, i) => {
        q.setFromAxisAngle(up, (it.rot * Math.PI) / 2);
        p.set(it.x * CELL_W + it.ox, it.y * CELL_H, it.z * CELL_W + it.oz);
        m.compose(p, q, one).toArray(sl.mat, i * 16);
        sl.inst[i * 4] = p.x;
        sl.inst[i * 4 + 1] = p.y;
        sl.inst[i * 4 + 2] = p.z;
        sl.inst[i * 4 + 3] = it.rot % 4;
        sl.spawn[i] = it.spawn;
        const { x, y, z } = p;
        sl.box.expandByPoint(p.set(x - this.reach, y - 1.2, z - this.reach));
        sl.box.expandByPoint(p.set(x + this.reach, y + this.top, z + this.reach));
      });
      this.slices.set(k, sl);
    }
    this.stale = true;
    this.ensure(this.members.size || list.length);
  }

  /** Fill the instance buffers with the slices of the visible regions. */
  pack(visible: Set<string>) {
    const keys: string[] = [];
    for (const k of this.slices.keys()) if (visible.has(k)) keys.push(k);
    const sig = keys.join('|');
    if (!this.stale && sig === this.packed) return;
    let total = 0;
    for (const k of keys) total += this.slices.get(k)!.n;
    this.ensure(total);
    this.stale = false;
    this.packed = sig;
    const { spawn, inst } = this;
    let o = 0;
    for (const k of keys) {
      const sl = this.slices.get(k)!;
      this.castle?.instanceMatrix.array.set(sl.mat, o * 16);
      this.water?.instanceMatrix.array.set(sl.mat, o * 16);
      spawn?.array.set(sl.spawn, o);
      inst?.array.set(sl.inst, o * 4);
      o += sl.n;
    }
    for (const mesh of [this.castle, this.water]) {
      if (!mesh) continue;
      mesh.count = total;
      mesh.visible = total > 0;
      if (total) mesh.instanceMatrix.needsUpdate = true;
    }
    if (total && spawn) spawn.needsUpdate = true;
    if (total && inst) inst.needsUpdate = true;
  }

  private dispose() {
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
 * Instanced meshes per (module, style), split into culling regions; rendering is flushed lazily.
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
  /** bumped by `clear` (a whole new castle) */
  epoch = 0;
  /** bounds of each region's instances (all modules), rebuilt when instances change */
  private regions = new Map<string, THREE.Box3>();
  private regionsDirty = true;
  private visible = new Set<string>();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private tmpBox = new THREE.Box3();
  private shadowBox = new THREE.Box3();

  get(x: number, y: number, z: number) {
    return this.cells.get(cellKey(x, y, z));
  }

  /**
   * Build every module's geometry and push each one through the real materials and render
   * pipeline once (vertex buffers uploaded, shaders compiled, shadow pass included), so nothing
   * stalls the first time a piece appears. Run behind the boot veil; `render` draws one frame.
   */
  async warmUp(at: THREE.Vector3, render: () => void, onProgress: (k: number) => void) {
    const pairs: [string, number][] = [];
    for (const id of Object.keys(BUILDERS)) {
      // decor pieces take the style of the piece they dress (at most two)
      const styles = MODULE_BY_ID.get(id)?.styles ?? 2;
      for (let st = 0; st < styles; st++) pairs.push([id, st]);
    }
    const nextFrame = () => new Promise((r) => setTimeout(r, 0));
    let t = performance.now();
    for (let i = 0; i < pairs.length; i++) {
      try {
        moduleGeometry(...pairs[i]);
      } catch {
        pairs.splice(i--, 1); // a decor piece without that style
      }
      if (performance.now() - t > 40) {
        onProgress((i / pairs.length) * 0.85);
        await nextFrame();
        t = performance.now();
      }
    }
    const group = new THREE.Group();
    const spawn = new THREE.InstancedBufferAttribute(new Float32Array([-100]), 1);
    const inst = new THREE.InstancedBufferAttribute(new Float32Array([at.x, at.y, at.z, 0]), 4);
    for (const [id, st] of pairs) {
      const g = moduleGeometry(id, st);
      for (const [src, mat] of [[g.castle, this.castleMat], [g.water, this.waterMat]] as const) {
        if (!src) continue;
        const geo = new THREE.BufferGeometry();
        for (const [name, attr] of Object.entries(src.attributes)) geo.setAttribute(name, attr);
        if (src.index) geo.setIndex(src.index);
        geo.setAttribute('aSpawn', spawn);
        geo.setAttribute('aInst', inst);
        const mesh = new THREE.InstancedMesh(geo, mat, 1);
        mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = mat === this.castleMat;
        group.add(mesh);
      }
    }
    onProgress(0.9);
    await nextFrame();
    this.root.add(group);
    render();
    this.root.remove(group);
    onProgress(1);
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

  set(x: number, y: number, z: number, v: number, spawn = -100, offset?: { x: number; z: number }) {
    const key = cellKey(x, y, z);
    this.removeKey(key);
    const m = VARIANTS[v].module;
    const rec: CellRec = {
      x, y, z, v,
      // spans share one style: hash ignores the coordinate along the span axis
      style: Math.floor((SKY_BRIDGES.has(m.id) ? (VARIANTS[v].rot % 2 ? hash3(x, y, 0, 1) : hash3(0, y, z, 1)) : hash3(x, y, z, 1)) * m.styles),
      vrot: m.randomVisualRot ? Math.floor(hash3(x, y, z, 2) * 4) : 0,
      spawn,
      ox: offset?.x ?? 0,
      oz: offset?.z ?? 0,
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
    this.epoch++;
  }

  /** Push pending changes to the GPU. Call once per frame. */
  flush() {
    for (const key of this.dirty) {
      const g = this.groups.get(key)!;
      const list: Inst[] = [];
      for (const k of g.members) {
        const c = this.cells.get(k)!;
        list.push({ x: c.x, y: c.y, z: c.z, rot: VARIANTS[c.v].rot + c.vrot, spawn: c.spawn, ox: c.ox, oz: c.oz });
      }
      g.write(list);
      this.regionsDirty = true;
    }
    this.dirty.clear();
    if (this.decorDirty) this.rebuildDecor();
  }

  /**
   * Pack each module's instance buffers with the regions worth drawing: inside the camera's view
   * (or casting a shadow into it, when `sunDir` is given) and nearer than `maxDist`, where the
   * fog has fully swallowed everything. Call after `flush`, before rendering.
   */
  cull(camera: THREE.Camera, maxDist: number, sunDir: THREE.Vector3 | null) {
    if (this.regionsDirty) {
      this.regionsDirty = false;
      this.regions.clear();
      for (const g of this.groups.values())
        for (const [k, sl] of g.slices) {
          const b = this.regions.get(k);
          if (b) b.union(sl.box);
          else this.regions.set(k, sl.box.clone());
        }
    }
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem);
    const eye = camera.position;
    this.visible.clear();
    for (const [k, box] of this.regions) {
      const b = this.tmpBox.copy(box);
      if (sunDir) {
        // where the region's shadow can fall: its bounds pushed away from the sun down to the ground
        const len = box.max.y / Math.max(sunDir.y, 0.2);
        const sb = this.shadowBox.copy(box);
        sb.min.x -= sunDir.x * len;
        sb.max.x -= sunDir.x * len;
        sb.min.z -= sunDir.z * len;
        sb.max.z -= sunDir.z * len;
        sb.min.y = -1.2;
        b.union(sb);
      }
      if (b.distanceToPoint(eye) > maxDist || !this.frustum.intersectsBox(b)) continue;
      this.visible.add(k);
    }
    for (const g of this.groups.values()) g.pack(this.visible);
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
      const inst = (rot: number): Inst => ({ x, y, z, rot, spawn: c.spawn, ox: c.ox, oz: c.oz });
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
    this.regionsDirty = true;
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
        pts.push(p.x + c.x * CELL_W + c.ox, p.y + c.y * CELL_H, p.z + c.z * CELL_W + c.oz);
      }
    }
    this.smokeCache = { version: this.version, data: new Float32Array(pts) };
    return this.smokeCache.data;
  }

  private windowCache = { version: -1, data: new Float32Array(0), pendingUntil: Infinity };

  /**
   * World-space lit-window spots, 13 floats each: x, y, z, normal x, normal z, area, r, g, b,
   * time the building finished popping in, width (0 when it is not a window pane: lanterns, flames),
   * height, height of the window's centre above the spot (recomputed when the world changes).
   * Feeds the night window light on the ground and the light spilling onto the walls. Room
   * windows take the colour of the room they show. A building's spots wait until it has popped in (`now` = the
   * animation clock), then fade in from that time.
   */
  windowSpots(now: number): Float32Array {
    const cache = this.windowCache;
    if (cache.version === this.version && now < cache.pendingUntil) return cache.data;
    let pendingUntil = Infinity;
    const out: number[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const c of this.cells.values()) {
      const m = VARIANTS[c.v].module;
      if (m.id === 'air') continue;
      const spots = windowSpotsOf(m.id, c.style);
      if (!spots.length) continue;
      const grown = c.spawn + 0.5;
      if (grown > now) {
        pendingUntil = Math.min(pendingUntil, grown);
        continue;
      }
      const ang = ((VARIANTS[c.v].rot + c.vrot) * Math.PI) / 2;
      const ix = c.x * CELL_W + c.ox, iy = c.y * CELL_H, iz = c.z * CELL_W + c.oz;
      for (let i = 0; i < spots.length; i += SPOT) {
        const seed = spots[i + 9];
        if (windowOff(seed, ix, iy, iz)) continue; // a dark window casts no light
        p.set(spots[i], spots[i + 1], spots[i + 2]).applyAxisAngle(up, ang);
        n.set(spots[i + 3], 0, spots[i + 4]).applyAxisAngle(up, ang);
        let r = spots[i + 6], g = spots[i + 7], b = spots[i + 8];
        if (spots[i + 12]) [r, g, b] = ROOMS[roomOfWindow(seed, ix, iy, iz)].light;
        out.push(p.x + ix, p.y + iy, p.z + iz, n.x, n.z, spots[i + 5], r, g, b, grown, seed > 0 ? spots[i + 10] : 0, spots[i + 11], spots[i + 13]);
      }
    }
    this.windowCache = { version: this.version, data: new Float32Array(out), pendingUntil };
    return this.windowCache.data;
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

const spotCache = new Map<string, number[]>();

/** floats per local window spot */
const SPOT = 14;

/**
 * Lit-window spots of a module in its local frame, 14 floats each: x, y, z, nx, nz, area, r, g,
 * b, window id (0 = always lit, see `windowOff`), width, height, 1 if it shows a painted room,
 * height of the window's centre above the spot.
 * Emissive, vertical triangles clustered per window, area-weighted.
 */
function windowSpotsOf(id: string, style: number): number[] {
  const key = `${id}:${style}`;
  const cached = spotCache.get(key);
  if (cached) return cached;
  const g = moduleGeometry(id, style).castle;
  const spots: number[] = [];
  if (g) {
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const col = g.getAttribute('color');
    const fx = g.getAttribute('aFx');
    type Cluster = { x: number; y: number; z: number; nx: number; nz: number; a: number; r: number; g: number; b: number; seed: number; room: number; u0: number; u1: number; y0: number; y1: number };
    const clusters = new Map<string, Cluster>();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i + 2 < pos.count; i += 3) {
      const e = (fx.getX(i) + fx.getX(i + 1) + fx.getX(i + 2)) / 3;
      if (e < 0.2) continue;
      const ny = (nor.getY(i) + nor.getY(i + 1) + nor.getY(i + 2)) / 3;
      if (Math.abs(ny) > 0.3) continue;
      const nx = (nor.getX(i) + nor.getX(i + 1) + nor.getX(i + 2)) / 3;
      const nz = (nor.getZ(i) + nor.getZ(i + 1) + nor.getZ(i + 2)) / 3;
      const nl = Math.hypot(nx, nz) || 1;
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      if (area < 1e-4) continue;
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
      // one cluster per window: its id if it can go dark (so its light goes with it), else a
      // coarse cell along the facade; plus the facing direction
      const seed = fx.getW(i);
      const facing = `${Math.round((nx / nl) * 2)},${Math.round((nz / nl) * 2)}`;
      const k = seed > 0 ? `w${seed},${facing}` : `${Math.round(cx / 0.8)},${Math.round(cy / 1.2)},${Math.round(cz / 0.8)},${facing}`;
      let s = clusters.get(k);
      if (!s) clusters.set(k, (s = { x: 0, y: 0, z: 0, nx: 0, nz: 0, a: 0, r: 0, g: 0, b: 0, seed, room: 0, u0: Infinity, u1: -Infinity, y0: Infinity, y1: -Infinity }));
      if (Math.round(fx.getZ(i)) === 13) s.room = 1;
      // extent across the facade (along the tangent) and up
      for (const v of [a, b, c]) {
        const u = (-v.x * nz + v.z * nx) / nl;
        s.u0 = Math.min(s.u0, u); s.u1 = Math.max(s.u1, u);
        s.y0 = Math.min(s.y0, v.y); s.y1 = Math.max(s.y1, v.y);
      }
      const w = area * e;
      s.x += cx * w; s.y += cy * w; s.z += cz * w;
      s.nx += (nx / nl) * w; s.nz += (nz / nl) * w;
      s.r += col.getX(i) * w; s.g += col.getY(i) * w; s.b += col.getZ(i) * w;
      s.a += w;
    }
    for (const s of clusters.values()) {
      if (s.a < 0.03) continue;
      const nl = Math.hypot(s.nx, s.nz) || 1;
      const peak = Math.max(s.r, s.g, s.b) / s.a || 1;
      spots.push(s.x / s.a, s.y / s.a, s.z / s.a, s.nx / nl, s.nz / nl, s.a, s.r / s.a / peak, s.g / s.a / peak, s.b / s.a / peak, s.seed, s.u1 - s.u0, s.y1 - s.y0, s.room, (s.y0 + s.y1) / 2 - s.y / s.a);
    }
  }
  spotCache.set(key, spots);
  return spots;
}
