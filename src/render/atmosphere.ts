import * as THREE from 'three/webgpu';
import { abs, float, fract, length, max, min, mix, sin, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { globalUniforms } from './materials';
import { makeSpriteCloud, markSpriteCloudDirty, spriteSize, spriteUV } from './sprites';

/** Chimney smoke: a few soft puffs per source, animated entirely in the shader. */
export class Smoke {
  readonly points = new THREE.Group();
  private sprite: THREE.Sprite | null = null;
  private pos = new Float32Array(0);
  private phase = new Float32Array(0);
  private cap = 0;
  private sources: Float32Array | null = null;
  private static PER_SOURCE = 7;

  constructor() {
    this.points.renderOrder = 5;
  }

  /** (Re)build the sprite cloud with room for `n` puffs (only when it has to grow). */
  private ensure(n: number) {
    if (n <= this.cap && this.sprite) return;
    let cap = Math.max(256, this.cap);
    while (cap < n) cap *= 2;
    this.cap = cap;
    if (this.sprite) {
      this.points.remove(this.sprite);
      (this.sprite.material as THREE.Material).dispose();
    }
    this.pos = new Float32Array(cap * 3);
    this.phase = new Float32Array(cap);
    this.sprite = makeSpriteCloud(
      0,
      this.pos,
      this.phase,
      (m, P, S) => {
        const { uTime, uNight } = globalUniforms;
        const t = fract(uTime.mul(0.11).add(S));
        const drift = vec3(
          sin(S.mul(40).add(t.mul(3))).mul(0.25).mul(t).add(t.mul(1.4)),
          t.mul(4.5),
          sin(S.mul(23).add(t.mul(2)).add(Math.PI / 2)).mul(0.25).mul(t).add(t.mul(0.7)),
        );
        const center = P.add(drift);
        m.positionNode = center;
        m.sizeNode = spriteSize(center, t.mul(70).add(14).mul(12));
        const vA = smoothstep(0, 0.12, t).mul(float(1).sub(t));
        const d = length(spriteUV().sub(0.5));
        m.colorNode = mix(vec3(0.78, 0.74, 0.8), vec3(0.32, 0.3, 0.42), uNight);
        m.opacityNode = smoothstep(0.5, 0.1, d).mul(vA).mul(0.32);
      },
      THREE.NormalBlending,
    );
    this.sprite.renderOrder = 5;
    this.points.add(this.sprite);
  }

  setSources(src: Float32Array) {
    if (src === this.sources) return;
    this.sources = src;
    const n = (src.length / 3) * Smoke.PER_SOURCE;
    this.ensure(n);
    let k = 0;
    for (let i = 0; i < src.length; i += 3) {
      const seed = Math.random();
      for (let j = 0; j < Smoke.PER_SOURCE; j++, k++) {
        this.pos[k * 3] = src[i];
        this.pos[k * 3 + 1] = src[i + 1];
        this.pos[k * 3 + 2] = src[i + 2];
        this.phase[k] = seed + j / Smoke.PER_SOURCE;
      }
    }
    markSpriteCloudDirty(this.sprite!);
    this.sprite!.count = n;
  }
}

/** Small cool-blue magic lanterns drifting upward around the camera target (dusk and night). */
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
  const center = uniform(new THREE.Vector3());
  const sprite = makeSpriteCloud(n, pos, seed, (m, P, S) => {
    const { uTime, uNight } = globalUniforms;
    const xz = P.xz.sub(center.xz).add(80).mod(160).sub(80).add(center.xz);
    const h = fract(P.y.add(uTime.mul(S.mul(0.006).add(0.006))));
    const c = vec3(
      xz.x.add(sin(uTime.mul(0.2).add(S.mul(30))).mul(2)),
      h.mul(26).add(7),
      xz.y.add(sin(uTime.mul(0.17).add(S.mul(21)).add(Math.PI / 2)).mul(2)),
    );
    m.positionNode = c;
    m.sizeNode = spriteSize(c, S.mul(1.2).add(1.8).mul(90).mul(smoothstep(0, 0.1, h)).mul(smoothstep(1, 0.8, h)));
    const flick = sin(uTime.mul(1.3).add(S.mul(60))).mul(0.06).add(0.94);
    const p = spriteUV().sub(0.5);
    // lantern body: rounded box, brighter at the bottom where the flame is
    const q = abs(p.mul(vec2(1.6, 1.25))).sub(vec2(0.42, 0.42));
    const body = float(1).sub(smoothstep(0, 0.06, length(max(q, vec2(0))).add(min(max(q.x, q.y), 0))));
    const glow = smoothstep(0.5, 0, length(p)).mul(0.35);
    const flame = smoothstep(0.35, 0, length(p.sub(vec2(0, 0.18))));
    m.colorNode = mix(vec3(0.22, 0.42, 1), vec3(0.65, 0.85, 1), flame).mul(1.6);
    m.opacityNode = body.mul(flame.mul(0.45).add(0.55)).add(glow).mul(flick).mul(smoothstep(0.3, 1, uNight));
  });
  return { object: sprite, center };
}
