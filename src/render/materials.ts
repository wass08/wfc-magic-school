import * as THREE from 'three';

export const globalUniforms = {
  uTime: { value: 0 },
  uEmissive: { value: 1 },
  uNight: { value: 0 },
};

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
vec2 planeUV(vec3 p, vec3 n){
  vec3 a = abs(n);
  if (a.y > max(a.x, a.z)) return p.xz;
  return a.x > a.z ? vec2(p.z, p.y) : vec2(p.x, p.y);
}
float bricks(vec2 uv, vec2 size, float mortar, out vec2 id){
  float row = floor(uv.y / size.y);
  uv.x += mod(row, 2.0) * 0.5 * size.x;
  vec2 g = uv / size; id = floor(g); vec2 f = fract(g);
  vec2 e = min(f, 1.0 - f) * size;
  return smoothstep(0.0, mortar, min(e.x, e.y));
}
`;

/** World-space position/normal varyings, computed after instancing + spawn scaling. */
const WORLD_VARYINGS = /* glsl */ `
vec4 wp4 = vec4(transformed, 1.0);
vec3 wn = objectNormal;
#ifdef USE_INSTANCING
  wp4 = instanceMatrix * wp4;
  wn = mat3(instanceMatrix) * wn;
#endif
wp4 = modelMatrix * wp4;
vWPos = wp4.xyz;
vWNor = normalize(mat3(modelMatrix) * wn);
`;

/**
 * One material for every castle module. Per-vertex attributes:
 *  aFx   = (emissive, flicker, materialId, -)
 *  aSway = (dir.xyz, amplitude)
 * Instanced attribute aSpawn = time the instance appeared (pop-in animation).
 */
export function createCastleMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        attribute vec4 aFx;
        attribute vec4 aSway;
        attribute float aSpawn;
        uniform float uTime;
        varying vec4 vFx;
        varying vec3 vWPos;
        varying vec3 vWNor;
        varying float vFlick;`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vec3 ipos = vec3(0.0);
        #ifdef USE_INSTANCING
          ipos = instanceMatrix[3].xyz;
        #endif
        float ph = dot(ipos, vec3(0.37, 0.11, 0.53));
        float wave = sin(uTime * 2.3 + ph + position.y * 2.5 + position.x * 1.3) + 0.4 * sin(uTime * 3.7 + ph * 2.0 + position.y * 5.0);
        transformed += aSway.xyz * aSway.w * wave;
        float sp = clamp((uTime - aSpawn) / 0.6, 0.0, 1.0);
        float c1 = 1.70158; float c3 = c1 + 1.0;
        float grow = 1.0 + c3 * pow(sp - 1.0, 3.0) + c1 * pow(sp - 1.0, 2.0);
        transformed *= max(grow, 0.0001);
        vFx = aFx;
        float fl = (0.5 + 0.5 * sin(uTime * 9.0 + ph * 13.0 + position.x * 3.0)) * (0.5 + 0.5 * sin(uTime * 5.3 + ph * 7.0 + position.z * 2.0));
        vFlick = 1.0 - aFx.y * fl * 0.8;`,
      )
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS}`);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        uniform float uTime;
        uniform float uEmissive;
        varying vec4 vFx;
        varying vec3 vWPos;
        varying vec3 vWNor;
        varying float vFlick;
        ${NOISE}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
        float matId = floor(vFx.z + 0.5);
        vec3 n = normalize(vWNor);
        vec2 uv = planeUV(vWPos, n);
        float pat = 1.0;
        float glow = 1.0;
        vec2 bid;
        if (matId == 1.0) { // stone
          float m;
          if (abs(n.y) > 0.7) m = bricks(uv, vec2(0.6, 0.6), 0.03, bid);
          else m = bricks(uv, vec2(0.52, 0.24), 0.022, bid);
          float shade = 0.82 + 0.3 * h21(bid);
          pat = mix(0.58, shade, m) * (0.9 + 0.2 * vnoise(uv * 3.0));
          // grime toward the ground, moss speckles
          pat *= mix(0.86, 1.0, smoothstep(0.0, 1.2, vWPos.y));
          float moss = smoothstep(0.72, 0.9, vnoise(uv * 2.3 + 7.0)) * step(0.5, n.y + 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.3, 0.12), moss * 0.35);
        } else if (matId == 2.0) { // slate roof
          float c = abs(n.x) > abs(n.z) ? vWPos.z : vWPos.x;
          float m = bricks(vec2(c, vWPos.y), vec2(0.34, 0.17), 0.018, bid);
          pat = mix(0.55, 0.82 + 0.32 * h21(bid), m);
          float moss = smoothstep(0.75, 0.95, vnoise(vec2(c, vWPos.y) * 1.7));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.25, 0.32, 0.18), moss * 0.4);
        } else if (matId == 3.0) { // wood
          pat = 0.82 + 0.18 * sin(uv.x * 40.0 + vnoise(uv * vec2(2.0, 18.0)) * 5.0);
        } else if (matId == 5.0) { // foliage
          pat = 0.72 + 0.55 * vnoise(vWPos.xz * 7.0 + vWPos.y * 5.0);
        } else if (matId == 6.0) { // leaded glass
          float d1 = abs(fract((uv.x + uv.y) * 6.0) - 0.5);
          float d2 = abs(fract((uv.x - uv.y) * 6.0) - 0.5);
          float lines = smoothstep(0.0, 0.07, min(d1, d2));
          glow = 0.35 + 0.65 * lines;
          pat = glow;
        } else if (matId == 7.0) { // cloth
          pat = 0.9 + 0.1 * sin(uv.y * 80.0);
        } else if (matId == 8.0) { // paving
          float m = bricks(uv, vec2(0.7, 0.55), 0.035, bid);
          pat = mix(0.6, 0.85 + 0.25 * h21(bid), m);
        } else if (matId == 9.0) { // grass
          pat = 0.78 + 0.35 * vnoise(vWPos.xz * 3.0) + 0.12 * h21(floor(vWPos.xz * 24.0));
        } else if (matId == 12.0) { // falling water: streaks sliding down
          float lane = floor((vWPos.x + vWPos.z) * 7.0);
          float streak = 0.5 + 0.5 * sin(vWPos.y * 9.0 + uTime * 7.0 + h21(vec2(lane, 3.0)) * 6.28);
          pat = 0.75 + 0.35 * streak;
          glow = 0.6 + 0.6 * streak;
        } else if (matId == 10.0) { // magic
          glow = 0.7 + 0.3 * sin(uTime * 2.0 + vWPos.x + vWPos.z);
        }
        diffuseColor.rgb *= pat;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
        if (matId == 4.0) roughnessFactor = 0.32;
        else if (matId == 6.0) roughnessFactor = 0.25;
        else if (matId == 11.0) roughnessFactor = 0.5;
        else if (matId == 2.0) roughnessFactor = 0.62;`,
      )
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
        if (matId == 4.0) metalnessFactor = 1.0;
        else if (matId == 11.0) metalnessFactor = 0.7;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        totalEmissiveRadiance += vColor.rgb * vFx.x * uEmissive * vFlick * glow;`,
      );
  };
  return m;
}

export function createWaterMaterial() {
  const m = new THREE.MeshStandardMaterial({
    color: '#27566a',
    roughness: 0.06,
    metalness: 0.2,
    transparent: true,
    opacity: 0.86,
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WORLD_VARYINGS}`);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uTime;\nuniform float uNight;\nvarying vec3 vWPos;\nvarying vec3 vWNor;\n${NOISE}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
        vec2 wp = vWPos.xz;
        float t = uTime;
        vec2 g = vec2(
          cos(wp.x * 2.1 + t * 1.3) * 0.5 + cos((wp.x + wp.y) * 3.7 - t * 1.7) * 0.3 + cos(wp.x * 7.3 - t * 2.3) * 0.15,
          cos(wp.y * 2.4 - t * 1.1) * 0.5 + cos((wp.x + wp.y) * 3.7 - t * 1.7) * 0.3 + cos(wp.y * 6.9 + t * 2.1) * 0.15
        ) * 0.09;
        normal = normalize((viewMatrix * vec4(normalize(vec3(-g.x, 1.0, -g.y)), 0.0)).xyz);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
        // fake reflections of warm windows: drifting elongated glints
        float n1 = vnoise(vWPos.xz * vec2(2.5, 11.0) + vec2(uTime * 0.35, -uTime * 0.9));
        float n2 = vnoise(vWPos.xz * vec2(5.0, 3.0) - vec2(uTime * 0.2, uTime * 0.15));
        float sparkle = smoothstep(0.7, 0.95, n1 * (0.45 + 0.55 * n2));
        totalEmissiveRadiance += vec3(1.0, 0.66, 0.32) * sparkle * mix(0.06, 0.6, uNight);
        totalEmissiveRadiance += vec3(0.05, 0.12, 0.16) * (0.5 + 0.5 * vnoise(vWPos.xz * 0.6 + uTime * 0.1));`,
      );
  };
  return m;
}

export function createGhostMaterial() {
  return new THREE.MeshBasicMaterial({ color: '#9fffb0', transparent: true, opacity: 0.38, depthWrite: false });
}
