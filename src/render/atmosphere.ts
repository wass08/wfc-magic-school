import * as THREE from 'three';
import { globalUniforms } from './materials';

/** Chimney smoke: a few soft puffs per source, animated entirely in the shader. */
export class Smoke {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private sources: Float32Array | null = null;
  private static PER_SOURCE = 7;

  constructor() {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uTime: globalUniforms.uTime, uNight: globalUniforms.uNight },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        varying float vA;
        void main() {
          float t = fract(uTime * 0.11 + aPhase);
          vec3 p = position;
          p += vec3(sin(aPhase * 40.0 + t * 3.0) * 0.25 * t + t * 1.4, t * 4.5, cos(aPhase * 23.0 + t * 2.0) * 0.25 * t + t * 0.7);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (14.0 + 70.0 * t) * (12.0 / -mv.z);
          vA = smoothstep(0.0, 0.12, t) * (1.0 - t);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vA * 0.32;
          vec3 c = mix(vec3(0.78, 0.74, 0.8), vec3(0.32, 0.3, 0.42), uNight);
          gl_FragColor = vec4(c, a);
        }`,
    });
    this.points = new THREE.Points(new THREE.BufferGeometry(), mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setSources(src: Float32Array) {
    if (src === this.sources) return;
    this.sources = src;
    const n = (src.length / 3) * Smoke.PER_SOURCE;
    const pos = new Float32Array(n * 3);
    const phase = new Float32Array(n);
    let k = 0;
    for (let i = 0; i < src.length; i += 3) {
      const seed = Math.random();
      for (let j = 0; j < Smoke.PER_SOURCE; j++, k++) {
        pos.set([src[i], src[i + 1], src[i + 2]], k * 3);
        phase[k] = seed + j / Smoke.PER_SOURCE;
      }
    }
    const g = this.points.geometry;
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    g.setDrawRange(0, n);
  }
}

/** Paper sky lanterns drifting upward around the camera target (dusk and night). */
export function createSkyLanterns() {
  const n = 90;
  const pos = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 160;
    pos[i * 3 + 1] = Math.random();
    pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
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
      attribute float aSeed; uniform float uTime; uniform vec3 uCenter; varying float vSeed; varying float vFlick;
      void main() {
        vec3 p = position;
        p.xz = mod(p.xz - uCenter.xz + 80.0, 160.0) - 80.0 + uCenter.xz;
        float h = fract(position.y + uTime * (0.006 + aSeed * 0.006));
        p.y = 7.0 + h * 26.0;
        p.x += sin(uTime * 0.2 + aSeed * 30.0) * 2.0;
        p.z += cos(uTime * 0.17 + aSeed * 21.0) * 2.0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (6.0 + 4.0 * aSeed) * (90.0 / -mv.z) * smoothstep(0.0, 0.1, h) * smoothstep(1.0, 0.8, h);
        vSeed = aSeed;
        vFlick = 0.85 + 0.15 * sin(uTime * 7.0 + aSeed * 60.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; varying float vSeed; varying float vFlick;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        // lantern body: rounded box, brighter at the bottom where the flame is
        vec2 q = abs(uv * vec2(1.6, 1.25)) - vec2(0.42, 0.42);
        float body = 1.0 - smoothstep(0.0, 0.06, length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
        float glow = smoothstep(0.5, 0.0, length(uv)) * 0.35;
        float flame = smoothstep(0.35, 0.0, length(uv - vec2(0.0, 0.18)));
        vec3 c = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.8, 0.45), flame);
        float a = (body * (0.55 + 0.45 * flame) + glow) * vFlick * smoothstep(0.3, 1.0, uNight);
        gl_FragColor = vec4(c * 1.6, a);
      }`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}
