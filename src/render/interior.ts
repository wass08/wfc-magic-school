import * as THREE from 'three/webgpu';
import { Fn, abs, attribute, cameraPosition, clamp, cross, dFdx, dFdy, dot, float, floor, fract, fwidth, max, min, mix, normalWorld, normalize, positionWorld, select, smoothstep, step, texture, vec2, vec3 } from 'three/tsl';

/**
 * Fake interiors behind window panes ("interior mapping" with a single painting).
 *
 * The painting is a one-point-perspective view of a room straight through the window.
 * Each pane ray-casts into an imaginary box behind the wall (pane-sized, `depth` deep) and
 * finds which wall, floor or ceiling the eye ray hits; the hit is then projected back
 * into the painting the way the painter's camera saw it. Walls slide and foreshorten with
 * the view, so a flat quad reads as a room with depth.
 */
export interface RoomPainting {
  url: string;
  /** size of the back wall in the painting, as a fraction of the image (x, y) */
  back: [number, number];
  /** where the back wall's centre sits in the painting (uv, y up) */
  vanish: [number, number];
  /** room depth relative to the pane's larger side */
  depth: number;
  /** share of the windows that show this room (the shares are normalised) */
  weight: number;
  /** colour of the light the room spills out (window halo, pools on the ground), linear */
  light: [number, number, number];
  /** saturation kept in the room's glow (cool and coloured rooms are calmed a little) */
  sat: number;
  /** extra light for darker paintings, so every lit room reads as lit at night */
  gain?: number;
}

/**
 * The paintings (640 × 1536, portrait like the panes), measured by eye: back wall size and
 * centre in each image, and how deep the room box feels. Every interior pane shows one of
 * them, picked per window.
 */
export const ROOMS: RoomPainting[] = [
  // warm candle- and fire-lit rooms are the clear majority (≈80 %) …
  { url: 'textures/window-library.webp', back: [0.458, 0.329], vanish: [0.502, 0.54], depth: 1.4, weight: 0.28, light: [1, 0.6, 0.3], sat: 1 },
  { url: 'textures/window-common-room.webp', back: [0.5625, 0.225], vanish: [0.5, 0.51], depth: 1.3, weight: 0.27, light: [1, 0.56, 0.24], sat: 1 },
  { url: 'textures/window-dining-room.webp', back: [0.531, 0.277], vanish: [0.5, 0.572], depth: 1.6, weight: 0.25, light: [1, 0.64, 0.32], sat: 1 },
  // … with the odd moonlit dormitory and, rarer still, a potions classroom
  { url: 'textures/window-bedroom.webp', back: [0.617, 0.339], vanish: [0.503, 0.551], depth: 1.2, weight: 0.13, light: [0.42, 0.42, 0.75], sat: 0.8, gain: 2.2 },
  { url: 'textures/window-potion-class.webp', back: [0.503, 0.326], vanish: [0.502, 0.538], depth: 1.3, weight: 0.07, light: [0.45, 0.8, 0.38], sat: 0.7, gain: 1.3 },
];

/** cumulative share of each room (upper bound of its slice of 0…1) */
const ROOM_EDGES = (() => {
  const total = ROOMS.reduce((a, r) => a + r.weight, 0);
  let acc = 0;
  return ROOMS.map((r) => (acc += r.weight / total));
})();

/** Room for a 0…1 roll, by the rooms' shares (CPU). */
export function roomOfRoll(r: number): number {
  let i = 0;
  while (i < ROOMS.length - 1 && r >= ROOM_EDGES[i]) i++;
  return i;
}

/** Same in TSL: the number of slice edges the roll has passed. */
export function roomOfRollNode(r: any): any {
  return ROOM_EDGES.slice(0, -1).reduce((acc: any, e) => acc.add(step(e, r)), float(0));
}

/**
 * Which room a window shows in the copy of its module at instance position (x, y, z), for a
 * window seed (aFx.w). Mirrors the castle shader's roll exactly (fract arithmetic only).
 */
export function roomOfWindow(seed: number, x: number, y: number, z: number): number {
  const fr = (v: number) => v - Math.floor(v);
  return roomOfRoll(fr(seed * 5.31 + fr(x * 0.0731) + fr(y * 0.0619) + fr(z * 0.0857)));
}

/**
 * Painting detail is held below the castle's: the sample is this many times blurrier than
 * the screen footprint asks for (≈1.7 mip levels), then lightly posterized.
 */
const MIP_BLUR = 3.2;
const POSTER_STEPS = 12;

/** size of each painting in the atlas (the source images' size) */
const TILE_W = 640, TILE_H = 1536;

/**
 * All paintings side by side in one texture (one sample per fragment whatever the room).
 * Built at load time from the separate files, so a painting can be swapped on its own.
 */
function loadAtlas(rooms: RoomPainting[]) {
  const canvas = document.createElement('canvas');
  canvas.width = TILE_W * rooms.length;
  canvas.height = TILE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#2a2030';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  rooms.forEach((room, i) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, i * TILE_W, 0, TILE_W, TILE_H);
      t.needsUpdate = true;
    };
    img.src = `${import.meta.env.BASE_URL}${room.url}`;
  });
  return t;
}

/** Pane coordinates (u, v, pane width, pane height) on interior panes (aAux, see GeoBuilder.build). */
export const paneAttr = () => attribute<'vec4'>('aAux', 'vec4');

/**
 * Screen gradients of the pane coordinates, for the painting's mip level. Take them in
 * uniform control flow (outside any If) and pass them to the room sampler: the reprojected
 * uv jumps at the room's corners, which would otherwise pick a tiny mip and draw seams.
 */
export const paneGradients = () => {
  const win = paneAttr();
  return { gx: dFdx(win.xy).mul(MIP_BLUR), gy: dFdy(win.xy).mul(MIP_BLUR) };
};

/**
 * Lead cames across a pane: a diamond lattice in pane units. `glass` is 1 on the glass and 0 on
 * the lead (anti-aliased); `cell` identifies the diamond (each piece of glass is a little
 * different). Take it in uniform control flow, like the gradients.
 */
export const paneCames = (cell = 0.17, width = 0.024) => {
  const win = paneAttr();
  const p = vec2(win.x.mul(win.z), win.y.mul(win.w));
  const q1 = p.x.add(p.y).div(cell);
  const q2 = p.x.sub(p.y).div(cell);
  const d = min(float(0.5).sub(abs(fract(q1).sub(0.5))), float(0.5).sub(abs(fract(q2).sub(0.5))));
  const aa = fwidth(q1).max(1e-4);
  // never thinner than ~1 px, but faded out as it gets that thin (no shimmering grate at a distance)
  const w = max(float(width), aa.mul(0.6));
  const thin = smoothstep(aa.mul(2.5), aa.mul(0.8), float(width));
  const glass = mix(smoothstep(w, aa.mul(1.3).add(w), d), float(1), thin.mul(0.7));
  return { glass, cell: vec2(floor(q1), floor(q2)) };
};

/** Colour seen through the pane at this fragment: `roomView()(gx, gy, room index)`. */
export function roomView(rooms: RoomPainting[] = ROOMS) {
  const map = loadAtlas(rooms);
  const win = paneAttr();
  const N = rooms.length;

  return Fn(([gx, gy, index]: [any, any, any]) => {
    // this pane's painting and its measurements
    const pick = (f: (r: RoomPainting) => any) => rooms.slice(1).reduce((acc: any, r, i) => select(index.equal(i + 1), f(r), acc), f(rooms[0]));
    const s = pick((r) => vec2(r.back[0], r.back[1]));
    const vp = pick((r) => vec2(r.vanish[0], r.vanish[1]));
    const depth: any = pick((r) => float(r.depth));
    const sat: any = pick((r) => float(r.sat));
    const gain: any = pick((r) => float(r.gain ?? 1));

    const n = normalize(normalWorld);
    const up = vec3(0, 1, 0);
    const t = normalize(cross(up, n)); // pane's +u (right, seen from outside)
    const v = normalize(positionWorld.sub(cameraPosition));
    // eye ray in room space: x across, y up, z into the room; box normalised to a unit cube
    const size = vec3(win.z, win.w, max(win.z, win.w).mul(depth as any) as any);
    const d0 = vec3(dot(v, t), dot(v, up), dot(v, n).negate()).div(size);
    const safe = (c: any) => select(abs(c).lessThan(1e-5), float(1e-5), c);
    const d = vec3(safe(d0.x), safe(d0.y), max(d0.z, 1e-5));
    const p0 = vec3(win.x, win.y, 0);
    const tx = step(0, d.x).sub(p0.x).div(d.x);
    const ty = step(0, d.y).sub(p0.y).div(d.y);
    const tz = float(1).div(d.z);
    const hit = p0.add(d.mul(min(min(tx, ty), tz)));
    const zn = clamp(hit.z, 0, 1);
    // back into the painting: the pane maps to the whole image, the back wall to `back`,
    // centred on `vanish`
    const k = s.div(s.add(vec2(1).sub(s).mul(zn)));
    const uv = vec2(0.5).add(hit.xy.sub(0.5).mul(k)).add(vp.sub(0.5).mul(vec2(1).sub(k)).div(vec2(1).sub(s)));
    // into this painting's slot of the atlas (inset so mips don't bleed from the neighbour)
    const inner = clamp(uv as any, vec2(0.006, 0.002), vec2(0.994, 0.998)) as any;
    const atlas = vec2(inner.x.add(index).div(N), inner.y);
    const scale = vec2(1 / N, 1);
    const c0 = texture(map, atlas).grad(gx.mul(scale), gy.mul(scale)).rgb;
    // a soft posterize: flatter colour, no crisp painterly detail to out-shine the walls
    const cp = mix(c0, floor(c0.mul(POSTER_STEPS).add(0.5)).div(POSTER_STEPS), 0.55);
    // cool and coloured rooms are calmed a little (a potions room glows green, not toxic)
    const c = mix(vec3(dot(cp, vec3(0.2126, 0.7152, 0.0722))), cp, sat);
    // lit near the window, falling into shadow toward the back wall (and up into the rafters)
    const falloff = mix(float(1), float(0.5), smoothstep(0, 1, zn)).mul(mix(float(1), float(0.72), smoothstep(0.62, 1, hit.y)));
    return c.mul(falloff).mul(gain);
  });
}
