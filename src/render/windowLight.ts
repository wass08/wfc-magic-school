import * as THREE from 'three/webgpu';
import {
  abs,
  attribute,
  exp,
  length,
  max,
  positionLocal,
  select,
  varying,
  float,
  min,
  mix,
  positionGeometry,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * Night window light cast on the ground.
 *
 * Every lit window (an emissive, vertical face of a module) becomes a soft pool of its own
 * colour on the ground in front of it, longer and dimmer the higher the window. The pools are
 * splatted from above into a light map that follows the camera; flat surfaces (paving, grass,
 * terraces, wall walks, water, the ground) sample it as extra light. Cheap, no shadow-casting
 * lights: one additive pass of instanced quads, re-rendered only when the castle or the map's
 * window moves.
 */

/** World size covered by the light map, and its resolution. */
const SIZE = 256;
const RES = 1024;
const SNAP = (SIZE / RES) * 16;

const rt = new THREE.RenderTarget(RES, RES, { type: THREE.HalfFloatType, depthBuffer: false });
rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;

export const windowLight = {
  /** map centre (world xz) */
  center: uniform(new THREE.Vector2()),
  /** overall strength: 0 by day, rising with the lamps */
  level: uniform(0),
  /** animation clock (pools fade in from their building's arrival) */
  time: uniform(0),
  /** light spilling onto the walls around lit windows: 0 by day, rising with the lamps */
  spill: uniform(0),
};

/** seconds a new pool takes to fade in */
const FADE_IN = 1.2;

/** Light reaching a surface at the current fragment, for a world-space normal. */
export function windowLightAt(normal: any): any {
  const uv = positionWorld.xz.sub(windowLight.center).div(SIZE).add(0.5);
  const edge = smoothstep(0, 0.1, min(min(uv.x, uv.y), min(float(1).sub(uv.x), float(1).sub(uv.y))));
  // rendered looking down with screen-up = −z; three's render-target sampling already lines
  // uv.y up with +z here (checked on both the WebGPU and WebGL2 backends)
  const tex = texture(rt.texture, uv).rgb;
  return tex.mul(smoothstep(0.8, 0.97, normal.y)).mul(edge).mul(windowLight.level);
}

// --- pool splatting ---------------------------------------------------------------------------

const MAX_POOLS = 65536;
/** floats per window spot */
const SPOT = 13;

// --- light spilling onto the walls ----------------------------------------------------------

/** how far in front of the wall the spill quad floats (clear of the sill and the frame) */
const SPILL_OFFSET = 0.17;

/**
 * Light from a lit window spilling onto the stone around it: a warm glow on the sill and the
 * frame, fading out over the wall, mostly downward. One quad per lit window, just in front of
 * the facade, blended multiplicatively (dst × (1 + glow)), so it brightens and tints whatever
 * is behind it by that surface's own colour, the way light does; round towers need no fitting.
 * Lives in the main scene (see Stage); empty by day.
 */
export class WindowSpill {
  readonly mesh: THREE.InstancedMesh;
  private aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 4), 4);
  private aDir = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 4), 4);
  private aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 3), 3);

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aDir', this.aDir);
    geo.setAttribute('aColor', this.aColor);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.DstColorFactor;
    m.blendDst = THREE.OneFactor;
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    const pos = attribute<'vec4'>('aPos', 'vec4'); // window centre, arrival time
    const dir = attribute<'vec4'>('aDir', 'vec4'); // facing xz, window width, height
    const col = attribute<'vec3'>('aColor', 'vec3');
    const w = dir.z, h = dir.w;
    // glow reach grows a little with the window; the quad reaches further below (sill, wall under it)
    const reach = float(0.3).add(length(vec2(w, h)).mul(0.14));
    const lx = positionLocal.x, ly = positionLocal.y; // −0.5…0.5
    const u = lx.mul(w.add(reach.mul(2.4)));
    const v = select(ly.lessThan(0), ly.mul(h.add(reach.mul(3.6))), ly.mul(h.add(reach.mul(2))));
    const n = vec3(dir.x, 0, dir.y);
    const t = vec3(dir.y, 0, dir.x.negate()); // across, so the quad faces out of the wall
    m.positionNode = pos.xyz.add(n.mul(SPILL_OFFSET)).add(t.mul(u)).add(vec3(0, 1, 0).mul(v));
    const uv = varying(vec2(u, v));
    // distance out of the window's rectangle (stretched upward: light falls rather than rises)
    const half = vec2(w, h).mul(0.5);
    const out = max(abs(uv).sub(half), vec2(0));
    const d = length(vec2(out.x, out.y.mul(select(uv.y.lessThan(0), float(0.65), float(1.25)))));
    const glow = exp(d.div(reach).mul(-2.4));
    // the pane itself is already lit: only its rim takes a little
    const inside = max(abs(uv.x).div(half.x), abs(uv.y).div(half.y));
    const rim = mix(float(0.15), float(1), smoothstep(0.8, 1, inside));
    // the sill catches the most
    const sill = smoothstep(0.14, 0, abs(uv.y.add(half.y).add(0.03))).mul(smoothstep(0.14, 0, out.x)).mul(0.8);
    // fully faded by the quad's edges (no rectangle on the wall)
    const quad = varying(vec2(lx, ly));
    const edge = smoothstep(0.5, 0.3, abs(quad.x)).mul(smoothstep(0.5, 0.3, abs(quad.y)));
    const arrive = smoothstep(pos.w, pos.w.add(FADE_IN), windowLight.time);
    m.colorNode = col.mul(glow.mul(rim).mul(edge).add(sill)).mul(arrive).mul(windowLight.spill);
    this.mesh = new THREE.InstancedMesh(geo, m, MAX_POOLS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
  }

  setSpots(spots: Float32Array) {
    const P = this.aPos.array as Float32Array;
    const D = this.aDir.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    // window panes only (width 0 marks lanterns and flames: no wall to light around them)
    let n = 0;
    for (let k = 0; k < spots.length / SPOT && n < MAX_POOLS; k++) {
      const o = k * SPOT;
      if (spots[o + 10] <= 0) continue;
      const i = n++;
      P[i * 4] = spots[o];
      P[i * 4 + 1] = spots[o + 1] + spots[o + 12];
      P[i * 4 + 2] = spots[o + 2];
      P[i * 4 + 3] = spots[o + 9];
      D[i * 4] = spots[o + 3];
      D[i * 4 + 1] = spots[o + 4];
      D[i * 4 + 2] = spots[o + 10];
      D[i * 4 + 3] = Math.max(0.1, spots[o + 11]);
      C[i * 3] = spots[o + 6];
      C[i * 3 + 1] = spots[o + 7];
      C[i * 3 + 2] = spots[o + 8];
    }
    this.mesh.count = n;
    this.aPos.needsUpdate = this.aDir.needsUpdate = this.aColor.needsUpdate = true;
  }
}

export class WindowPools {
  /** the same windows' light on the walls (add `spill.mesh` to the main scene) */
  readonly spill = new WindowSpill();
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-SIZE / 2, SIZE / 2, SIZE / 2, -SIZE / 2, 0.1, 500);
  private mesh: THREE.InstancedMesh;
  private aPool = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 4), 4);
  private aShape = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 4), 4);
  private aColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_POOLS * 3), 3);
  private dirty = true;
  /** the map re-renders every frame until the newest pool has faded in */
  private fadeUntil = -Infinity;
  private renderedAt = new THREE.Vector2(Infinity, Infinity);

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    geo.setAttribute('aPool', this.aPool);
    geo.setAttribute('aShape', this.aShape);
    geo.setAttribute('aColor', this.aColor);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const pool = attribute<'vec4'>('aPool', 'vec4'); // centre xz, direction xz (away from the wall)
    const shape = attribute<'vec4'>('aShape', 'vec4'); // length, width, intensity, arrival time
    const col = attribute<'vec3'>('aColor', 'vec3');
    const lx = positionGeometry.x; // across the facade, −0.5…0.5
    const lz = positionGeometry.z.negate(); // −0.5 at the wall … 0.5 far
    const dir = pool.zw;
    const perp = vec2(dir.y.negate(), dir.x);
    const xz = pool.xy.add(dir.mul(lz.mul(shape.x))).add(perp.mul(lx.mul(shape.y)));
    m.positionNode = vec3(xz.x, 0, xz.y);
    const d2 = lx.mul(lx).add(lz.mul(lz)).mul(4);
    const falloff = exp(d2.mul(-3.2)).mul(mix(float(1.35), float(0.55), lz.add(0.5)));
    const arrive = smoothstep(shape.w, shape.w.add(FADE_IN), windowLight.time);
    m.colorNode = col.mul(shape.z).mul(falloff).mul(arrive);
    this.mesh = new THREE.InstancedMesh(geo, m, MAX_POOLS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.camera.up.set(0, 0, -1);
  }

  /**
   * Window spots in world space, 13 floats each: x, y, z, nx, nz, area, r, g, b, arrival time,
   * width, height, centre offset (see `World.windowSpots`).
   */
  setSpots(spots: Float32Array) {
    this.spill.setSpots(spots);
    const n = Math.min(MAX_POOLS, spots.length / SPOT);
    this.fadeUntil = -Infinity;
    const P = this.aPool.array as Float32Array;
    const Sh = this.aShape.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const o = i * SPOT;
      const h = Math.max(0, spots[o + 1]);
      const nx = spots[o + 3], nz = spots[o + 4];
      const area = spots[o + 5];
      const reach = 0.4 + h * 0.45;
      const len = 1.8 + h * 1.0;
      P[i * 4] = spots[o] + nx * (reach + len * 0.5);
      P[i * 4 + 1] = spots[o + 2] + nz * (reach + len * 0.5);
      P[i * 4 + 2] = nx;
      P[i * 4 + 3] = nz;
      Sh[i * 4] = len;
      Sh[i * 4 + 1] = 1.2 + h * 0.4 + Math.sqrt(area) * 0.9;
      Sh[i * 4 + 2] = (Math.min(area, 1.2) * 1.8) / (1 + h * 0.3);
      Sh[i * 4 + 3] = spots[o + 9];
      this.fadeUntil = Math.max(this.fadeUntil, spots[o + 9] + FADE_IN);
      C[i * 3] = spots[o + 6];
      C[i * 3 + 1] = spots[o + 7];
      C[i * 3 + 2] = spots[o + 8];
    }
    this.mesh.count = n;
    this.aPool.needsUpdate = this.aShape.needsUpdate = this.aColor.needsUpdate = true;
    this.dirty = true;
  }

  /** Re-render the light map when the pools changed or the map has to follow the camera. */
  update(renderer: THREE.WebGPURenderer, target: THREE.Vector3, now: number) {
    windowLight.time.value = now;
    const cx = Math.round(target.x / SNAP) * SNAP;
    const cz = Math.round(target.z / SNAP) * SNAP;
    const fading = now < this.fadeUntil;
    if (!this.dirty && !fading && cx === this.renderedAt.x && cz === this.renderedAt.y) return;
    this.dirty = false;
    this.renderedAt.set(cx, cz);
    this.camera.position.set(cx, 100, cz);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateMatrixWorld();
    const prev = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(prevClear, prevAlpha);
    windowLight.center.value.set(cx, cz);
  }
}
