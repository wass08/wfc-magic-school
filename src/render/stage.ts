import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CELL_W } from '../config';
import { globalUniforms } from './materials';

export type TimeOfDay = 'day' | 'dusk' | 'night';

interface Preset {
  skyTop: string;
  skyHorizon: string;
  skyBottom: string;
  fog: string;
  sun: string;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  emissive: number;
  bloom: number;
  night: number;
  exposure: number;
  env: number;
  ground: string;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: {
    skyTop: '#6f8fd0', skyHorizon: '#e8d6e2', skyBottom: '#b8a6b8', fog: '#cdbfd2',
    sun: '#fff1dc', sunIntensity: 2.6, sunDir: [-0.55, 0.75, 0.35],
    hemiSky: '#c8d4ff', hemiGround: '#6d5a5a', hemiIntensity: 1.1,
    emissive: 0.35, bloom: 0.25, night: 0, exposure: 1.0, env: 0.35, ground: '#5d5868',
  },
  dusk: {
    skyTop: '#2c2a5e', skyHorizon: '#e6918a', skyBottom: '#4a3550', fog: '#8a6a86',
    sun: '#ffb38a', sunIntensity: 2.0, sunDir: [-0.7, 0.32, 0.45],
    hemiSky: '#9a8ad0', hemiGround: '#3a2a3a', hemiIntensity: 0.9,
    emissive: 0.9, bloom: 0.5, night: 0.5, exposure: 1.05, env: 0.25, ground: '#2c2a36',
  },
  night: {
    skyTop: '#070a1e', skyHorizon: '#2a2550', skyBottom: '#0d0b18', fog: '#1d1a36',
    sun: '#8fa4ff', sunIntensity: 0.55, sunDir: [0.4, 0.7, -0.3],
    hemiSky: '#4a4c90', hemiGround: '#150f1c', hemiIntensity: 0.55,
    emissive: 1.25, bloom: 0.7, night: 1, exposure: 1.1, env: 0.12, ground: '#16141e',
  },
};

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly sun = new THREE.DirectionalLight('#fff', 2);
  readonly hemi = new THREE.HemisphereLight('#fff', '#000', 1);
  readonly ground: THREE.Mesh;
  readonly grid: THREE.GridHelper;
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private fireflies: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private sunDir = new THREE.Vector3();
  private timer = new THREE.Timer();
  time: TimeOfDay = 'dusk';
  private fogColor = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
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

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    // lights
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    // sky dome
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          top: { value: new THREE.Color() },
          horizon: { value: new THREE.Color() },
          bottom: { value: new THREE.Color() },
          night: globalUniforms.uNight,
          uTime: globalUniforms.uTime,
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform float night; uniform float uTime;
          varying vec3 vDir;
          float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
          void main() {
            float y = vDir.y;
            vec3 c = y > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 0.7, y), 0.7)) : mix(horizon, bottom, smoothstep(0.0, -0.2, y));
            vec3 cell = floor(vDir * 260.0);
            float s = h(cell);
            float star = step(0.9975, s) * smoothstep(0.05, 0.4, y) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 100.0));
            c += vec3(1.0, 0.95, 0.85) * star * night * 1.5;
            gl_FragColor = vec4(c, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // ground below the diorama tiles
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2c2a36', roughness: 1 }));
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

    // post
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(window.innerWidth, window.innerHeight);

    window.addEventListener('resize', () => this.resize());
    this.setTime('dusk');
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
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: globalUniforms.uTime, uNight: globalUniforms.uNight, uCenter: { value: new THREE.Vector3() } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform vec3 uCenter; varying float vSeed; varying float vA;
        void main() {
          vec3 p = position;
          p.xz = mod(p.xz - uCenter.xz + 60.0, 120.0) - 60.0 + uCenter.xz;
          p += vec3(sin(uTime * 0.4 + aSeed * 40.0), sin(uTime * 0.7 + aSeed * 17.0) * 0.6, cos(uTime * 0.5 + aSeed * 23.0)) * 1.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((2.0 + 2.5 * aSeed) * (120.0 / -mv.z), 7.0);
          vSeed = aSeed;
          vA = 0.5 + 0.5 * sin(uTime * (1.0 + aSeed * 2.0) + aSeed * 50.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight; varying float vSeed; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          vec3 c = vSeed > 0.7 ? vec3(0.75, 0.55, 1.0) : vec3(1.0, 0.8, 0.45);
          gl_FragColor = vec4(c * 2.0, a * vA * smoothstep(0.2, 1.0, uNight));
        }`,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return p;
  }

  setTime(t: TimeOfDay) {
    this.time = t;
    const p = PRESETS[t];
    const u = this.sky.material.uniforms;
    u.top.value.set(p.skyTop);
    u.horizon.value.set(p.skyHorizon);
    u.bottom.value.set(p.skyBottom);
    this.scene.fog = new THREE.Fog(p.fog, 140, 520);
    this.fogColor.set(p.fog);
    this.sun.color.set(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.sunDir.set(...p.sunDir).normalize();
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    globalUniforms.uEmissive.value = p.emissive;
    globalUniforms.uNight.value = p.night;
    this.bloom.strength = p.bloom;
    this.renderer.toneMappingExposure = p.exposure;
    this.scene.environmentIntensity = p.env;
    (this.ground.material as THREE.MeshStandardMaterial).color.set(p.ground);
  }

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
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  update() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    globalUniforms.uTime.value += dt;
    this.controls.update();
    const t = this.controls.target;
    this.sun.position.copy(t).addScaledVector(this.sunDir, 180);
    this.sun.target.position.copy(t);
    this.sky.position.copy(this.camera.position);
    // haze scales with zoom so both close-ups and big worlds get depth
    const fog = this.scene.fog as THREE.Fog;
    const dist = this.camera.position.distanceTo(t);
    fog.near = dist * 0.85;
    fog.far = dist * 3.2 + 60;
    this.fireflies.material.uniforms.uCenter.value.copy(t);
    return dt;
  }

  render() {
    this.composer.render();
  }

  now() {
    return globalUniforms.uTime.value;
  }
}
