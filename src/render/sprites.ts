import * as THREE from 'three/webgpu';
import { float, instancedBufferAttribute, modelViewMatrix, uv, vec2, vec4 } from 'three/tsl';

// --- sized point sprites (WebGPU points are 1px; instanced sprites honour a size) ---------------

/** The sprite quad's UV, flipped to match GLSL's gl_PointCoord (y down). */
export const spriteUV = () => vec2(uv().x, float(1).sub(uv().y));

/** GLSL-style point size: `px * (1 / -viewZ)`, capped. */
export function spriteSize(center: any, px: any, cap?: number): any {
  const z = modelViewMatrix.mul(vec4(center, 1)).z.negate().max(0.01);
  const s = px.div(z).div(2);
  return cap === undefined ? s : s.min(cap / 2);
}

/**
 * Instanced sprite cloud: `pos` (xyz) and `seed` arrays become instanced attributes.
 * `setup` wires the material's position/size/colour/opacity nodes.
 */
export function makeSpriteCloud(
  count: number,
  pos: Float32Array,
  seed: Float32Array,
  setup: (m: THREE.PointsNodeMaterial, P: any, S: any) => void,
  blending: THREE.Blending = THREE.AdditiveBlending,
) {
  const m = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending, sizeAttenuation: false });
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3);
  const seedAttr = new THREE.InstancedBufferAttribute(seed, 1);
  const P = instancedBufferAttribute(posAttr, 'vec3');
  const S = instancedBufferAttribute(seedAttr, 'float');
  setup(m, P, S);
  const sprite = new THREE.Sprite(m);
  sprite.userData.attrs = [posAttr, seedAttr];
  sprite.count = count;
  sprite.frustumCulled = false;
  return sprite;
}


/** Flag a sprite cloud's instanced attributes for re-upload after editing their arrays. */
export function markSpriteCloudDirty(sprite: THREE.Sprite) {
  for (const a of sprite.userData.attrs as THREE.InstancedBufferAttribute[]) a.needsUpdate = true;
}
