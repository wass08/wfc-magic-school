import * as THREE from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  color,
  exp2,
  float,
  floor,
  fog,
  fract,
  fwidth,
  length,
  max,
  mix,
  output,
  pass,
  pmremTexture,
  positionWorld,
  positionWorldDirection,
  renderOutput,
  saturation,
  screenUV,
  select,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CELL_W } from '../config';
import { globalUniforms } from './materials';
import { makeSpriteCloud, spriteSize, spriteUV } from './sprites';
import { WindowPools, windowLight, windowLightAt } from './windowLight';
import { createDaylightSky, WEATHER_COVER } from './sky/sky';
import { createSolarLight, solarLightAt } from './sky/solar';

export type TimeOfDay = 'day' | 'dusk' | 'night';

/**
 * Sun positions for the three times of day. Elevations are the Pascal viewer's presets
 * (Midday · Blue hour −4° · Night −14°); azimuths are art-directed for the castle.
 */
const TIMES: Record<TimeOfDay, { elevation: number; azimuth: number }> = {
  day: { elevation: 52, azimuth: 205 },
  dusk: { elevation: -4, azimuth: 250 },
  night: { elevation: -14, azimuth: 262 },
};

// --- Pascal viewer daylight look (packages/viewer daylight-atmosphere.tsx + look.ts) -----------
/** Irradiance that renders at exposure 1 (≈ a clear afternoon exterior). */
const METER_REF = 3.2;
/** Image-based lighting gain on the sky environment. */
const ENV_INTENSITY = 1.15;
const MOON_COLOR = new THREE.Color('#9fb4ff');
/** Eye-like chromatic adaptation strength (0 = off, 1 = full neutralisation). */
const WHITE_BALANCE = 0.75;
const GRADE = { contrast: 1.06, saturation: 1.06, vignette: 0.12 };
const BLOOM = { strength: 0.12, radius: 0.18, softKnee: 0.4 };
/** Extra bloom once the lamps are lit: the windows and lanterns get a soft halo. */
const NIGHT_BLOOM = { strength: 0.6, radius: 0.32 };
/** a faint cool sheen window glass keeps even when the sky is black */
const _moonGlass = new THREE.Vector3(0.03, 0.036, 0.055);
/** Strength of the window light cast on the ground at full night. */
const WINDOW_LIGHT = 1.4;
/** light spilling onto the walls around lit windows (multiplies the wall: 1 + this at the frame) */
const WINDOW_SPILL = 3;
/** Weather: Pascal's default "fair" sky. */
const COVER = WEATHER_COVER.fair;

const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** Cosine-weighted hemisphere probes for the sky irradiance colour. */
const HEMISPHERE = [
  new THREE.Vector3(0, 1, 0),
  ...Array.from({ length: 6 }, (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 3), 0.6, Math.sin((i * Math.PI) / 3)).normalize()),
  ...Array.from({ length: 6 }, (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 3 + 0.5), 0.15, Math.sin((i * Math.PI) / 3 + 0.5)).normalize()),
];
const UP = new THREE.Vector3(0, 1, 0);

/** Pascal's daylight ground: faint, distance-stable squares over long diagonal bands. */
function daylightGroundColor(base: any): any {
  const p = positionWorld.xz;
  const texel = max(fwidth(p.x), fwidth(p.y));
  const lod = clamp(texel.mul(1.7).mul(4).max(1e-6).log2(), 0, 8);
  const l0 = lod.floor();
  const squares = (level: any) => {
    const scale = vec2(1.7).div(exp2(level));
    const cell = floor(p.mul(scale)).add(vec2(level.mul(37), level.mul(11)));
    return fract(sin(cell.dot(vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5);
  };
  const noise = mix(squares(l0), squares(l0.add(1)), lod.sub(l0)).mul(0.06);
  const bands = sin(p.x.mul(0.31).add(p.y.mul(0.17))).mul(0.02);
  return base.mul(noise.add(bands).add(1));
}

/**
 * Camera-relative haze and depth of field. Distances scale with the camera's distance to
 * what it looks at (`d`): fog runs from `d·fogNear` to `d·fogFar + fogBase`. Depth of field
 * (broom flight only) blurs what's far: everything nearer than `d + focusShift` is sharp, and
 * the blur ramps to full over the next `d·dofRange + dofBase`.
 */
export interface LookProfile {
  fogNear: number;
  fogFar: number;
  fogBase: number;
  /** floor for `d` in the fog maths (the flight camera hugs the rider) */
  minHaze: number;
  dofRange: number;
  dofBase: number;
  bokeh: number;
  focusShift: number;
}

/** Post effects that can be switched off (debug pane / performance). */
export interface Effects {
  dof: boolean;
  bloom: boolean;
  shadows: boolean;
  windowLight: boolean;
  /** old-style windows: flat glowing leaded glass instead of the painted rooms */
  classicWindows: boolean;
  msaa: boolean;
  pixelRatio: number;
}

export class Stage {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly pipeline: THREE.RenderPipeline;
  /** The key light: the sun, or a cool moon once the sun is down. */
  readonly sun = new THREE.DirectionalLight('#fff', 2);
  readonly ground: THREE.Mesh;
  readonly grid: THREE.GridHelper;
  readonly windowPools = new WindowPools();
  time: TimeOfDay = 'dusk';
  /** Something else drives the camera (broom flight): the orbit controls are not updated. */
  freeCamera = false;
  /** Haze and depth of field for the orbit camera and for broom flight. */
  readonly look: { orbit: LookProfile; flight: LookProfile } = {
    // orbit: clear air (the haze starts hundreds of units out, only softening the horizon), no blur
    orbit: { fogNear: 40, fogFar: 60, fogBase: 0, minHaze: 0, dofRange: 0, dofBase: 50, bokeh: 0, focusShift: 0 },
    flight: { fogNear: 1.05, fogFar: 3.4, fogBase: 0, minHaze: 70.5, dofRange: 0, dofBase: 90, bokeh: 1.6, focusShift: 70 },
  };
  readonly fx: Effects = {
    dof: true,
    bloom: true,
    shadows: true,
    windowLight: true,
    classicWindows: false,
    msaa: true,
    pixelRatio: Math.min(window.devicePixelRatio, 1.5),
  };
  private postNodes: { dispose(): void }[] = [];
  /** the depth-of-field node while enabled (inspection) */
  dofNode: any = null;
  /** final output with and without depth of field: only broom flight blurs */
  private outputs: { orbit: any; flight: any } | null = null;
  private outputIsFlight = false;

  private sky = createDaylightSky();
  private solar = createSolarLight();
  private fireflies: THREE.Sprite;
  private fireflyCenter = uniform(new THREE.Vector3());
  private timer = new THREE.Timer();
  private fogNear = uniform(140);
  private fogFar = uniform(520);
  private whiteBalance = uniform(new THREE.Vector3(1, 1, 1));
  private exposureInverse = uniform(1);
  private glow: ReturnType<typeof bloom> | null = null;
  private focus = uniform(60);
  private focalRange = uniform(30);
  private bokeh = uniform(1.4);
  private env: { pmrem: THREE.PMREMGenerator; target: THREE.RenderTarget; scene: THREE.Scene } | null = null;
  // sun tween
  private sunNow = { ...TIMES.dusk };
  private sunFrom = { ...TIMES.dusk };
  private sunTo = { ...TIMES.dusk };
  private tween = 1;
  private skyDirty = true;
  // metering
  private keyE = 0;
  private ev = 0;
  private outdoor = new THREE.Color(1, 1, 1);
  private wbTarget = new THREE.Vector3(1, 1, 1);
  private night = 0;
  /** 0 by day … 1 once windows and lanterns are lit */
  lampLevel = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      // float depth, far = 0: even precision at every distance, so faces a few millimetres apart
      // (trim on walls, panes in frames) never z-fight, however far the camera pulls back
      reversedDepthBuffer: true,
      // ?webgl forces the WebGL2 backend (debugging / comparing backends)
      forceWebGL: new URLSearchParams(location.search).has('webgl'),
      // ?debug reads GPU time per frame (timestamp queries)
      trackTimestamp: new URLSearchParams(location.search).has('debug'),
    });
    this.renderer.setPixelRatio(this.fx.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.5, 2000);
    this.camera.position.set(52, 46, 52);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 260;
    this.controls.screenSpacePanning = false;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

    // key light
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    // sky, sky-tinted fog (what the ground meets at the horizon), image-based light
    const scene = this.scene as any;
    scene.backgroundNode = this.sky.skyRadiance(positionWorldDirection);
    const d = positionWorld.sub(cameraPosition);
    scene.fogNode = fog(this.sky.horizonRadiance(vec3(d.x, 0.004, d.z)), smoothstep(this.fogNear, this.fogFar, length(d)));

    // ground below the diorama tiles
    const groundMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    groundMat.colorNode = daylightGroundColor(color('#6d6a72'));
    groundMat.emissiveNode = (groundMat.colorNode as any).mul(windowLightAt(vec3(0, 1, 0)));
    // far away the open ground turns into the sky's own horizon colour, so the plane never
    // draws a hard line against the sky (the castle is untouched: this is the ground only)
    // by view angle, not distance: the last few degrees below the horizon blend into the sky at
    // any camera height (distance would squeeze the blend into a few pixels)
    const g = positionWorld.sub(cameraPosition);
    const below = g.y.negate().div(length(g));
    const far = float(1).sub(smoothstep(0.004, 0.13, below));
    groundMat.outputNode = vec4(mix(output.rgb, this.sky.horizonRadiance(vec3(g.x, 0.004, g.z)), far), output.a);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), groundMat);
    this.ground.position.y = -1.01;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.grid = new THREE.GridHelper(CELL_W * 60, 60, '#c9a8ff', '#7d6aa6');
    this.grid.position.set(CELL_W / 2, -0.99, CELL_W / 2);
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.22;
    this.grid.visible = false;
    this.scene.add(this.grid);

    this.fireflies = this.makeFireflies();
    this.scene.add(this.fireflies);
    this.scene.add(this.windowPools.spill.mesh);

    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputColorTransform = false;
    this.buildPost();

    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Post chain: scene (MSAA) → depth of field → bloom (only display-white blooms) → Pascal
   * grade + white balance → tone map → vignette. Rebuilt when an effect is switched.
   */
  private buildPost() {
    for (const n of this.postNodes) n.dispose();
    this.postNodes = [];
    const scenePass = pass(this.scene, this.camera, { samples: this.fx.msaa ? 4 : 0 });
    this.postNodes.push(scenePass);
    const sceneColor: any = scenePass.getTextureNode('output');
    let color: any = sceneColor;
    this.dofNode = null;
    if (this.fx.dof) {
      // far-only depth of field: depth is clamped to the focus distance, so everything nearer
      // (the rider, the towers she passes) stays sharp and only the distance melts away
      const viewZ = (scenePass.getViewZNode() as any).min(this.focus.negate());
      const d = dof(color, viewZ, this.focus, this.focalRange, this.bokeh) as any;
      // three runs the 64-tap bokeh blur at half resolution: the costliest pass of the frame
      // at retina sizes. A quarter is plenty for out-of-focus blur (the sample step is in
      // full-res uv, so the blur size is unchanged); CoC and composite stay full resolution.
      const setSize = d.setSize.bind(d);
      d.setSize = (w: number, h: number) => {
        setSize(w, h);
        const qx = Math.max(1, Math.round(w / 4)), qy = Math.max(1, Math.round(h / 4));
        for (const rt of [d._CoCBlurredRT, d._blur64RT, d._blur16NearRT, d._blur16FarRT]) rt.setSize(qx, qy);
      };
      this.dofNode = d;
      this.postNodes.push(d);
      color = d;
    }
    this.glow = null;
    if (this.fx.bloom) {
      // bloom reads the scene colour, not the depth-of-field result: feeding it the DOF node
      // made three re-render that node into an extra texture and nearly doubled the GPU time
      // (bloom is a wide blur either way, so the look is the same)
      this.glow = bloom(sceneColor, BLOOM.strength, BLOOM.radius, this.exposureInverse as any);
      // its mip chain starts at half resolution with up to 22-tap blurs; a quarter is plenty
      // for a soft glow and a large share of the post cost at retina sizes
      this.glow.setResolutionScale(0.25);
      this.glow.smoothWidth.value = BLOOM.softKnee;
      this.postNodes.push(this.glow);
    }
    const finish = (c: any) => {
      let hdr: any = c.rgb;
      if (this.glow) hdr = hdr.add(this.glow.rgb);
      const graded = saturation(hdr.max(0).mul(this.whiteBalance).div(0.18).pow(vec3(GRADE.contrast)).mul(0.18), GRADE.saturation);
      const display = renderOutput(vec4(graded, 1), THREE.NeutralToneMapping, THREE.SRGBColorSpace);
      const vignette = length(screenUV.sub(0.5)).mul(1.35).pow(2.5).mul(GRADE.vignette);
      return vec4(display.rgb.mul(float(1).sub(vignette)), 1);
    };
    // two outputs, swapped on take-off / landing: the orbit one never runs the blur passes
    const orbit = finish(sceneColor);
    this.outputs = { orbit, flight: color === sceneColor ? orbit : finish(color) };
    this.outputIsFlight = !this.freeCamera;
    this.useOutput(this.freeCamera);
  }

  private useOutput(flight: boolean) {
    if (!this.outputs || flight === this.outputIsFlight) return;
    this.outputIsFlight = flight;
    this.pipeline.outputNode = flight ? this.outputs.flight : this.outputs.orbit;
    this.pipeline.needsUpdate = true;
  }

  /** Render once through each output so taking off never waits on a shader build. */
  warmOutputs() {
    const was = this.outputIsFlight;
    // the night-only window spill too (one black instance), so dusk doesn't stall on its shader
    const spill = this.windowPools.spill.mesh;
    const { visible, count } = spill;
    spill.visible = true;
    spill.count = Math.max(1, count);
    for (const f of [!was, was]) {
      this.useOutput(f);
      this.render();
    }
    spill.visible = visible;
    spill.count = count;
  }

  /** Apply `fx` after it changed (rebuilds the post chain only when it has to). */
  applyEffects(prev?: Effects) {
    const fx = this.fx;
    if (!prev || prev.dof !== fx.dof || prev.bloom !== fx.bloom || prev.msaa !== fx.msaa) this.buildPost();
    this.sun.castShadow = fx.shadows;
    globalUniforms.uClassicWindows.value = fx.classicWindows ? 1 : 0;
    if (!prev || prev.pixelRatio !== fx.pixelRatio) {
      this.renderer.setPixelRatio(fx.pixelRatio);
      this.resize();
    }
  }

  /** WebGPU needs an async device; the sky environment capture needs it too. */
  async init() {
    await this.renderer.init();
    const envScene = new THREE.Scene();
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false });
    mat.colorNode = this.sky.skyRadiance(positionWorldDirection, { disc: false });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), mat));
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const target = pmrem.fromScene(envScene, 0, 0.1, 100, { size: 256 } as never) as THREE.RenderTarget;
    this.env = { pmrem, target, scene: envScene };
    (this.scene as any).environmentNode = pmremTexture(target.texture).mul(ENV_INTENSITY);
    this.setTime(this.time, true);
    this.applySky();
  }

  get backend() {
    return (this.renderer.backend as any).isWebGPUBackend ? 'WebGPU' : 'WebGL2';
  }

  private makeFireflies() {
    const n = 600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 120;
      pos[i * 3 + 1] = Math.random() * 12;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 120;
      seed[i] = Math.random();
    }
    return makeSpriteCloud(n, pos, seed, (m, P, S) => {
      const { uTime, uNight } = globalUniforms;
      const c = this.fireflyCenter;
      const xz = P.xz.sub(c.xz).add(60).mod(120).sub(60).add(c.xz);
      const off = vec3(sin(uTime.mul(0.4).add(S.mul(40))), sin(uTime.mul(0.7).add(S.mul(17))).mul(0.6), sin(uTime.mul(0.5).add(S.mul(23)).add(Math.PI / 2))).mul(1.5);
      const center = vec3(xz.x, P.y, xz.y).add(off);
      m.positionNode = center;
      m.sizeNode = spriteSize(center, S.mul(0.7).add(0.6).mul(120), 2.5);
      const vA = sin(uTime.mul(S.mul(2).add(1)).add(S.mul(50))).mul(0.5).add(0.5);
      const a = smoothstep(0.5, 0, length(spriteUV().sub(0.5)));
      // cool motes: mostly soft blue, some icy white, the odd violet one
      m.colorNode = select(S.greaterThan(0.85), vec3(0.6, 0.45, 1), select(S.greaterThan(0.55), vec3(0.55, 0.8, 1), vec3(0.28, 0.52, 1))).mul(2);
      m.opacityNode = a.mul(vA).mul(smoothstep(0.2, 1, uNight));
    });
  }

  /** Switch the time of day; the sun glides there unless `instant`. */
  setTime(t: TimeOfDay, instant = false) {
    this.time = t;
    this.sunFrom = { ...this.sunNow };
    this.sunTo = { ...TIMES[t] };
    this.tween = instant ? 1 : 0;
    if (instant) this.sunNow = { ...this.sunTo };
    this.skyDirty = true;
  }

  /** Sun, sky and lights follow the sun position (Pascal daylight-atmosphere effect). */
  private applySky() {
    const sun = solarLightAt(this.sunNow.elevation, this.sunNow.azimuth, this.solar);
    this.sky.update(sun, COVER);
    const light = this.sun;
    // One key light: the sun, or below 1° a cool, dim moon high on the other side of the sky.
    if (sun.elevation < 1) {
      this.keyDir.set(-sun.direction.x, Math.max(0.5, Math.abs(sun.direction.y)), -sun.direction.z).normalize();
      light.color.copy(MOON_COLOR);
      light.intensity = 0.18 * sun.night;
    } else {
      this.keyDir.copy(sun.direction);
      light.color.copy(sun.color);
      light.intensity = 3.4 * sun.strength * (1 - 0.5 * COVER ** 1.6);
    }
    light.shadow.radius = 1.6 + 2.2 * (1 - THREE.MathUtils.smoothstep(sun.elevation, 2, 30)) + COVER * 3;
    this.keyE = light.intensity * Math.max(0.15, sun.direction.y);
    this.night = sun.night;
    // what window glass mirrors: the sky a little above the horizon, plus a cool moonlit floor
    this.sky.radianceCpu(new THREE.Vector3(0.35, 0.3, 0.89).normalize(), this.skyGlass);

    // The outdoor illuminant (sky irradiance + the key light), for the white balance.
    const skyIrr = new THREE.Color(0, 0, 0);
    let weight = 0;
    for (const dir of HEMISPHERE) {
      skyIrr.add(this.sky.radianceCpu(dir).multiplyScalar(dir.y));
      weight += dir.y;
    }
    skyIrr.multiplyScalar((Math.PI / weight) * ENV_INTENSITY);
    this.outdoor.copy(skyIrr).add(light.color.clone().multiplyScalar(this.keyE));

    // Lamps (lit windows, lanterns, fireflies) follow the light.
    this.lampLevel = 1 - THREE.MathUtils.smoothstep(sun.elevation, -5, 6);
    globalUniforms.uNight.value = sun.night;

    if (this.env) this.env.pmrem.fromScene(this.env.scene, 0, 0.1, 100, { size: 256, renderTarget: this.env.target } as never);
  }

  private keyDir = new THREE.Vector3(0, 1, 0);
  private skyGlass = new THREE.Color();

  /** Frame a box of world-space points. */
  frame(box: THREE.Box3) {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 12);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.set(c.x, 0, c.z);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, r * 1.55 + 12);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    // a collapsed or hidden frame reports 0×0: keep the last size (the next resize restores it)
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  update() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    globalUniforms.uTime.value += dt;
    (this.sky.cloudTime.value as number) += dt;
    if (!this.freeCamera) this.controls.update();
    this.useOutput(this.freeCamera);

    if (this.tween < 1) {
      this.tween = Math.min(1, this.tween + dt / 1.8);
      const k = this.tween * this.tween * (3 - 2 * this.tween);
      this.sunNow.elevation = THREE.MathUtils.lerp(this.sunFrom.elevation, this.sunTo.elevation, k);
      this.sunNow.azimuth = THREE.MathUtils.lerp(this.sunFrom.azimuth, this.sunTo.azimuth, k);
      this.skyDirty = true;
    }
    if (this.skyDirty) {
      this.skyDirty = false;
      this.applySky();
    }

    const t = this.controls.target;
    this.sun.position.copy(t).addScaledVector(this.keyDir, 180);
    this.sun.target.position.copy(t);
    // haze scales with zoom so both close-ups and big worlds get depth; in flight the camera
    // hugs the rider, so its profile keeps the haze out where the streamed chunks end
    const look = this.freeCamera ? this.look.flight : this.look.orbit;
    const dist = this.camera.position.distanceTo(t);
    const haze = Math.max(dist, look.minHaze);
    this.fogNear.value = haze * look.fogNear;
    this.fogFar.value = Math.max(haze * look.fogFar + look.fogBase, this.fogNear.value + 1);
    // the ground plane travels with the view (only its pattern is anchored to the world)
    this.ground.position.x = Math.round(t.x / 64) * 64;
    this.ground.position.z = Math.round(t.z / 64) * 64;
    this.fireflyCenter.value.copy(t);

    // Metered exposure: sun + sky irradiance exposed towards mid-grey with partial adaptation
    // (dark scenes stay a bit dark), smoothed like an eye adapting.
    const skyE = Math.PI * 0.45 * luminance(this.sky.radianceCpu(UP)) * ENV_INTENSITY;
    const target = THREE.MathUtils.clamp(Math.log2(METER_REF / Math.max(this.keyE + skyE, 1e-4)) * 0.6, -0.5, 2.2);
    this.ev += (target - this.ev) * Math.min(1, dt * 3);
    const exposure = 2 ** this.ev;
    this.renderer.toneMappingExposure = exposure;
    this.exposureInverse.value = 1 / exposure;
    // glass mirrors the sky as bright as the sky itself shows (both go through the exposure)
    const sg = this.skyGlass;
    globalUniforms.uSkyGlass.value.set(sg.r, sg.g, sg.b).multiplyScalar(0.8).add(_moonGlass);
    // Glows stay out of the night exposure lift; lamps brighten as the light goes.
    const glowComp = 1 / 2 ** Math.max(0, this.ev - 0.5);
    globalUniforms.uEmissive.value = THREE.MathUtils.lerp(0.35, 1.6, this.lampLevel) * glowComp;
    if (this.glow) {
      this.glow.strength.value = BLOOM.strength + NIGHT_BLOOM.strength * this.lampLevel;
      this.glow.radius.value = BLOOM.radius + (NIGHT_BLOOM.radius - BLOOM.radius) * this.lampLevel;
    }
    // window light: rises with the lamps, kept out of the night exposure lift like other glows
    windowLight.level.value = this.fx.windowLight ? WINDOW_LIGHT * this.lampLevel * glowComp : 0;
    // its spill on the walls is relative to the wall's own light: no exposure compensation
    windowLight.spill.value = this.fx.windowLight ? WINDOW_SPILL * this.lampLevel : 0;
    this.windowPools.spill.mesh.visible = windowLight.spill.value > 0.01 && this.windowPools.spill.mesh.count > 0;
    // focus on what the camera looks at; the in-focus band widens as you zoom out
    this.focus.value = Math.max(0.5, dist + look.focusShift);
    this.focalRange.value = dist * look.dofRange + look.dofBase;
    this.bokeh.value = look.bokeh;

    // Eye-like chromatic adaptation (von Kries), partial: golden light keeps some warmth.
    const illum = this.outdoor;
    const L = luminance(illum);
    if (L > 1e-5) {
      const k = WHITE_BALANCE * (1 - 0.35 * this.night);
      this.wbTarget.set(
        THREE.MathUtils.lerp(1, L / Math.max(illum.r, 1e-4), k),
        THREE.MathUtils.lerp(1, L / Math.max(illum.g, 1e-4), k),
        THREE.MathUtils.lerp(1, L / Math.max(illum.b, 1e-4), k),
      );
      this.wbTarget.clampScalar(0.5, 2);
      this.wbTarget.divideScalar(0.2126 * this.wbTarget.x + 0.7152 * this.wbTarget.y + 0.0722 * this.wbTarget.z);
    }
    this.whiteBalance.value.lerp(this.wbTarget, Math.min(1, dt * 2));
    return dt;
  }

  render() {
    // nothing to draw into while the page has no area (WebGPU can't make a 0×0 swapchain)
    if (window.innerWidth === 0 || window.innerHeight === 0) return;
    // the page got its area back before the resize event did (e.g. it booted at 0×0)
    const c = this.renderer.domElement;
    if (c.width === 0 || c.height === 0) this.resize();
    this.pipeline.render();
  }

  /** Beyond this distance the fog hides everything (nothing there needs drawing). */
  get viewDistance() {
    return this.fogFar.value;
  }

  /** Direction toward the shadow-casting light, or null when nothing casts shadows. */
  get shadowDir(): THREE.Vector3 | null {
    return this.sun.castShadow && this.sun.intensity > 0 ? this.keyDir : null;
  }

  now() {
    return globalUniforms.uTime.value;
  }
}

