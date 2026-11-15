import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Point = [number, number, number];
type Ring = [x: number, y: number, z: number, radiusX: number, radiusZ: number];
type Stroke = [x: number, y: number, z: number, radius: number];

const mat = (color: string, extra: Partial<THREE.MeshStandardNodeMaterial> = {}) =>
  new THREE.MeshStandardNodeMaterial({ color, roughness: 0.86, flatShading: true, ...extra });

/** Horizontal polygon rings; offset centres form tailored clothes and crooked cones. */
function loft(rings: Ring[], sides = 10, wave = 0): THREE.BufferGeometry {
  const vertices: number[] = [], indices: number[] = [];
  rings.forEach(([x, y, z, rx, rz], row) => {
    for (let i = 0; i < sides; i++) {
      const a = i / sides * Math.PI * 2;
      vertices.push(x + Math.cos(a) * rx, y + Math.sin(a * 3 + 0.5) * wave * (row === 0 ? 1 : 0.4), z + Math.sin(a) * rz);
    }
  });
  for (let row = 0; row < rings.length - 1; row++) {
    for (let i = 0; i < sides; i++) {
      const a = row * sides + i, b = row * sides + (i + 1) % sides;
      indices.push(a, a + sides, b + sides, a, b + sides, b);
    }
  }
  const end = (rings.length - 1) * sides;
  for (let i = 1; i < sides - 1; i++) indices.push(0, i, i + 1, end, end + i + 1, end + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  return g;
}

/** Tapered polygonal sweep for bent wood, straw, seams and articulated limbs. */
function stroke(path: Stroke[], sides = 6): THREE.BufferGeometry {
  const positions: number[] = [], indices: number[] = [];
  const centres = path.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  path.forEach((p, row) => {
    const tangent = centres[Math.min(row + 1, path.length - 1)].clone().sub(centres[Math.max(0, row - 1)]).normalize();
    const u = new THREE.Vector3(Math.abs(tangent.x) < 0.9 ? 1 : 0, Math.abs(tangent.x) < 0.9 ? 0 : 1, 0);
    u.addScaledVector(tangent, -u.dot(tangent)).normalize();
    const v = new THREE.Vector3().crossVectors(tangent, u);
    for (let i = 0; i < sides; i++) {
      const a = i / sides * Math.PI * 2;
      const q = centres[row].clone().addScaledVector(u, Math.cos(a) * p[3]).addScaledVector(v, Math.sin(a) * p[3]);
      positions.push(q.x, q.y, q.z);
      if (row < path.length - 1) {
        const b = row * sides + i, c = row * sides + (i + 1) % sides;
        indices.push(b, c, c + sides, b, c + sides, b + sides);
      }
    }
  });
  const end = (path.length - 1) * sides;
  for (let i = 1; i < sides - 1; i++) indices.push(0, i + 1, i, end, end + i, end + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

/** Folded fabric with a back and thin edges, so banking never exposes missing faces. */
function cloth(rows: Point[][], offset: Point = [0, 0, 0.012]): THREE.BufferGeometry {
  const positions: number[] = [];
  const cols = rows[0].length, front = rows.flat();
  const tri = (a: Point, b: Point, c: Point) => positions.push(...a, ...b, ...c);
  const back = front.map(([x, y, z]): Point => [x + offset[0], y + offset[1], z + offset[2]]);
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      tri(front[a], front[b], front[d]); tri(front[b], front[e], front[d]);
      tri(back[a], back[d], back[b]); tri(back[b], back[d], back[e]);
    }
  }
  const border = [
    ...Array.from({ length: cols }, (_, i) => i),
    ...Array.from({ length: rows.length - 1 }, (_, i) => (i + 2) * cols - 1),
    ...Array.from({ length: cols - 1 }, (_, i) => front.length - 2 - i),
    ...Array.from({ length: rows.length - 2 }, (_, i) => (rows.length - 2 - i) * cols),
  ];
  border.forEach((a, i) => {
    const b = border[(i + 1) % border.length];
    tri(front[a], back[a], front[b]); tri(front[b], back[a], back[b]);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return g;
}

/**
 * Storybook witch facing +Z. The handle crosses the origin and straw ends at -1.6;
 * scarf and lantern keep their animation pivots at the neck and hanging point.
 */
export function buildRider(): { root: THREE.Group; scarf: THREE.Object3D; hat: THREE.Object3D; lantern: THREE.Object3D; body: THREE.Object3D; arms: THREE.Object3D } {
  const root = new THREE.Group();
  root.name = 'Broom witch';
  // the upper body bends forward at the hips (skirt, boots and broom stay put); the arms
  // counter-turn at the shoulders so the hands slide along the handle instead of sinking into it
  const HIP: Point = [0, 0.15, -0.2];
  const SHOULDER: Point = [0, 0.62, -0.08];
  const body = new THREE.Group();
  body.name = 'Upper body';
  body.position.set(...HIP);
  const arms = new THREE.Group();
  arms.name = 'Arms';
  arms.position.set(SHOULDER[0] - HIP[0], SHOULDER[1] - HIP[1], SHOULDER[2] - HIP[2]);
  body.add(arms);
  const scarf = new THREE.Group();
  scarf.name = 'Neck scarf';
  scarf.position.set(0 - HIP[0], 0.72 - HIP[1], -0.12 - HIP[2]);
  const hat = new THREE.Group();
  hat.name = 'Crooked hat';
  hat.position.set(0 - HIP[0], 1.015 - HIP[1], -0.1 - HIP[2]);
  body.add(scarf, hat);
  const lantern = new THREE.Group();
  lantern.name = 'Hanging lantern';
  lantern.position.set(0.015, 0.065, 1.36);
  root.add(body, lantern);
  // parts of these two are authored in the rider's frame and moved into the pivot's own
  const authoredAt = new Map<THREE.Group, Point>([[body, HIP], [arms, SHOULDER]]);

  const wood = mat('#6a4330'), woodLight = mat('#9a6942');
  const straw = mat('#ce9a49'), strawLight = mat('#ebc477'), strawDark = mat('#a97836');
  const twine = mat('#bd8155');
  const plum = mat('#4c2a63'), plumLight = mat('#694271'), lining = mat('#32243f');
  const violet = mat('#302a4b'), hatEdge = mat('#49405e');
  const gold = mat('#d9aa52', { metalness: 0.35, roughness: 0.5 });
  const skin = mat('#e7b18c'), hair = mat('#623727'), hairLight = mat('#9b6039');
  const leather = mat('#392c35'), iron = mat('#2e2a30');
  const red = mat('#bc493b'), orange = mat('#e38a51');
  const glow = mat('#ffcc78', { emissive: new THREE.Color('#ff9838'), emissiveIntensity: 3, roughness: 0.45 });

  // Bake details together per material AND animation pivot to keep draw calls low.
  const batches = new Map<THREE.Group, Map<THREE.Material, THREE.BufferGeometry[]>>();
  const add = (g: THREE.BufferGeometry, m: THREE.Material, parent = root) => {
    const at = authoredAt.get(parent);
    if (at) g.translate(-at[0], -at[1], -at[2]);
    let materials = batches.get(parent);
    if (!materials) { materials = new Map(); batches.set(parent, materials); }
    let geometries = materials.get(m);
    if (!geometries) { geometries = []; materials.set(m, geometries); }
    geometries.push(g);
  };
  const ball = (p: Point, scale: Point, m: THREE.Material, parent = root) =>
    add(new THREE.IcosahedronGeometry(1, 0).scale(...scale).translate(...p), m, parent);
  const box = (size: Point, p: Point, m: THREE.Material, parent = root) =>
    add(new THREE.BoxGeometry(...size).translate(...p), m, parent);
  const band = (radius: number, tube: number, p: Point, m: THREE.Material, parent = root, horizontal = false) => {
    const g = new THREE.TorusGeometry(radius, tube, 4, 10);
    if (horizontal) g.rotateX(Math.PI / 2);
    add(g.translate(...p), m, parent);
  };

  // Gently bowed, knotted handle with a lifted shepherd's curl at its nose.
  add(stroke([
    [0, 0, -1.02, 0.045], [-0.025, -0.012, -0.55, 0.057], [0, 0, 0, 0.052],
    [0.025, 0.015, 0.64, 0.044], [0.015, 0.045, 1.25, 0.039],
    [0.015, 0.11, 1.48, 0.037], [0.015, 0.22, 1.54, 0.032],
    [0.015, 0.28, 1.46, 0.025], [0.015, 0.23, 1.39, 0.012],
  ], 7), wood);
  ball([0.035, 0.026, 0.83], [0.063, 0.05, 0.095], woodLight);
  band(0.035, 0.009, [0.045, 0.048, 0.82], wood);
  add(stroke([[0.035, 0.035, 0.14, 0.008], [0.045, 0.045, 0.6, 0.008], [0.03, 0.068, 1.19, 0.005]], 4), woodLight);

  // Staggered straw fingers make a full bundle with an irregular brush edge.
  add(stroke([[0, 0, -0.69, 0.075], [0, -0.015, -1.03, 0.15], [0, -0.025, -1.37, 0.2], [0, 0, -1.59, 0.035]], 9), strawDark);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * Math.PI * 2, x = Math.cos(a), y = Math.sin(a);
    const end = -1.48 - (i % 3) * 0.06;
    add(stroke([
      [x * 0.045, y * 0.045, -0.73, 0.035],
      [x * 0.14, y * 0.12 - 0.01, -1.04, 0.066],
      [x * 0.23, y * 0.18 - 0.02, -1.33, 0.059],
      [x * 0.25, y * 0.19 - 0.015, end, 0.008],
    ], 5), i % 3 === 0 ? strawLight : straw);
  }
  for (const [z, r] of [[-0.78, 0.087], [-0.92, 0.132]]) {
    band(r, 0.022, [0, -0.006, z], twine);
    band(r, 0.007, [0, -0.006, z - 0.025], strawLight);
  }
  ball([0.08, 0.035, -0.8], [0.04, 0.03, 0.035], twine);

  // Fitted bodice and scalloped skirt draped over both sides of the broom.
  add(loft([[0, 0.15, -0.21, 0.24, 0.23], [0, 0.37, -0.17, 0.19, 0.17], [0, 0.66, -0.11, 0.23, 0.145], [0, 0.73, -0.1, 0.14, 0.11]]), plum, body);
  add(loft([[0, -0.14, -0.22, 0.37, 0.32], [0, -0.09, -0.22, 0.38, 0.33], [0, 0.14, -0.2, 0.29, 0.24], [0, 0.28, -0.18, 0.2, 0.18]], 12, 0.028), plum);
  add(loft([[0, -0.15, -0.22, 0.372, 0.323], [0, -0.12, -0.22, 0.382, 0.333]], 12, 0.028), gold);
  add(loft([[0, 0.31, -0.17, 0.205, 0.18], [0, 0.36, -0.17, 0.2, 0.177]]), leather, body);
  box([0.072, 0.064, 0.025], [0, 0.335, 0.012], gold, body);
  box([0.038, 0.031, 0.029], [0, 0.335, 0.014], leather, body);
  for (const s of [-1, 1]) {
    // Bent sleeves end in cuffs and hands wrapped down onto the handle.
    add(stroke([[s * 0.18, 0.62, -0.08, 0.105], [s * 0.28, 0.37, 0.1, 0.092], [s * 0.12, 0.13, 0.37, 0.069]], 7), plum, arms);
    add(stroke([[s * 0.125, 0.145, 0.355, 0.075], [s * 0.11, 0.115, 0.39, 0.074]], 7), gold, arms);
    ball([s * 0.075, 0.065, 0.405], [0.074, 0.065, 0.083], skin, arms);
    ball([s * 0.034, 0.079, 0.46], [0.032, 0.035, 0.045], skin, arms);
    // Boots with broad cuffs, soles and turned-up toes visible below the skirt.
    add(loft([[s * 0.265, -0.41, -0.08, 0.083, 0.09], [s * 0.27, -0.16, -0.13, 0.09, 0.09], [s * 0.265, -0.07, -0.14, 0.105, 0.1]], 7), leather);
    add(loft([[s * 0.265, -0.13, -0.14, 0.108, 0.103], [s * 0.265, -0.075, -0.14, 0.114, 0.11]], 7), lining);
    add(stroke([[s * 0.265, -0.39, -0.1, 0.09], [s * 0.27, -0.425, 0.045, 0.095], [s * 0.28, -0.39, 0.15, 0.035]], 6), leather);
    box([0.15, 0.027, 0.22], [s * 0.27, -0.486, -0.005], iron);
    box([0.04, 0.043, 0.018], [s * 0.27, -0.24, -0.04], gold);
  }

  // Rear silhouette: tailored cape with ridged folds, scallops and gold piping.
  const cape: Point[][] = [
    [0.18, 0.74, -0.2], [0.31, 0.58, -0.32], [0.4, 0.3, -0.55], [0.44, 0.035, -0.79],
  ].map(([w, y, z], row) => Array.from({ length: 9 }, (_, col): Point => {
    const u = col / 4 - 1;
    return [u * w, y + (row === 3 ? (col % 2 ? 0.045 : 0) + Math.abs(u) * 0.045 : -Math.abs(u) * 0.04), z + u * u * 0.09 - (col % 2 ? 0.028 : 0)];
  }));
  add(cloth(cape), plumLight, body);
  for (const col of [0, 8]) add(stroke(cape.map(row => [...row[col], 0.012] as Stroke), 4), gold, body);
  add(stroke(cape[3].map(([x, y, z]) => [x, y, z - 0.005, 0.011]), 4), gold, body);
  add(new THREE.OctahedronGeometry(0.075).scale(0.8, 1, 0.18).translate(-0.13, 0.49, -0.421), gold, body);
  add(new THREE.OctahedronGeometry(0.038).scale(0.8, 1, 0.2).translate(-0.13, 0.49, -0.434), violet, body);

  // Face, chestnut hair cap and alternating braid beneath the back brim.
  ball([0, 0.865, -0.06], [0.178, 0.202, 0.164], skin, body);
  ball([0, 0.84, 0.108], [0.045, 0.044, 0.063], skin, body);
  for (const s of [-1, 1]) {
    ball([s * 0.168, 0.86, -0.05], [0.035, 0.058, 0.043], skin, body);
    ball([s * 0.066, 0.884, 0.079], [0.016, 0.021, 0.012], iron, body);
    add(stroke([[s * 0.13, 0.99, -0.1, 0.068], [s * 0.17, 0.88, -0.12, 0.06], [s * 0.145, 0.74, -0.17, 0.025]], 5), hair, body);
  }
  ball([0, 0.935, -0.14], [0.18, 0.13, 0.14], hair, body);
  for (let i = 0; i < 6; i++) {
    ball([0.1 + (i % 2 ? 0.025 : -0.02), 0.83 - i * 0.065, -0.253 - i * 0.035], [0.065 - i * 0.005, 0.063, 0.048], i % 2 ? hairLight : hair, body);
  }
  band(0.03, 0.012, [0.11, 0.455, -0.45], gold, body, true);
  add(stroke([[0.11, 0.45, -0.45, 0.033], [0.13, 0.38, -0.49, 0.006]], 5), hairLight, body);

  // Wide, uneven brim with a bevelled lip and a tall crown kinked over at the tip.
  add(loft([[0, -0.022, 0, 0.39, 0.315], [0, -0.008, 0, 0.445, 0.35], [0, 0.014, 0, 0.436, 0.343], [0, 0.04, 0, 0.22, 0.19]], 14, 0.024), violet, hat);
  add(loft([[0, -0.012, 0, 0.447, 0.352], [0, 0.003, 0, 0.442, 0.348]], 14, 0.024), hatEdge, hat);
  add(loft([[0, 0.025, 0, 0.214, 0.183], [0.015, 0.18, -0.025, 0.175, 0.15], [0.005, 0.36, -0.045, 0.119, 0.104], [-0.06, 0.49, -0.065, 0.071, 0.066], [-0.17, 0.575, -0.07, 0.034, 0.032], [-0.27, 0.555, -0.065, 0.003, 0.004]]), violet, hat);
  add(loft([[0.001, 0.045, -0.003, 0.213, 0.183], [0.008, 0.12, -0.014, 0.196, 0.17]]), red, hat);
  box([0.115, 0.082, 0.024], [0, 0.086, 0.18], gold, hat);
  box([0.071, 0.045, 0.029], [0, 0.086, 0.183], leather, hat);
  box([0.014, 0.056, 0.034], [0.009, 0.086, 0.187], gold, hat);
  add(new THREE.OctahedronGeometry(0.045).scale(0.85, 1.3, 0.15).translate(-0.035, 0.265, -0.162), gold, hat);

  band(0.125, 0.045, [0, 0.731, -0.07], red, body, true);
  ball([-0.13, 0.727, -0.14], [0.07, 0.056, 0.065], orange, body);
  const ribbon = (side: number, length: number): Point[][] => [
    [[side * 0.1 - 0.045, 0, -0.04], [side * 0.1 + 0.045, 0, -0.04]],
    [[side * 0.16 - 0.06, 0.035, -0.29], [side * 0.16 + 0.06, 0.045, -0.29]],
    [[side * 0.22 - 0.065, -0.005, -length], [side * 0.22 + 0.065, 0.015, -length - 0.035]],
    [[side * 0.23 - 0.063, 0.015, -length - 0.13], [side * 0.23 + 0.06, 0.025, -length - 0.09]],
  ];
  for (const s of [-1, 1]) {
    const rows = ribbon(s, s === -1 ? 0.63 : 0.5);
    add(cloth(rows, [0, -0.009, 0]), red, scarf);
    add(stroke(rows[2].map(([x, y, z]) => [x, y + 0.003, z - 0.01, 0.011]), 4), orange, scarf);
  }

  // Miniature castle lantern: hanging loop, warm glass, corner posts and a hipped cap.
  band(0.037, 0.009, [0, -0.043, 0], iron, lantern);
  add(stroke([[0, -0.072, 0, 0.009], [0, -0.135, 0, 0.009]], 4), iron, lantern);
  add(loft([[0, -0.226, 0, 0.137, 0.137], [0, -0.16, 0, 0.035, 0.035]], 4).rotateY(Math.PI / 4), violet, lantern);
  box([0.175, 0.024, 0.175], [0, -0.235, 0], gold, lantern);
  box([0.133, 0.16, 0.133], [0, -0.33, 0], glow, lantern);
  for (const x of [-0.079, 0.079]) for (const z of [-0.079, 0.079])
    box([0.017, 0.19, 0.017], [x, -0.329, z], iron, lantern);
  box([0.19, 0.028, 0.19], [0, -0.427, 0], gold, lantern);
  add(loft([[0, -0.482, 0, 0.025, 0.025], [0, -0.442, 0, 0.13, 0.13]], 4).rotateY(Math.PI / 4), violet, lantern);
  ball([0, -0.49, 0], [0.025, 0.032, 0.025], gold, lantern);

  for (const [parent, materials] of batches) {
    for (const [material, geometries] of materials) {
      // Normalise primitive/custom attributes and bake triangle normals for crisp facets.
      const flat = geometries.map(g => {
        const triangles = g.index ? g.toNonIndexed() : g.clone();
        for (const key of Object.keys(triangles.attributes)) if (key !== 'position') triangles.deleteAttribute(key);
        triangles.computeVertexNormals();
        return triangles;
      });
      const merged = mergeGeometries(flat);
      geometries.forEach(g => g.dispose());
      flat.forEach(g => g.dispose());
      if (!merged) throw new Error('Could not merge rider geometry');
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
  return { root, scarf, hat, lantern, body, arms };
}
