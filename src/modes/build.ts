import * as THREE from 'three';
import { CELL_H, CELL_W, DIRS } from '../config';
import { moduleGeometry } from '../geo';
import { createGhostMaterial } from '../render/materials';
import { Stage } from '../render/stage';
import { World } from '../render/world';
import { MAX_BUILD_LEVEL, candidatesAt } from '../wfc/fit';
import { JOIN_SOCKETS } from '../wfc/modules';
import { AIR_INDEX, VARIANTS, Variant } from '../wfc/variants';
import { Pick, PickShape, pickCell } from './pick';

const SOCKET_COLORS: Record<string, THREE.Color> = {
  w: new THREE.Color(2.2, 1.6, 0.6),
  h: new THREE.Color(2.2, 1.1, 0.4),
  hr: new THREE.Color(2.2, 1.1, 0.4),
  c: new THREE.Color(0.6, 1.8, 1.4),
  ge: new THREE.Color(2.4, 1.3, 0.5),
  re: new THREE.Color(2.4, 1.3, 0.5),
  gi: new THREE.Color(1.6, 1.6, 2.2),
  ri: new THREE.Color(1.6, 1.6, 2.2),
  top: new THREE.Color(1.4, 0.9, 2.6),
};

/**
 * Click-to-place editor. Hover a face of any module (or the ground) to preview
 * what fits there; the palette restricts to one module, "auto" lets the
 * socket rules choose. R cycles through the variants that fit.
 */
export class BuildMode {
  selected: string | null = null; // null = auto
  showSockets = true;
  private enabled = false;
  private pick: Pick | null = null;
  private candidates: Variant[] = [];
  private candIndex = 0;
  private ghost = new THREE.Group();
  private ghostMat = createGhostMaterial();
  private outline: THREE.LineSegments;
  private markers: THREE.InstancedMesh;
  private markersVersion = -1;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private down: { x: number; y: number; button: number } | null = null;
  onHint: (msg: string) => void = () => {};
  /** The hovered placement: module name and which of its fits is previewed (null = nothing fits). */
  onState: (s: { name: string; index: number; count: number } | null) => void = () => {};
  /** A module was placed / removed at these client coordinates (and grid cell). */
  onPlace: (x: number, y: number, cell: [number, number, number], v: Variant) => void = () => {};
  onRemove: (x: number, y: number, cell: [number, number, number], count: number) => void = () => {};
  /** A click where nothing fits. */
  onDenied: () => void = () => {};
  /** The pointer moved onto another cell (`ok`: something fits there). */
  onHoverCell: (cell: [number, number, number], ok: boolean) => void = () => {};
  private lastClient = { x: 0, y: 0 };

  /** Open sockets currently marked (valid while sockets are shown). */
  get socketCount() {
    return this.markers.count;
  }

  constructor(private stage: Stage, private world: World) {
    const box = new THREE.BoxGeometry(CELL_W, CELL_H, CELL_W);
    box.translate(0, CELL_H / 2, 0);
    this.outline = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: '#9fffb0', transparent: true, opacity: 0.8, depthTest: false }));
    this.outline.renderOrder = 10;
    this.outline.visible = false;
    this.ghost.visible = false;
    stage.scene.add(this.outline, this.ghost);

    const mGeo = new THREE.OctahedronGeometry(0.28);
    this.markers = new THREE.InstancedMesh(mGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 4096);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.visible = false;
    stage.scene.add(this.markers);

    const el = stage.renderer.domElement;
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerleave', () => (this.pointerIn = false));
    el.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY, button: e.button }));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('contextmenu', (e) => this.enabled && e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.stage.grid.visible = on;
    this.markers.visible = on && this.showSockets;
    if (!on) {
      this.ghost.visible = this.outline.visible = false;
      this.pick = null;
    } else {
      this.markersVersion = -1;
    }
  }

  select(moduleId: string | null) {
    this.selected = moduleId;
    this.candIndex = 0;
    this.refresh();
  }

  private lookup = (x: number, y: number, z: number) => this.world.variantAt(x, y, z);
  private solid = (x: number, y: number, z: number) => {
    const v = this.world.variantAt(x, y, z);
    return v !== undefined && v !== AIR_INDEX;
  };

  private pickMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

  /**
   * Pick volumes: the base slab (ground floor only) plus the structure's real surface above it,
   * so you can aim past slim towers and a wall's face never reads as its roof.
   */
  private pickBox = (x: number, y: number, z: number): PickShape[] | null => {
    const c = this.world.get(x, y, z);
    if (!c || c.v === AIR_INDEX) return null;
    const v = VARIANTS[c.v];
    const r = (v.rot + c.vrot) % 4;
    const offset = new THREE.Vector3(x * CELL_W, y * CELL_H, z * CELL_W);
    const shapes: PickShape[] = [];
    const geo = v.module.category === 'ground' || v.module.category === 'garden' ? null : moduleGeometry(v.module.id, c.style).castle;
    if (geo && !geo.boundingBox) geo.computeBoundingBox();
    const upper = geo?.boundingBox ?? null;
    // a flat tile is its slab; a structure is its own surface (plinth included)
    if (y === 0 && !(geo && upper)) shapes.push({ box: new THREE.Box3(new THREE.Vector3(-2, -1, -2), new THREE.Vector3(2, 0.05, 2)).translate(offset) });
    if (geo && upper) {
      const b = upper.clone();
      // quarter-turn rotation about Y: (x, z) -> (z, -x) per step
      for (let k = 0; k < r; k++) b.set(new THREE.Vector3(b.min.z, b.min.y, -b.max.x), new THREE.Vector3(b.max.z, b.max.y, -b.min.x));
      const mesh = new THREE.Mesh(geo, this.pickMat);
      mesh.position.copy(offset);
      mesh.rotation.y = (r * Math.PI) / 2;
      shapes.push({ box: b.translate(offset), mesh });
    }
    return shapes;
  };

  private lastCam = new THREE.Matrix4();
  private pointerIn = false;

  private onMove(e: PointerEvent) {
    if (!this.enabled) return;
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerIn = true;
    this.repick(true);
  }

  private repick(fromPointer = false) {
    this.raycaster.setFromCamera(this.pointer, this.stage.camera);
    this.lastCam.copy(this.stage.camera.matrixWorld);
    const p = pickCell(this.raycaster.ray, this.pickBox);
    const same = p && this.pick && p.target.join() === this.pick.target.join() && p.hit?.join() === this.pick.hit?.join();
    this.pick = p;
    if (!same) {
      this.candIndex = 0;
      this.refresh();
      if (fromPointer && p) this.onHoverCell(p.target, this.candidates.length > 0);
    }
  }

  private onUp(e: PointerEvent) {
    if (!this.enabled || !this.down) return;
    const moved = Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 5;
    const button = this.down.button;
    this.down = null;
    if (moved) return;
    this.lastClient = { x: e.clientX, y: e.clientY };
    if (button === 2 || (button === 0 && e.shiftKey)) this.removeHovered();
    else if (button === 0) this.place();
  }

  private onKey(e: KeyboardEvent) {
    if (!this.enabled || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'x' || e.key === 'Delete' || e.key === 'Backspace') {
      this.removeHovered();
    }
  }

  /** Preview the next (or previous) variant that fits the hovered cell. */
  cycle(dir = 1) {
    if (!this.candidates.length) return false;
    this.candIndex = (this.candIndex + dir + this.candidates.length) % this.candidates.length;
    this.showGhost();
    return this.candidates.length > 1;
  }

  private place() {
    if (!this.pick) return;
    if (!this.candidates.length) return this.onDenied();
    const v = this.candidates[this.candIndex % this.candidates.length];
    const [x, y, z] = this.pick.target;
    this.world.set(x, y, z, v.index, this.stage.now());
    this.onPlace(this.lastClient.x, this.lastClient.y, [x, y, z], v);
    this.pick = { hit: [x, y, z], target: [x, y + 1, z] };
    this.candIndex = 0;
    this.refresh();
  }

  private removeHovered() {
    if (!this.pick?.hit) return;
    const [x, y, z] = this.pick.hit;
    // removing a cell also removes whatever was stacked on it
    let count = 0;
    for (let yy = y; this.world.get(x, yy, z); yy++, count++) this.world.remove(x, yy, z);
    this.onRemove(this.lastClient.x, this.lastClient.y, [x, y, z], count);
    this.pick = { target: [x, y, z] };
    this.refresh();
  }

  private refresh() {
    if (!this.enabled || !this.pick) {
      this.ghost.visible = this.outline.visible = false;
      return;
    }
    const [x, y, z] = this.pick.target;
    // auto mixes it up among equally good fits (one roll per module, so its turns stay together)
    const rolls = new Map<string, number>();
    const jitter = this.selected ? undefined : (id: string) => {
      if (!rolls.has(id)) rolls.set(id, Math.random() * 1.6);
      return rolls.get(id)!;
    };
    this.candidates = candidatesAt(this.lookup, x, y, z, this.selected ?? undefined, jitter);
    this.outline.position.set(x * CELL_W, y * CELL_H, z * CELL_W);
    this.outline.visible = true;
    this.showGhost();
  }

  private showGhost() {
    const ok = this.candidates.length > 0;
    (this.outline.material as THREE.LineBasicMaterial).color.set(ok ? '#9fffb0' : '#ff6b8a');
    this.ghost.clear();
    if (!ok || !this.pick) {
      this.ghost.visible = false;
      const [x, y, z] = this.pick?.target ?? [0, 0, 0];
      const name = this.selected ? VARIANTS.find((v) => v.module.id === this.selected)?.module.name : 'anything';
      const below = y > 0 ? this.world.variantAt(x, y - 1, z) : undefined;
      this.onHint(
        y > MAX_BUILD_LEVEL
          ? 'As high as the castle goes'
          : below !== undefined && below !== AIR_INDEX && VARIANTS[below].topKey === 'air'
            ? `Nothing stacks on a ${VARIANTS[below].module.name.toLowerCase()}`
            : y > 0 && !this.pick?.hit
              ? 'Upper floors need something below'
              : `No socket fit for ${name} here`,
      );
      this.onState(null);
      return;
    }
    const v = this.candidates[this.candIndex % this.candidates.length];
    const g = moduleGeometry(v.module.id, 0);
    for (const geo of [g.castle, g.water]) if (geo) this.ghost.add(new THREE.Mesh(geo, this.ghostMat));
    const [x, y, z] = this.pick.target;
    this.ghost.position.set(x * CELL_W, y * CELL_H, z * CELL_W);
    this.ghost.rotation.y = (v.rot * Math.PI) / 2;
    this.ghost.visible = true;
    const n = this.candidates.length;
    this.onHint('');
    this.onState({ name: v.module.name, index: this.candIndex % n, count: n });
  }

  private rebuildMarkers() {
    const m = new THREE.Matrix4();
    let i = 0;
    for (const c of this.world.cells.values()) {
      if (c.v === AIR_INDEX) continue;
      const v = VARIANTS[c.v];
      for (let d = 0; d < 4; d++) {
        const s = v.sides[d];
        if (!JOIN_SOCKETS.has(s)) continue;
        const [dx, , dz] = DIRS[d];
        if (this.solid(c.x + dx, c.y, c.z + dz)) continue;
        m.makeTranslation((c.x + dx * 0.5) * CELL_W, c.y * CELL_H + CELL_H * 0.55, (c.z + dz * 0.5) * CELL_W);
        this.markers.setMatrixAt(i, m);
        this.markers.setColorAt(i, SOCKET_COLORS[s] ?? SOCKET_COLORS.top);
        i++;
      }
      if (v.topKey !== 'air' && !this.solid(c.x, c.y + 1, c.z)) {
        m.makeTranslation(c.x * CELL_W, (c.y + 1) * CELL_H + 0.4, c.z * CELL_W);
        this.markers.setMatrixAt(i, m);
        this.markers.setColorAt(i, SOCKET_COLORS.top);
        i++;
      }
      if (i >= 4090) break;
    }
    this.markers.count = i;
    this.markers.instanceMatrix.needsUpdate = true;
    if (this.markers.instanceColor) this.markers.instanceColor.needsUpdate = true;
  }

  update(t: number) {
    if (!this.enabled) return;
    // the camera keeps gliding after a drag (damping): keep the hover in sync
    if (this.pointerIn && !this.lastCam.equals(this.stage.camera.matrixWorld)) this.repick();
    if (this.showSockets && this.markersVersion !== this.world.version) {
      this.markersVersion = this.world.version;
      this.rebuildMarkers();
    }
    this.markers.visible = this.showSockets;
    this.markers.position.y = Math.sin(t * 2.5) * 0.12;
    this.ghostMat.opacity = 0.3 + 0.12 * Math.sin(t * 5);
  }
}
