import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  cameraPosition,
  cross,
  attribute,
  cameraViewMatrix,
  clamp,
  cos,
  dot,
  float,
  floor,
  fract,
  max,
  min,
  mix,
  mod,
  normalWorld,
  normalize,
  positionGeometry,
  positionWorld,
  select,
  sin,
  smoothstep,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
  vertexColor,
} from 'three/tsl';
import { WINDOWS_OFF } from '../geo/builder';
import { paneAttr, paneCames, paneGradients, roomOfRollNode, roomView } from './interior';
import { windowLightAt } from './windowLight';

/** Shared animation/lighting uniforms (TSL uniform nodes: `.value` is read/written from JS). */
export const globalUniforms = {
  uTime: uniform(0),
  uEmissive: uniform(1),
  uNight: uniform(0),
  /** sky colour mirrored by window glass (set from the sky each frame) */
  uSkyGlass: uniform(new THREE.Vector3(0.3, 0.32, 0.4)),
  /** 1: room panes draw as the old flat glowing leaded glass (debug switch) */
  uClassicWindows: uniform(0),
};

type N = any;

/**
 * Per-instance placement shared by the castle and water materials: `local` (the geometry,
 * possibly swayed) grows in with the pop-in ease from the instance's aSpawn time, then is turned
 * and moved by aInst = (x, y, z, quarter turns).
 *
 * In three r187 `positionNode` replaces the position *after* instancing, so the instance
 * transform is rebuilt here instead of coming from the instance matrix.
 */
function placeInstance(local: N): N {
  const { uTime } = globalUniforms;
  const spawn = attribute<'float'>('aSpawn', 'float');
  const inst = attribute<'vec4'>('aInst', 'vec4');
  const sp = clamp(uTime.sub(spawn).div(0.6), 0, 1);
  // easeOutBack, written with products: pow() of a negative base is undefined on the GPU
  // (NaN on many drivers), which used to poison the frame while chunks popped in.
  const t = sp.sub(1);
  const c1 = 1.70158;
  const grow = max(float(1).add(t.mul(t).mul(t).mul(c1 + 1)).add(t.mul(t).mul(c1)), 0.0001);
  const p = local.mul(grow);
  const ang = inst.w.mul(Math.PI / 2);
  const ca = cos(ang);
  const sa = sin(ang);
  // rotation about +Y (three.js convention): x' = x cos + z sin, z' = -x sin + z cos
  return vec3(p.x.mul(ca).add(p.z.mul(sa)), p.y, p.z.mul(ca).sub(p.x.mul(sa))).add(inst.xyz);
}

// --- shared procedural helpers (ports of the old GLSL snippets) -------------------------------

const h21 = Fn(([p0]: [N]) => {
  const p = fract(vec2(p0).mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
});

const vnoise = Fn(([p]: [N]) => {
  const i = floor(p);
  const f0 = fract(p);
  const f: N = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  const a = h21(i);
  const b = h21(i.add(vec2(1, 0)));
  const c = h21(i.add(vec2(0, 1)));
  const d = h21(i.add(vec2(1, 1)));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
});

/** Planar UV for a world position given its normal (top faces use XZ, sides use the dominant axis). */
const planeUV = (p: N, n: N): N => {
  const a: N = abs(n);
  const side = select(a.x.greaterThan(a.z), vec2(p.z, p.y), vec2(p.x, p.y));
  return select(a.y.greaterThan(max(a.x, a.z)), vec2(p.x, p.z), side);
};

/** Running-bond bricks: returns the mortar mask (0 in joints) and the brick id. */
const bricks = (uv0: N, size: [number, number], mortar: number) => {
  const sz = vec2(size[0], size[1]);
  const row = floor(uv0.y.div(sz.y));
  const uv = vec2(uv0.x.add(mod(row, 2).mul(0.5 * size[0])), uv0.y);
  const g = uv.div(sz);
  const id = floor(g);
  const f = fract(g);
  const e = min(f, vec2(1).sub(f)).mul(sz);
  return { m: smoothstep(0, mortar, min(e.x, e.y)), id };
};

/**
 * One material for every castle module. Per-vertex attributes:
 *  aFx   = (emissive, flicker, materialId, -)
 *  aAux  = sway (dir.xyz, amplitude), or the pane coordinates on interior windows (matId 13)
 * Per-instance attributes: aSpawn = time the instance appeared (pop-in), aInst = (x, y, z, quarter turns).
 *
 * In three r187 `positionNode` replaces the position *after* instancing, so the sway and
 * pop-in are applied to the raw geometry and the instance transform is rebuilt from aInst.
 */
export function createCastleMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.88, metalness: 0 });
  const { uTime, uEmissive } = globalUniforms;

  const fx = attribute<'vec4'>('aFx', 'vec4');
  const sway = attribute<'vec4'>('aAux', 'vec4');
  // interior panes keep their pane coordinates in aAux: they never sway
  const swayAmp = select(floor(fx.z.add(0.5)).equal(13), float(0), sway.w);
  const inst = attribute<'vec4'>('aInst', 'vec4');

  // --- vertex: sway, pop-in, instance transform
  const ipos = inst.xyz;
  const ph = dot(ipos, vec3(0.37, 0.11, 0.53));
  const p = positionGeometry;
  const wave = sin(uTime.mul(2.3).add(ph).add(p.y.mul(2.5)).add(p.x.mul(1.3))).add(
    sin(uTime.mul(3.7).add(ph.mul(2)).add(p.y.mul(5))).mul(0.4),
  );
  m.positionNode = placeInstance(p.add(sway.xyz.mul(swayAmp).mul(wave)));

  // only magic pulses; flames, lanterns and windows burn steady
  const flick = varying(
    float(1).sub(
      select(floor(fx.z.add(0.5)).equal(10), fx.y, float(0))
        .mul(sin(uTime.mul(9).add(ph.mul(13)).add(p.x.mul(3))).mul(0.5).add(0.5))
        .mul(sin(uTime.mul(5.3).add(ph.mul(7)).add(p.z.mul(2))).mul(0.5).add(0.5))
        .mul(0.8),
    ),
  );

  // --- fragment: procedural surfaces
  const matId = floor(fx.z.add(0.5));
  // the classic-window switch turns room panes back into plain glowing glass (matId 6)
  const classic = globalUniforms.uClassicWindows.greaterThan(0.5);
  const isRoom = matId.equal(13).and(classic.not());
  const isGlass = matId.equal(6).or(matId.equal(13).and(classic));
  const room = roomView();
  // which painting a pane shows: per window and per copy of the module
  const ipos0 = attribute<'vec4'>('aInst', 'vec4').xyz;
  // (mostly warm rooms, see ROOMS; mirrored on the CPU by roomOfWindow)
  const roomIndex = roomOfRollNode(
    fract(fx.w.mul(5.31).add(fract(ipos0.x.mul(0.0731))).add(fract(ipos0.y.mul(0.0619))).add(fract(ipos0.z.mul(0.0857)))),
  );
  const surface = Fn(() => {
    const col = vertexColor().rgb.toVar();
    const pat = float(1).toVar();
    const glow = float(1).toVar();
    // derivatives must be taken in uniform control flow, before the branches
    const pane = paneGradients();
    const gx = pane.gx.toVar();
    const gy = pane.gy.toVar();
    const n = normalize(normalWorld);
    const wp = positionWorld;
    const uv = planeUV(wp, n);

    If(matId.equal(1), () => {
      // stone: square flags on top, running bond on walls, grime toward the ground, moss
      const top = bricks(uv, [0.6, 0.6], 0.03);
      const wall = bricks(uv, [0.52, 0.24], 0.022);
      const isTop = abs(n.y).greaterThan(0.7);
      const mm = select(isTop, top.m, wall.m);
      const id = select(isTop, top.id, wall.id);
      const shade = h21(id).mul(0.3).add(0.82);
      pat.assign(mix(0.58, shade, mm).mul(vnoise(uv.mul(3)).mul(0.2).add(0.9)));
      pat.mulAssign(mix(0.86, 1, smoothstep(0, 1.2, wp.y)));
      // moss where damp lingers: rising from the ground, on north faces (−z, away from the sun),
      // on ledge tops; thinning out higher up, in broad patches rather than spots
      const base = smoothstep(2.2, 0.1, wp.y);
      const north = smoothstep(0.2, 0.9, n.z.negate()).mul(0.55);
      const ledge = smoothstep(0.6, 0.95, n.y).mul(0.4);
      const height = mix(float(1), float(0.25), smoothstep(1.5, 8, wp.y));
      const damp = max(base, max(north, ledge)).mul(height);
      const patch = vnoise(uv.mul(0.9).add(7)).mul(0.65).add(vnoise(uv.mul(3.7).add(3)).mul(0.35));
      const moss = smoothstep(float(0.78).sub(damp.mul(0.3)), float(0.9).sub(damp.mul(0.25)), patch).mul(damp);
      col.assign(mix(col, vec3(0.24, 0.3, 0.15), moss.mul(0.55)));
    })
      .ElseIf(matId.equal(2), () => {
        // slate roof
        const c = select(abs(n.x).greaterThan(abs(n.z)), wp.z, wp.x);
        const q = vec2(c, wp.y);
        const b = bricks(q, [0.34, 0.17], 0.018);
        pat.assign(mix(0.55, h21(b.id).mul(0.32).add(0.82), b.m));
        // moss on the shaded (north) slopes only, in broad patches; sunny slopes stay clean
        const shade = smoothstep(-0.1, 0.7, n.z.negate()).mul(mix(float(1), float(0.4), smoothstep(3, 10, wp.y)));
        const moss = smoothstep(0.7, 0.92, vnoise(q.mul(1.1)).mul(0.7).add(vnoise(q.mul(4.3)).mul(0.3))).mul(shade);
        col.assign(mix(col, vec3(0.26, 0.32, 0.19), moss.mul(0.32)));
      })
      .ElseIf(matId.equal(3), () => {
        // wood
        pat.assign(sin(uv.x.mul(40).add(vnoise(uv.mul(vec2(2, 18))).mul(5))).mul(0.18).add(0.82));
      })
      .ElseIf(matId.equal(5), () => {
        // foliage
        pat.assign(vnoise(wp.xz.mul(7).add(wp.y.mul(5))).mul(0.55).add(0.72));
      })
      .ElseIf(isGlass, () => {
        // leaded glass
        const d1 = abs(fract(uv.x.add(uv.y).mul(6)).sub(0.5));
        const d2 = abs(fract(uv.x.sub(uv.y).mul(6)).sub(0.5));
        const lines = smoothstep(0, 0.07, min(d1, d2));
        glow.assign(lines.mul(0.65).add(0.35));
        pat.assign(glow);
      })
      .ElseIf(matId.equal(7), () => {
        // cloth
        pat.assign(sin(uv.y.mul(80)).mul(0.1).add(0.9));
      })
      .ElseIf(matId.equal(8), () => {
        // paving
        const b = bricks(uv, [0.7, 0.55], 0.035);
        pat.assign(mix(0.6, h21(b.id).mul(0.25).add(0.85), b.m));
      })
      .ElseIf(matId.equal(9), () => {
        // grass
        pat.assign(vnoise(wp.xz.mul(3)).mul(0.35).add(0.78).add(h21(floor(wp.xz.mul(24))).mul(0.12)));
      })
      .ElseIf(matId.equal(12), () => {
        // falling water: streaks sliding down
        const lane = floor(wp.x.add(wp.z).mul(7));
        const streak = sin(wp.y.mul(9).add(uTime.mul(7)).add(h21(vec2(lane, 3)).mul(6.28))).mul(0.5).add(0.5);
        pat.assign(streak.mul(0.35).add(0.75));
        glow.assign(streak.mul(0.6).add(0.6));
      })
      .ElseIf(matId.equal(10), () => {
        // magic
        glow.assign(sin(uTime.mul(2).add(wp.x).add(wp.z)).mul(0.3).add(0.7));
      })
      .ElseIf(isRoom, () => {
        // a painted room behind the glass (interior mapping)
        col.assign(room(gx, gy, roomIndex));
      });

    return vec4(col.mul(pat), glow);
  });
  const s = surface();

  // rooms: seen through slightly amber hand-blown glass held in lead cames. The glass is dark
  // and glossy (it mirrors the sky), the cames dull grey-brown lead; every diamond of glass is a
  // little different (brightness, tint, the angle it catches the sky at)
  const cames = paneCames();
  const came = cames.glass;
  const ip = attribute<'vec4'>('aInst', 'vec4').xyz;
  const pieceId = cames.cell.add(vec2(fx.w.mul(91.7), ip.x.add(ip.z.mul(1.37)).add(ip.y.mul(0.71))));
  const pieceA = h21(pieceId);
  const pieceB = h21(pieceId.add(17.3));
  const piece = vec3(pieceB.sub(0.5).mul(0.1).add(1), 1, pieceB.sub(0.5).mul(-0.14).add(1)).mul(pieceA.mul(0.34).add(0.83));
  const tint = vec3(0.96, 0.88, 0.74).mul(piece);
  const lead = vec3(0.1, 0.088, 0.075);
  m.colorNode = select(isRoom, mix(lead, s.rgb.mul(tint).mul(0.08), came), s.rgb);
  m.roughnessNode = select(
    matId.equal(4),
    float(0.32),
    select(isRoom, mix(float(0.55), float(0.05), came),
    select(isGlass, float(0.25), select(matId.equal(11), float(0.5), select(matId.equal(2), float(0.62), float(0.88))))),
  );
  m.metalnessNode = select(matId.equal(4), float(1), select(matId.equal(11), float(0.7), float(0)));
  // own glow (windows, lanterns, magic) + night window light landing on flat surfaces
  // the room glows through the glass, kept below a plain lit window's glow; its brightest bits
  // (candles, fires, lanterns) glow a little more and just catch the bloom. A little of it
  // creeps over the lead (halation), so the lattice never reads as a black grate
  const roomLight = s.rgb.mul(tint);
  const hot = smoothstep(0.12, 0.46, dot(roomLight, vec3(0.2126, 0.7152, 0.0722)));
  const glowColor = select(isRoom, roomLight.mul(hot.mul(10).add(1.7)).mul(mix(float(0.22), float(1), came)), vertexColor().rgb);
  // not every window is lit: a share stays dark per copy of the module (see windowOff)
  const seed = fx.w;
  const roll = fract(seed.mul(7.13).add(fract(ip.x.mul(0.1031))).add(fract(ip.y.mul(0.0973))).add(fract(ip.z.mul(0.1099))));
  const lit = select(seed.greaterThan(0).and(roll.lessThan(WINDOWS_OFF)), float(0), float(1));
  // the glass mirrors the sky: fresnel at grazing angles plus a soft sheen sliding across the
  // pane as the camera moves (dark windows keep it too: glass reflects whether or not it's lit);
  // each piece sits at a slightly different angle, so it catches the sheen a little off
  const toEye = normalize(cameraPosition.sub(positionWorld));
  const nW = normalize(normalWorld);
  const fres = float(1).sub(abs(dot(nW, toEye))).pow(3).mul(0.8).add(0.05).mul(pieceA.mul(0.5).add(0.75));
  const pane = paneAttr();
  const across = normalize(cross(vec3(0, 1, 0), nW));
  const slide = pane.x.add(pane.y.mul(0.35)).sub(dot(toEye, across).mul(0.9)).add(pieceB.sub(0.5).mul(0.08));
  const sheen = smoothstep(0.14, 0, abs(slide.sub(0.3))).mul(0.6).add(smoothstep(0.05, 0, abs(slide.sub(0.62))).mul(0.4));
  const mirror = globalUniforms.uSkyGlass.mul(fres.add(sheen.mul(0.55))).mul(mix(float(0.2), float(1), came));
  m.emissiveNode = glowColor
    .mul(fx.x)
    .mul(uEmissive)
    .mul(flick)
    .mul(s.a)
    .mul(lit)
    .add(s.rgb.mul(windowLightAt(normalWorld)))
    .add(select(isRoom, mirror, vec3(0)));
  return m;
}

export function createWaterMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({
    roughness: 0.26,
    metalness: 0.08,
    transparent: true,
    opacity: 0.86,
  });
  const { uTime, uNight, uSkyGlass } = globalUniforms;
  const waveStrength = 0.065;
  const skyStrength = 0.65;
  const windowStrength = 0.8;
  const causticStrength = 0.13;

  // grows in with the castle piece it belongs to (same instance attributes)
  m.positionNode = placeInstance(positionGeometry);

  // Read the unperturbed, instanced normal in the vertex stage. A surface frame keeps
  // waterfall sheets vertical (and their patterns flowing down), including rotated copies.
  const n = normalize(varying(normalWorld));
  const horizontal = abs(n.y).greaterThan(0.7);
  const across = normalize(select(horizontal, vec3(1, 0, 0), vec3(n.z, 0, n.x.negate())));
  const along = cross(n, across);
  const uv = vec2(dot(positionWorld, across), dot(positionWorld, along));
  const flow = select(horizontal, float(0.1), float(0.65));

  // Just two single-octave noises: broad pigment variation and stretched brush strokes.
  // World-space coordinates join canal cells without drawing a false foam grid at seams.
  const pigment = vnoise(uv.mul(0.42).add(vec2(uTime.mul(0.018), uTime.mul(-0.012))));
  const strokes = vnoise(vec2(uv.x.mul(0.85).add(pigment.mul(0.4)), uv.y.mul(5.2).add(uTime.mul(flow))));
  const a = cos(dot(uv, vec2(1.7, 0.8)).sub(uTime.mul(0.48)).add(pigment.mul(0.75)));
  const b = cos(dot(uv, vec2(-0.65, 2.3)).add(uTime.mul(0.36)));
  const c = cos(dot(uv, vec2(4.3, 3.1)).sub(uTime.mul(0.63)));
  const slope = vec2(a.mul(0.55).sub(b.mul(0.22)).add(c.mul(0.12)), a.mul(0.26).add(b.mul(0.58)).add(c.mul(0.09))).mul(waveStrength);
  const waterNormal = normalize(n.sub(across.mul(slope.x)).sub(along.mul(slope.y)));
  // normalNode is view space
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(waterNormal, 0)).xyz);

  const toEye = normalize(cameraPosition.sub(positionWorld));
  const grazing = float(1).sub(clamp(abs(dot(waterNormal, toEye)), 0, 1));
  const fresnel = grazing.mul(grazing).mul(grazing);
  // Apparent depth from pigment, not scene depth: deep teal below a soft sky wash.
  const body = mix(vec3(0.018, 0.065, 0.082), vec3(0.045, 0.155, 0.16), pigment).mul(mix(1, 0.7, uNight));
  m.colorNode = mix(body, uSkyGlass, fresnel.mul(0.32));

  const glint = smoothstep(0.46, 0.8, strokes).mul(smoothstep(0.24, 0.72, pigment));
  const sky = uSkyGlass.mul(fresnel.mul(skyStrength).add(0.055).add(glint.mul(0.045)));
  // Reuse the waves for faint, broad caustic bands; fade them out with daylight.
  const caustic = smoothstep(0.7, 0.96, float(1).sub(abs(a.sub(b)).mul(0.5))).mul(pigment);
  // The existing light map supplies actual nearby window colours, rather than gold specks
  // across unlit canals. Its level already follows the lamps through dusk and night.
  const windows = windowLightAt(n).mul(glint.mul(windowStrength).add(0.2));
  m.emissiveNode = sky.add(windows).add(vec3(0.11, 0.23, 0.2).mul(caustic).mul(float(1).sub(uNight)).mul(causticStrength));
  return m;
}

export function createGhostMaterial() {
  return new THREE.MeshBasicNodeMaterial({ color: '#9fffb0', transparent: true, opacity: 0.38, depthWrite: false });
}
