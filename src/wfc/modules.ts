/**
 * Module catalogue: sockets only. Geometry lives in src/geo/modules.ts so the
 * WFC layer stays pure data.
 *
 * Horizontal sockets (side order: +X, -Z, -X, +Z):
 *   joins (a structure continues across the edge)
 *     w   castle wall          h   hall body          hr  hall roof
 *     c   cloister walkway
 *     ge  wide-building wing: a roof ridge crosses this edge (body floor)
 *     gi  wide-building interior: flat roof line along this edge (body floor)
 *     re  / ri  the same two at roof level
 *   faces (a solid side that needs room in front of it)
 *     wf  wall face            hf  hall face/facade   rf  hall roof eave
 *     cf  open side of a cloister
 *   ground
 *     o   open: garden, courtyard, air
 *     wa  water edge of a canal
 *     wx  bridge flank: must have water beside it
 *     bk  bridge end: must land on open ground
 *   t     tower side: towers stand in the open or terminate walls/cloisters
 *   tm    tower floor side: like t, and sky bridges can dock here
 *   tr    terrace side: a raised plateau whose top is ground for the cell above
 *   su/sl/sf  stairs: upper end (meets a terrace), lower end (open ground), flank
 *   sb    sky bridge end: docks at a tower floor / hall facade
 *   sm    joint of a 2-cell bridge;  sp/sq  joints of a 3-cell bridge (end/middle)
 *         (sm fits sm, sp only fits sq, so spans are 1-3 cells by construction)
 *
 * Vertical sockets carry a symmetry so oriented stacks (hall -> roof) line up:
 *   inv  same key under any rotation
 *   axis key depends on rotation % 2 (straight pieces)
 *   full key depends on rotation % 4 (end/corner pieces)
 */

export type HSocket = 'o' | 'wa' | 'wx' | 'bk' | 'wf' | 'hf' | 'rf' | 'cf' | 'w' | 'h' | 'hr' | 'c' | 't' | 'ge' | 'gi' | 're' | 'ri' | 'tm' | 'tr' | 'su' | 'sl' | 'sf' | 'sb' | 'sm' | 'sp' | 'sq';
export type VSym = 'inv' | 'axis' | 'full';
export interface VSocket {
  id: string;
  sym: VSym;
}
export type Level = 'ground' | 'upper';
export type Category = 'ground' | 'terrace' | 'garden' | 'wall' | 'tower' | 'hall' | 'block' | 'passage' | 'air';

export interface ModuleDef {
  id: string;
  name: string;
  category: Category;
  sides: [HSocket, HSocket, HSocket, HSocket];
  top: VSocket;
  bottom: VSocket;
  /** rotations to expand into variants (dedupe symmetric modules) */
  rotations: number[];
  weight: number;
  level: Level;
  /** procedural style variants (picked per cell by hash) */
  styles: number;
  /** modules sharing a group attract each other during collapse */
  group?: string;
  affinity?: number;
  /** sockets are rotation invariant, so the mesh can spin freely for variety */
  randomVisualRot?: boolean;
  /**
   * Soft size cap (in cells) for structures that can grow without bound: as
   * the connected group grows, tiles that would keep extending it lose weight.
   */
  softCap?: number;
  /** keep away from copies of itself (8-neighbourhood), e.g. landmark gardens */
  solitary?: boolean;
}

const v = (id: string, sym: VSym = 'inv'): VSocket => ({ id, sym });
const AIR = v('air');
const GROUND = v('ground');
const R1 = [0];
const R2 = [0, 1];
const R4 = [0, 1, 2, 3];
type Sides = ModuleDef['sides'];
const O4: Sides = ['o', 'o', 'o', 'o'];
const T4: Sides = ['t', 't', 't', 't'];
const TM4: Sides = ['tm', 'tm', 'tm', 'tm'];

type Extra = Partial<Pick<ModuleDef, 'group' | 'affinity' | 'randomVisualRot' | 'softCap' | 'solitary'>>;
function mod(id: string, name: string, category: Category, sides: Sides, bottom: VSocket, top: VSocket, rotations: number[], weight: number, styles = 1, extra: Extra = {}): ModuleDef {
  return { id, name, category, sides, bottom, top, rotations, weight, styles, level: bottom === GROUND ? 'ground' : 'upper', ...extra };
}
const SPIN = { randomVisualRot: true };
const LANDMARK = { randomVisualRot: true, solitary: true };

// hall footprints: straight, end, corner (L), T, cross. Each has a ground body,
// an upper floor, and a roof; the vertical key carries the footprint + rotation.
const HALL_SHAPES: [string, string, Sides, Sides, VSocket, number[], number][] = [
  ['', '', ['h', 'hf', 'h', 'hf'], ['hr', 'rf', 'hr', 'rf'], v('hall', 'axis'), R2, 1],
  ['End', 'End', ['h', 'hf', 'hf', 'hf'], ['hr', 'rf', 'rf', 'rf'], v('hallEnd', 'full'), R4, 0.3],
  ['Corner', 'Corner', ['h', 'h', 'hf', 'hf'], ['hr', 'hr', 'rf', 'rf'], v('hallL', 'full'), R4, 0.18],
  ['T', 'T', ['h', 'h', 'h', 'hf'], ['hr', 'hr', 'hr', 'rf'], v('hallT', 'full'), R4, 0.08],
  ['Cross', 'Crossing', ['h', 'h', 'h', 'h'], ['hr', 'hr', 'hr', 'hr'], v('hallX'), R1, 0.03],
];

const hallModules: ModuleDef[] = HALL_SHAPES.flatMap(([suffix, label, body, roof, key, rot, share]) => [
  mod(`hall${suffix}`, `Hall ${label}`.trim(), 'hall', body, GROUND, key, rot, 3.2 * share, suffix === '' ? 3 : 2),
  mod(`hall${suffix}Upper`, `Hall ${label} Floor`.replace('  ', ' '), 'hall', body, key, key, rot, 0.25, suffix === '' ? 4 : 3),
  mod(`hallRoof${suffix}`, suffix === 'End' ? 'Hall Gable' : `Hall Roof ${label}`.trim(), 'hall', roof, key, AIR, rot, 1, suffix === '' ? 3 : 2),
]);

// wide buildings: any rectilinear footprint, tiled like marching squares.
// Facades (hf/rf) face open ground; wings (ge/re) carry a pitched roof along
// the perimeter; interiors (gi/ri) get flat roofs (terraces, atriums, gardens).
export const BLOCK_SHAPES: [string, string, Sides, Sides, VSocket, number[], number][] = [
  ['In', 'Interior', ['gi', 'gi', 'gi', 'gi'], ['ri', 'ri', 'ri', 'ri'], v('blkIn'), R1, 0.7],
  // wings running through the interior split big blocks into several courts
  ['Wing', 'Inner Wing', ['ge', 'gi', 'ge', 'gi'], ['re', 'ri', 're', 'ri'], v('blkWing', 'axis'), R2, 0.45],
  ['WingT', 'Inner Wing T', ['ge', 'ge', 'ge', 'gi'], ['re', 're', 're', 'ri'], v('blkWingT', 'full'), R4, 0.12],
  ['Cross', 'Crossing', ['ge', 'ge', 'ge', 'ge'], ['re', 're', 're', 're'], v('blkCross'), R1, 0.06],
  ['Edge', 'Facade', ['ge', 'gi', 'ge', 'hf'], ['re', 'ri', 're', 'rf'], v('blkEdge', 'full'), R4, 1.2],
  ['Corner', 'Corner', ['hf', 'ge', 'ge', 'hf'], ['rf', 're', 're', 'rf'], v('blkCorner', 'full'), R4, 0.6],
  ['Inner', 'Inner Corner', ['ge', 'gi', 'gi', 'ge'], ['re', 'ri', 'ri', 're'], v('blkInner', 'full'), R4, 0.12],
  ['Strip', 'Narrow', ['ge', 'hf', 'ge', 'hf'], ['re', 'rf', 're', 'rf'], v('blkStrip', 'axis'), R2, 0.25],
  ['End', 'End', ['ge', 'hf', 'hf', 'hf'], ['re', 'rf', 'rf', 'rf'], v('blkEnd', 'full'), R4, 0.15],
  ['T', 'T', ['ge', 'ge', 'ge', 'hf'], ['re', 're', 're', 'rf'], v('blkT', 'full'), R4, 0.08],
];

const blockModules: ModuleDef[] = BLOCK_SHAPES.flatMap(([suffix, label, body, roof, key, rot, weight]) => [
  mod(`blk${suffix}`, `Wide ${label}`, 'block', body, GROUND, key, rot, weight * 1.8, 3, { group: 'blk', softCap: 70 }),
  mod(`blk${suffix}Upper`, `Wide ${label} Floor`, 'block', body, key, key, rot, 0.3, 4),
  mod(`blkRoof${suffix}`, `Wide ${label} Roof`, 'block', roof, key, AIR, rot, 1, suffix === 'In' ? 6 : 3),
]);

export const MODULES: ModuleDef[] = [
  mod('air', 'Air', 'air', O4, AIR, AIR, R1, 1),

  // ground layer
  mod('grass', 'Garden', 'ground', O4, GROUND, AIR, R1, 1.6, 5, { ...SPIN, group: 'grass', affinity: 0.6 }),
  mod('court', 'Courtyard', 'ground', O4, GROUND, AIR, R1, 0.9, 4, { ...SPIN, group: 'court', affinity: 1 }),
  mod('water', 'Canal', 'ground', ['wa', 'wa', 'wa', 'wa'], GROUND, AIR, R1, 0.9, 2, { ...SPIN, group: 'water', affinity: 3 }),

  // raised terraces: their top counts as ground, so anything can be built on them
  mod('terrace', 'Terrace', 'terrace', ['tr', 'tr', 'tr', 'tr'], GROUND, GROUND, R1, 0.9, 2, { group: 'terr', affinity: 2.5 }),
  mod('stairs', 'Grand Stairs', 'terrace', ['su', 'sf', 'sl', 'sf'], GROUND, AIR, R4, 0.5, 2),

  // special gardens
  mod('maze', 'Hedge Maze', 'garden', O4, GROUND, AIR, R1, 0.22, 2, LANDMARK),
  mod('greatTree', 'Great Tree', 'garden', O4, GROUND, AIR, R1, 0.22, 2, LANDMARK),
  mod('crystals', 'Crystal Grove', 'garden', O4, GROUND, AIR, R1, 0.14, 2, LANDMARK),
  mod('shrine', 'Owl Shrine', 'garden', O4, GROUND, AIR, R1, 0.14, 2, LANDMARK),
  mod('greenhouse', 'Greenhouse', 'garden', O4, GROUND, AIR, R1, 0.14, 2, LANDMARK),
  mod('well', 'Wishing Well', 'garden', O4, GROUND, AIR, R1, 0.16, 2, LANDMARK),
  mod('pond', 'Lily Pond', 'garden', O4, GROUND, AIR, R1, 0.16, 2, LANDMARK),
  mod('statues', 'Statue Avenue', 'garden', O4, GROUND, AIR, R2, 0.16, 2),

  // castle walls (ground level, crenellated)
  mod('wall', 'Wall', 'wall', ['w', 'wf', 'w', 'wf'], GROUND, AIR, R2, 4.5, 3),
  mod('wallGate', 'Rune Gate', 'wall', ['w', 'wf', 'w', 'wf'], GROUND, AIR, R2, 0.5),
  mod('wallGatehouse', 'Gatehouse', 'wall', ['w', 'wf', 'w', 'wf'], GROUND, AIR, R2, 0.25),
  mod('wallCorner', 'Wall Corner', 'wall', ['w', 'w', 'wf', 'wf'], GROUND, AIR, R4, 1.6, 2),
  mod('wallT', 'Wall T', 'wall', ['w', 'w', 'w', 'wf'], GROUND, AIR, R4, 0.45),
  mod('wallCross', 'Wall Cross', 'wall', ['w', 'w', 'w', 'w'], GROUND, AIR, R1, 0.15),
  mod('wallGallery', 'Wall Gallery', 'wall', ['w', 'wf', 'w', 'wf'], GROUND, AIR, R2, 0.6),
  mod('wallEnd', 'Wall Turret', 'wall', ['w', 'wf', 'wf', 'wf'], GROUND, AIR, R4, 0.5),

  // round towers: stack base -> mid* -> spire | crown
  mod('towerBase', 'Tower Base', 'tower', T4, GROUND, v('tower'), R1, 1.0, 2, SPIN),
  mod('towerMid', 'Tower Floor', 'tower', TM4, v('tower'), v('tower'), R1, 1.2, 3, SPIN),
  mod('towerRoof', 'Tower Spire', 'tower', T4, v('tower'), AIR, R1, 1, 2, SPIN),
  mod('towerCrown', 'Tower Crown', 'tower', T4, v('tower'), AIR, R1, 0.35, 2, SPIN),
  // square towers
  mod('sqTowerBase', 'Square Tower', 'tower', T4, GROUND, v('sqTower'), R1, 0.45, 2, SPIN),
  mod('sqTowerMid', 'Square Floor', 'tower', TM4, v('sqTower'), v('sqTower'), R1, 1, 2, SPIN),
  mod('sqTowerRoof', 'Square Spire', 'tower', T4, v('sqTower'), AIR, R1, 1, 2, SPIN),

  // great halls in every footprint
  ...hallModules,

  // chapels: same sockets as a hall end / straight hall, so they slot into any hall
  mod('hallChapel', 'Chapel End', 'hall', ['h', 'hf', 'hf', 'hf'], GROUND, v('hallEnd', 'full'), R4, 0.35, 2),
  mod('hallNave', 'Chapel Nave', 'hall', ['h', 'hf', 'h', 'hf'], GROUND, v('hall', 'axis'), R2, 0.7, 2),

  // wide buildings with depth
  ...blockModules,

  // bridges over canals and cloister walkways linking halls and towers
  // sky bridges: always docked at both ends, 1-3 cells long
  mod('skyBridge', 'Sky Bridge', 'passage', ['sb', 'o', 'sb', 'o'], AIR, AIR, R2, 0.3, 2),
  mod('skySpan', 'Sky Bridge Half', 'passage', ['sb', 'o', 'sm', 'o'], AIR, AIR, R4, 0.3, 2),
  mod('skyLongEnd', 'Sky Bridge Long End', 'passage', ['sb', 'o', 'sp', 'o'], AIR, AIR, R4, 0.3, 2),
  mod('skyMid', 'Sky Bridge Middle', 'passage', ['sq', 'o', 'sq', 'o'], AIR, AIR, R2, 0.3, 2),
  mod('canalBridge', 'Stone Bridge', 'passage', ['bk', 'wx', 'bk', 'wx'], GROUND, AIR, R2, 1.2, 1, { group: 'water', affinity: 3 }),
  mod('coveredBridge', 'Covered Bridge', 'passage', ['bk', 'wx', 'bk', 'wx'], GROUND, AIR, R2, 0.7, 1, { group: 'water', affinity: 3 }),
  mod('arcade', 'Cloister', 'passage', ['c', 'cf', 'c', 'cf'], GROUND, AIR, R2, 0.9, 2),
  mod('arcadeCorner', 'Cloister Corner', 'passage', ['c', 'c', 'cf', 'cf'], GROUND, AIR, R4, 0.4, 2),
  mod('arcadeT', 'Cloister T', 'passage', ['c', 'c', 'c', 'cf'], GROUND, AIR, R4, 0.15, 2),
  mod('arcadeEnd', 'Cloister Pavilion', 'passage', ['c', 'cf', 'cf', 'cf'], GROUND, AIR, R4, 0.2, 2),
];

export const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

// Symmetric fit table. Notable exclusions: towers never touch wall or hall
// faces, walls and halls never run alongside other structures, halls end in a
// Hall End (or meet a cloister), bridges need water beside and land ahead.
const COMPAT: Record<HSocket, HSocket[]> = {
  o: ['o', 'wa', 'bk', 'wf', 'hf', 'rf', 'cf', 't', 'tm', 'tr', 'sl', 'sf'],
  wa: ['o', 'wa', 'wx', 'wf', 'hf', 'cf', 't', 'tm', 'tr', 'sf'],
  wx: ['wa'],
  bk: ['o'],
  wf: ['o', 'wa'],
  hf: ['o', 'wa', 'c', 'sb'],
  rf: ['o'],
  cf: ['o', 'wa'],
  w: ['w', 't', 'tm'],
  h: ['h'],
  hr: ['hr'],
  c: ['c', 't', 'tm', 'hf'],
  t: ['o', 'wa', 'w', 'c', 't', 'tm', 'tr'],
  tm: ['o', 'wa', 'w', 'c', 't', 'tm', 'tr', 'sb'],
  ge: ['ge'],
  gi: ['gi'],
  re: ['re'],
  ri: ['ri'],
  tr: ['o', 'wa', 't', 'tm', 'tr', 'su', 'sf'],
  su: ['tr'],
  sl: ['o'],
  sf: ['o', 'wa', 'tr'],
  sb: ['tm', 'hf'],
  sm: ['sm'],
  sp: ['sq'],
  sq: ['sp'],
};
for (const [a, list] of Object.entries(COMPAT)) {
  for (const b of list) if (!COMPAT[b as HSocket].includes(a as HSocket)) throw new Error(`socket table not symmetric: ${a}-${b}`);
}

/** Sockets that carry a structure across the edge (and must be continued). */
export const JOIN_SOCKETS: ReadonlySet<HSocket> = new Set(['w', 'h', 'hr', 'c', 'ge', 'gi', 're', 'ri', 'su', 'sb', 'sm', 'sp', 'sq']);

export function socketsFit(a: HSocket, b: HSocket): boolean {
  return COMPAT[a].includes(b);
}

/** A socket that actually joins geometry (used to score build-mode suggestions). */
export function socketsConnect(a: HSocket, b: HSocket): boolean {
  return (JOIN_SOCKETS.has(a) || JOIN_SOCKETS.has(b)) && socketsFit(a, b);
}

export function vKey(s: VSocket, rot: number): string {
  if (s.sym === 'inv') return s.id;
  return `${s.id}:${s.sym === 'axis' ? rot % 2 : rot % 4}`;
}
