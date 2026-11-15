import * as THREE from 'three';
import { CELL_H, CELL_W } from './config';
import { Sfx } from './audio/sfx';
import { BuildMode } from './modes/build';
import { GenParams, Generator, Region, centeredRegion } from './modes/generate';
import { BroomFlight, FlightInput } from './modes/broom';
import { createSticks } from './ui/sticks';
import { CHUNK, InfiniteWorld } from './modes/infinite';
import { Museum } from './modes/museum';
import { Smoke, createSkyLanterns } from './render/atmosphere';
import { Stage, TimeOfDay } from './render/stage';
import { World } from './render/world';
import { Category, MODULES, ModuleDef } from './wfc/modules';
import { AIR_INDEX, VARIANTS } from './wfc/variants';

type Mode = 'build' | 'generate' | 'infinite' | 'museum';

// --- scene ---------------------------------------------------------------------------------------

const stage = new Stage(document.getElementById('scene') as HTMLCanvasElement);
const world = new World();
const sfx = new Sfx();
sfx.attach();
sfx.setCamera(stage.camera);
stage.scene.add(world.root);
const smoke = new Smoke();
const lanterns = createSkyLanterns();
stage.scene.add(smoke.points, lanterns.object);

const generator = new Generator(world, () => stage.now());
const infinite = new InfiniteWorld(world, () => stage.now());
const broom = new BroomFlight(stage, world);
stage.scene.add(broom.object, broom.trailObject);
const build = new BuildMode(stage, world);
const museum = new Museum(stage, world);

// --- catalogue: the design's six families over the solver's module categories ------------------

type FamilyId = 'grounds' | 'gardens' | 'walls' | 'towers' | 'halls' | 'bridges';
interface Family { id: FamilyId; label: string; short?: string; icon: string; cats: Category[] }
const FAMILIES: Family[] = [
  { id: 'grounds', label: 'Grounds', icon: 'i-grounds', cats: ['ground', 'terrace'] },
  { id: 'gardens', label: 'Gardens', icon: 'i-gardens', cats: ['garden'] },
  { id: 'walls', label: 'Walls', icon: 'i-walls', cats: ['wall'] },
  { id: 'towers', label: 'Towers', icon: 'i-towers', cats: ['tower'] },
  { id: 'halls', label: 'Halls', icon: 'i-halls', cats: ['hall', 'block'] },
  { id: 'bridges', label: 'Bridges & Cloisters', short: 'Bridges', icon: 'i-bridges', cats: ['passage'] },
];
const FAM = Object.fromEntries(FAMILIES.map((f) => [f.id, f])) as Record<FamilyId, Family>;
interface Tile { id: string; name: string; fam: FamilyId; module: ModuleDef; fits: number }
const TILES: Tile[] = FAMILIES.flatMap((f) =>
  MODULES.filter((m) => f.cats.includes(m.category)).map((m) => ({ id: m.id, name: m.name, fam: f.id, module: m, fits: m.rotations.length })),
);
const TILE = Object.fromEntries(TILES.map((t) => [t.id, t]));
const familyOf = (moduleId: string) => TILE[moduleId]?.fam;

// --- state ---------------------------------------------------------------------------------------

const SPEEDS = [1, 2, 3, 4, 5, 6, 10, 18, 32, 60];
const params: GenParams = { sx: 12, sz: 12, sy: 4, seed: 7, animate: true, speed: 6, borderOpen: true };
const S = {
  mode: 'generate' as Mode,
  time: 'dusk' as TimeOfDay,
  cat: 'towers' as FamilyId,
  query: '',
  selected: 'towerBase',
  auto: true,
  slot: 3,
  hotbar: ['grass', 'court', 'wall', 'towerBase', 'hall', 'sqTowerMid', 'canalBridge', 'greatTree', 'wallGate'],
  hover: null as { name: string; index: number; count: number } | null,
  speedLevel: 6,
  genKind: 'cast' as 'cast' | 'fill',
  worldOwner: 'none' as Mode | 'none',
  mus: { idx: 0, open: false, cat: 'all' as FamilyId | 'all', labels: true, turntable: false, touring: false },
  uiHidden: false,
};

// --- dom helpers ---------------------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const $$ = <T extends HTMLElement = HTMLElement>(s: string) => Array.from(document.querySelectorAll<T>(s));
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const body = document.body;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const icon = (id: string) => `<svg class="i" aria-hidden="true"><use href="#${id}"/></svg>`;
const setUse = (svg: Element, id: string) => svg.querySelector('use')!.setAttribute('href', '#' + id);
const input = (s: string) => $<HTMLInputElement>(s);

let toastTimer = 0;
function toast(msg: string) {
  $('#toastText').textContent = msg;
  $('#toast').classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('#toast').classList.remove('is-on'), 2600);
}
function flash(el: Element) {
  if (reduceMotion.matches) return;
  el.classList.remove('is-flash');
  void (el as HTMLElement).offsetWidth;
  el.classList.add('is-flash');
}
function spark(x: number, y: number, remove: boolean) {
  if (reduceMotion.matches) return;
  const el = document.createElement('span');
  el.className = 'spark' + (remove ? ' spark--remove' : '');
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-star4"/></svg>';
  $('#sparks').appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}
function sliderFill(el: HTMLInputElement) {
  const pct = ((+el.value - +el.min) / (+el.max - +el.min)) * 100 + '%';
  (el.closest('.slider') as HTMLElement | null ?? el).style.setProperty('--pct', pct);
}

// --- tabs / mode ---------------------------------------------------------------------------------

const MODE_META: Record<Mode, [string, string]> = {
  build: ['Chapter I', 'Build'],
  generate: ['Chapter II', 'Generate'],
  infinite: ['Chapter III', 'Infinite'],
  museum: ['Chapter IV', 'Museum'],
};
function moveIndicator(instant = false) {
  const tab = $(`.tab[data-mode="${S.mode}"]`);
  const ind = $('#tabInd');
  if (!tab) return;
  const inset = Math.min(18, tab.offsetWidth * 0.2);
  if (instant) ind.style.transition = 'none';
  ind.style.transform = `translateX(${tab.offsetLeft + inset}px) scaleX(${Math.max(1, tab.offsetWidth - inset * 2)})`;
  if (instant) {
    void ind.offsetWidth;
    ind.style.transition = '';
  }
}

function setMode(m: Mode, force = false) {
  if (m === S.mode && !force) return;
  const prev = S.mode;
  if (S.mus.touring) setTour(false);
  S.mode = m;
  body.dataset.mode = m;
  $$('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $$('.pane').forEach((p) => (p.hidden = p.dataset.pane !== m));
  $$('.bottom__part').forEach((p) => (p.hidden = p.dataset.for !== m));
  $('#bookChapter').textContent = `${MODE_META[m][0]} · ${MODE_META[m][1]}`;
  moveIndicator();

  build.setEnabled(m === 'build');
  $('#hint').textContent = '';
  if (prev === 'infinite' && m !== 'infinite') {
    setFlying(false);
    infinite.stop();
  }
  if (prev === 'museum' && m !== 'museum') museum.leave();

  if (m === 'build') {
    if (S.worldOwner === 'infinite' || S.worldOwner === 'museum') {
      generator.stop();
      world.clear();
      stage.controls.target.set(0, 0, 0);
    }
    S.worldOwner = world.cells.size ? S.worldOwner : 'build';
    renderRibbon();
  } else if (m === 'generate') {
    if (S.worldOwner !== 'generate' && S.worldOwner !== 'build') cast();
  } else if (m === 'infinite') {
    generator.stop();
    infinite.start(infinite.seed);
    stage.controls.target.set(0, 0, 0);
    S.worldOwner = 'infinite';
  } else if (m === 'museum') {
    generator.stop();
    if (exhibitIndex(S.mus.idx) < 0) S.mus.idx = TILES.indexOf(musList()[0]);
    layoutMuseum();
    // arrive on the overview: every exhibit of the family in view
    S.mus.open = false;
    renderMusList();
    renderExhibit(false);
    museum.overview(false, panelInset());
    museum.turntable = S.mus.turntable;
    S.worldOwner = 'museum';
  }
  renderStats();
}

// --- time of day ---------------------------------------------------------------------------------

const TIMES: TimeOfDay[] = ['day', 'dusk', 'night'];
function setTime(t: TimeOfDay, instant = false) {
  if (!instant && t !== S.time) sfx.timeOfDay(t);
  S.time = t;
  body.dataset.time = t;
  stage.setTime(t, instant);
  $$('.ibtn[data-time]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.time === t)));
}

// --- stat line -----------------------------------------------------------------------------------

const placedCount = () => {
  let n = 0;
  for (const c of world.cells.values()) if (c.v !== AIR_INDEX) n++;
  return n;
};
const ms = (v: number) => `${Math.max(1, Math.round(v))} ms`;
function renderStats() {
  const solve = generator.lastMs ? ` · last solve ${ms(generator.lastMs)}` : '';
  const line = {
    build: `${fmt(placedCount())} tiles placed · ${build.showSockets ? `${fmt(build.socketCount)} open sockets` : 'sockets hidden'}${solve}`,
    generate: `${fmt(params.sx * params.sz * params.sy)} cells · seed ${params.seed}${solve}`,
    infinite: `${fmt(infinite.awake)} chunks awake · seed ${infinite.seed}${infinite.lastMs ? ` · last solve ${ms(infinite.lastMs)}` : ''}`,
    museum: `${musList().length} ${S.mus.cat === 'all' ? `modules · ${FAMILIES.length} families` : FAM[S.mus.cat].label.toLowerCase()} · spacing ${museum.spacing}×`,
  }[S.mode];
  const el = $('#statline');
  if (el.textContent !== line) el.textContent = line;
}

// --- shared renderers ----------------------------------------------------------------------------

function chipsHTML(selected: string | null, withAll: boolean) {
  const all = withAll ? [`<button class="chip" data-cat="all" aria-pressed="${selected === 'all'}">${icon('i-all')}<span>All</span></button>`] : [];
  return all
    .concat(
      FAMILIES.map(
        (f) =>
          `<button class="chip" data-cat="${f.id}" style="--cat-c:var(--c-${f.id})" aria-pressed="${selected === f.id}" title="${f.label}">${icon(f.icon)}<span>${f.short ?? f.label}</span></button>`,
      ),
    )
    .join('');
}

// --- build ---------------------------------------------------------------------------------------

function renderCats() {
  $('#cats').innerHTML = chipsHTML(S.query ? null : S.cat, false);
}
function renderTiles() {
  const q = S.query.trim().toLowerCase();
  const list = q ? TILES.filter((t) => t.name.toLowerCase().includes(q) || FAM[t.fam].label.toLowerCase().includes(q)) : TILES.filter((t) => t.fam === S.cat);
  $('#tilesTitle').textContent = q ? `Results for “${S.query.trim()}”` : FAM[S.cat].label;
  $('#tilesHead').style.setProperty('--cat-c', q ? 'var(--text)' : `var(--c-${S.cat})`);
  $('#tilesCount').textContent = `${list.length} ${list.length === 1 ? 'tile' : 'tiles'}`;
  $('#tiles').innerHTML = list
    .map((t) => {
      const on = !S.auto && S.selected === t.id;
      return `<button class="row" data-id="${t.id}" style="--cat-c:var(--c-${t.fam})" aria-pressed="${on}">
        ${icon(FAM[t.fam].icon)}<span class="row__name">${t.name}</span><span class="row__meta">${t.fits} ${t.fits > 1 ? 'turns' : 'turn'}</span>
      </button>`;
    })
    .join('');
  const empty = list.length === 0;
  $('#tilesEmpty').hidden = !empty;
  $('#tiles').hidden = empty;
  $('#tilesHead').hidden = empty;
}
function renderHotbar() {
  $('#hotbar').innerHTML = S.hotbar
    .map((id, i) => {
      const t = TILE[id];
      return `<button class="slot" data-slot="${i}" style="--cat-c:var(--c-${t.fam})" aria-pressed="${!S.auto && S.slot === i}" aria-label="${i + 1}: ${t.name}" title="${t.name}">
        <span class="slot__key" aria-hidden="true">${i + 1}</span>${icon(FAM[t.fam].icon)}
      </button>`;
    })
    .join('');
}
function renderRibbon(doFlash = false) {
  const h = S.hover;
  if (S.auto) {
    setUse($('#ribbonIcon'), h ? FAM[familyOf(VARIANTS.find((v) => v.module.name === h.name)?.module.id ?? '') ?? 'grounds'].icon : 'i-sparkle');
    $('#ribbonName').textContent = h ? `Auto · ${h.name}` : 'Auto · any fitting tile';
  } else {
    const t = TILE[S.selected];
    setUse($('#ribbonIcon'), FAM[t.fam].icon);
    $('#ribbonName').textContent = t.name;
  }
  $('#ribbonFit').textContent = h ? `Fit ${h.index + 1} of ${h.count}` : 'Hover a face';
  if (doFlash) flash($('#ribbon'));
}
function renderBuild() {
  renderCats();
  renderTiles();
  renderHotbar();
  renderRibbon();
  input('#autoToggle').checked = S.auto;
}
function selectTile(id: string, opts: { syncCat?: boolean; reveal?: boolean } = {}) {
  const t = TILE[id];
  if (!t) return;
  S.selected = id;
  S.auto = false;
  const idx = S.hotbar.indexOf(id);
  if (idx >= 0) S.slot = idx;
  else S.hotbar[S.slot] = id;
  if (opts.syncCat && !S.query) S.cat = t.fam;
  build.select(id);
  renderBuild();
  renderRibbon(true);
  if (opts.reveal) $(`#tiles .row[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
}
function setAuto(on: boolean) {
  S.auto = on;
  build.select(on ? null : S.selected);
  renderBuild();
  renderRibbon(true);
}
function cycleFit() {
  const h = S.hover;
  if (!h) return toast('Hover a face of the grounds first');
  if (build.cycle(1)) sfx.cycle();
  else {
    sfx.denied();
    toast(`${h.name} only fits one way here`);
  }
}

/** Bounding region of the placed modules, padded so WFC has room to work. */
function fillRegion(): Region | null {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y1 = 0;
  for (const c of world.cells.values()) {
    if (c.v === AIR_INDEX) continue;
    x0 = Math.min(x0, c.x); x1 = Math.max(x1, c.x);
    z0 = Math.min(z0, c.z); z1 = Math.max(z1, c.z);
    y1 = Math.max(y1, c.y);
  }
  if (x0 === Infinity) return null;
  const pad = 3;
  return { x0: x0 - pad, z0: z0 - pad, sx: x1 - x0 + 1 + pad * 2, sz: z1 - z0 + 1 + pad * 2, sy: Math.max(params.sy, y1 + 2) };
}
function fill() {
  if (S.mode !== 'build' || generator.running) return;
  const region = fillRegion();
  if (!region) return toast('Place a few tiles first, then let WFC fill around them');
  S.genKind = 'fill';
  $<HTMLButtonElement>('#fillBtn').disabled = true;
  sfx.castStart();
  generator.run({ ...params, borderOpen: false }, region);
  if (!generator.running) genFinished();
}
function askClear() {
  const n = placedCount();
  if (!n) return toast('The grounds are already empty');
  $('#clearText').textContent = `This removes all ${fmt(n)} placed tiles. It can’t be undone.`;
  $<HTMLDialogElement>('#clearDlg').showModal();
}
$<HTMLDialogElement>('#clearDlg').addEventListener('close', () => {
  if ($<HTMLDialogElement>('#clearDlg').returnValue !== 'confirm') return;
  generator.stop();
  world.clear();
  renderStats();
  toast('The grounds are clear. Place a first stone.');
});

build.onState = (s) => {
  S.hover = s;
  renderRibbon();
};
build.onHint = (msg) => {
  if (S.mode === 'build') $('#hint').textContent = msg;
};
build.onPlace = (x, y, cell, v) => {
  spark(x, y, false);
  sfx.place(cell, v.module.category, v.module.group === 'water');
  S.worldOwner = 'build';
};
build.onRemove = (x, y, cell, count) => {
  spark(x, y, true);
  sfx.remove(cell, count);
};
build.onDenied = () => sfx.denied();
build.onHoverCell = (cell, ok) => sfx.hover(cell[1], ok);

// --- generate ------------------------------------------------------------------------------------

function renderGen() {
  const total = params.sx * params.sz * params.sy;
  input('#genWVal').value = String(params.sx);
  input('#genDVal').value = String(params.sz);
  input('#genFVal').value = String(params.sy);
  input('#genSpeedVal').value = String(S.speedLevel);
  $('#genSummary').textContent = `${fmt(total)} cells to collapse · ${params.sx} × ${params.sz} × ${params.sy}`;
  input('#genSpeed').disabled = input('#genSpeedVal').disabled = !params.animate;
  if (!generator.running) $('#genStatus').textContent = `Ready · ${fmt(total)} cells · seed ${params.seed}`;
  renderStats();
}
function cast() {
  generator.stop();
  infinite.stop();
  world.clear();
  S.genKind = 'cast';
  S.worldOwner = 'generate';
  const region = centeredRegion(params);
  const half = new THREE.Vector3((region.sx * CELL_W) / 2, 0, (region.sz * CELL_W) / 2);
  stage.frame(new THREE.Box3(half.clone().negate(), half.clone().setY(params.sy * CELL_H)));
  $<HTMLButtonElement>('#castBtn').disabled = true;
  $$<HTMLInputElement>('[data-pane="generate"] input, #randomSeed').forEach((el) => ((el as HTMLInputElement).disabled = true));
  sfx.castStart();
  generator.run(params, region);
  if (!generator.running) genFinished();
}
let lastGenStatus = '';
generator.onStatus = (msg) => {
  lastGenStatus = msg;
  if (msg.startsWith('Contradiction, retrying')) sfx.fizzle();
  if (msg.startsWith('Contradiction:') || msg.startsWith('Gave up') || msg.startsWith('Failed')) {
    toast(msg);
    genFinished(false);
  }
};
generator.onDone = () => genFinished();
generator.onReveal = (cells) => {
  const now = stage.now();
  sfx.cells(cells.map((c) => ({ x: c.x, y: c.y, z: c.z, cat: VARIANTS[c.v].module.category, delay: c.spawn - now })));
};
function genFinished(ok = true) {
  const kind = S.genKind;
  if (ok) sfx.castDone();
  else sfx.fail();
  if (kind === 'cast') {
    $<HTMLButtonElement>('#castBtn').disabled = false;
    $$<HTMLInputElement>('[data-pane="generate"] input, #randomSeed').forEach((el) => ((el as HTMLInputElement).disabled = false));
    renderGen();
    $('#castLabel').textContent = ok ? 'Cast again' : 'Cast generation';
    if (ok) {
      $('#genStatus').textContent = `Castle conjured · solved in ${ms(generator.lastMs)}`;
      toast(`Castle conjured from seed ${params.seed}`);
    } else $('#genStatus').textContent = lastGenStatus;
    setTimeout(() => {
      if (!generator.running) $('#genBar').style.transform = 'scaleX(0)';
    }, 2400);
  } else {
    $<HTMLButtonElement>('#fillBtn').disabled = false;
    if (ok) toast(`Filled ${fmt(generator.total)} cells in ${ms(generator.lastMs)}`);
  }
  renderStats();
}
function genProgress() {
  if (!generator.running || S.genKind !== 'cast') return;
  const p = generator.total ? Math.min(1, generator.done / generator.total) : 0;
  $('#genBar').style.transform = `scaleX(${p})`;
  $('#genBarWrap').setAttribute('aria-valuenow', String(Math.round(p * 100)));
  $('#genStatus').textContent = `Collapsing · ${fmt(generator.done)} / ${fmt(generator.total)}`;
  $('#castLabel').textContent = `Collapsing… ${Math.round(p * 100)}%`;
}

// --- infinite ------------------------------------------------------------------------------------

const chunksFor = (r: number) => {
  let n = 0;
  for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dz * dz <= r * r + 1) n++;
  return n;
};
function renderInf() {
  input('#infRadiusVal').value = String(infinite.radius);
  $('#infChunksHint').textContent = fmt(chunksFor(infinite.radius));
  renderStats();
}
function renderCoord() {
  const t = stage.controls.target;
  const cx = Math.floor((t.x / CELL_W + 0.5) / CHUNK);
  const cz = Math.floor((t.z / CELL_W + 0.5) / CHUNK);
  const txt = `Chunk ${cx}, ${cz}`;
  if ($('#coord').textContent !== txt) $('#coord').textContent = txt;
}
function newWorld() {
  if (S.mode !== 'infinite') return;
  const seed = 1 + Math.floor(Math.random() * 99999);
  infinite.start(seed);
  stage.controls.target.set(0, 0, 0);
  if (broom.active) broom.teleport(0, 0);
  renderInf();
  toast(`A new world unfolds · seed ${seed}`);
}

// broom flight (third person over the infinite grounds)
const INF_KEYS = $('#infKeys').innerHTML;
const INF_HELP = $('#infHelp').textContent!;
function setFlying(on: boolean) {
  if (on === broom.active) return;
  if (on) {
    if (S.mode !== 'infinite') return;
    broom.start();
    sfx.flight(true);
    const touch = body.classList.contains('is-touch');
    if (!touch) broom.lock();
    toast(touch ? 'Up you go · left stick flies, right stick looks' : 'Up you go · aim with the mouse, W to fly · Esc frees the mouse');
  } else {
    broom.stop();
    sfx.flight(false);
    sticks.reset();
    touchBoost = false;
    $('#stickBoost').classList.remove('is-active');
  }
  // immersion: the whole interface steps aside while flying (toasts still speak up)
  body.classList.toggle('is-flying', on);
  $('#hud').inert = on || S.uiHidden;
  debug?.focusFlight(on);
  $('#broomBtn').setAttribute('aria-pressed', String(on));
  $('#broomLabel').textContent = on ? 'Land the broom' : 'Fly on a broom';
  $('#infKeys').innerHTML = on ? '<kbd>Mouse</kbd>aim<kbd>W</kbd>fly<kbd>Shift</kbd>boost' : INF_KEYS;
  $('#infHelp').textContent = on
    ? 'Aim with the mouse: up climbs, down dives. W flies where you aim, Shift for a burst of speed, S brakes, A D slide sideways, Space / Q rise and sink. Esc frees the mouse, again to land.'
    : INF_HELP;
}
let unlockedAt = -1e9;
broom.onLock = (locked) => {
  if (locked) return;
  unlockedAt = performance.now();
  toast('Mouse freed · click the view to steer again, Esc to land');
};
const sticks = createSticks($('#sticks'));
broom.onBump = (s) => sfx.bump(s);
broom.onFlyby = (side, k) => sfx.flyby(side, k);
$('#stickLand').addEventListener('click', () => setFlying(false));
// touch boost: held down like Shift (pointer capture keeps it held if the thumb slides off)
let touchBoost = false;
{
  const btn = $('#stickBoost');
  const set = (on: boolean) => {
    touchBoost = on;
    btn.classList.toggle('is-active', on);
  };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    set(true);
    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety (thumb sliding off); boosting works without it */
    }
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) btn.addEventListener(ev, () => set(false));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
const flightInput = (): FlightInput => {
  const fwd = +(keys.has('w') || keys.has('arrowup')) - +(keys.has('s') || keys.has('arrowdown'));
  const side = +(keys.has('d') || keys.has('arrowright')) - +(keys.has('a') || keys.has('arrowleft'));
  const lift = +(keys.has(' ') || keys.has('e')) - +keys.has('q');
  // touch: the left stick flies (forward / strafe), the right stick looks
  const m = sticks.move, l = sticks.look;
  return {
    // holding Boost flies forward on its own, so one thumb boosts while the other looks
    forward: touchBoost ? 1 : THREE.MathUtils.clamp(fwd - m.y, -1, 1),
    strafe: THREE.MathUtils.clamp(side + m.x, -1, 1),
    lift,
    lookX: l.x,
    lookY: -l.y,
    boost: keys.has('shift') || touchBoost,
  };
};

// WASD panning (keyboard and the on-screen pad)
const keys = new Set<string>();
const pressKey = (dir: string, down: boolean) => $$(`.key[data-dir="${dir}"]`).forEach((k) => k.classList.toggle('is-down', down));
function pan(dt: number) {
  if (broom.active) return;
  const f = new THREE.Vector3();
  stage.camera.getWorldDirection(f);
  f.y = 0;
  f.normalize();
  const r = new THREE.Vector3(-f.z, 0, f.x);
  const move = new THREE.Vector3();
  if (keys.has('w')) move.add(f);
  if (keys.has('s')) move.sub(f);
  if (keys.has('d')) move.add(r);
  if (keys.has('a')) move.sub(r);
  if (!move.lengthSq()) return;
  const dist = stage.camera.position.distanceTo(stage.controls.target);
  move.normalize().multiplyScalar(dt * dist * 0.6);
  stage.controls.target.add(move);
  stage.camera.position.add(move);
}

// --- museum --------------------------------------------------------------------------------------

const musList = () => (S.mus.cat === 'all' ? TILES : TILES.filter((t) => t.fam === S.mus.cat));
/** Position of a tile among the exhibits on show (the filtered family), -1 if not shown. */
const exhibitIndex = (tileIdx: number) => musList().indexOf(TILES[tileIdx]);
const currentExhibit = () => museum.exhibits[exhibitIndex(S.mus.idx)];
function layoutMuseum() {
  museum.layout(musList().map((t) => t.module));
  buildTags();
}
function renderMusCats() {
  $('#musCats').innerHTML = chipsHTML(S.mus.cat, true);
}
function renderMusList() {
  const list = musList();
  $('#musTitle').textContent = S.mus.cat === 'all' ? 'All modules' : FAM[S.mus.cat].label;
  $('#musHead').style.setProperty('--cat-c', S.mus.cat === 'all' ? 'var(--text)' : `var(--c-${S.mus.cat})`);
  $('#musCount').textContent = `${list.length} ${list.length === 1 ? 'module' : 'modules'}`;
  $('#musList').innerHTML = list
    .map((t) => {
      const g = TILES.indexOf(t);
      return `<button class="row" data-idx="${g}" style="--cat-c:var(--c-${t.fam})" aria-pressed="${S.mus.open && g === S.mus.idx}">
        <span class="row__no">${String(g + 1).padStart(2, '0')}</span>${icon(FAM[t.fam].icon)}<span class="row__name">${t.name}</span>
      </button>`;
    })
    .join('');
}
function renderExhibit(swap: boolean) {
  const t = TILES[S.mus.idx];
  const list = musList();
  const open = S.mus.open;
  body.classList.toggle('mus-open', open);
  if (open) {
    setUse($('#musIcon'), FAM[t.fam].icon);
    $('#musName').textContent = t.name;
    const pos = list.indexOf(t);
    $('#musIndex').textContent = pos < 0 ? `Exhibit ${S.mus.idx + 1} of ${TILES.length}` : `Exhibit ${pos + 1} of ${list.length}`;
  } else {
    // overview: name the family on show
    setUse($('#musIcon'), S.mus.cat === 'all' ? 'i-all' : FAM[S.mus.cat].icon);
    $('#musName').textContent = S.mus.cat === 'all' ? 'All modules' : FAM[S.mus.cat].label;
    $('#musIndex').textContent = `${list.length} exhibits`;
  }
  $('#plaqueNo').textContent = `№ ${S.mus.idx + 1} · ${FAM[t.fam].label}`;
  $('#plaqueName').textContent = t.name;
  const cur = open ? exhibitIndex(S.mus.idx) : -1;
  $$('.tag').forEach((el, i) => el.classList.toggle('is-current', i === cur));
  if (swap && !reduceMotion.matches) {
    const pl = $('#plaque');
    pl.classList.remove('is-swap');
    void pl.offsetWidth;
    pl.classList.add('is-swap');
    flash($('.ribbon--mus'));
  }
}
function setExhibit(idx: number, reveal: boolean) {
  S.mus.idx = idx;
  S.mus.open = true;
  renderMusList();
  renderExhibit(true);
  if (S.mode === 'museum' && currentExhibit()) museum.focus(currentExhibit());
  if (reveal) $(`#musList .row[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
}
/** Screen width covered by the side panel (0 when hidden or collapsed into a sheet). */
function panelInset() {
  if (S.uiHidden || body.classList.contains('book-collapsed') || window.innerWidth < 900) return 0;
  return $('#book').getBoundingClientRect().right;
}
/** Deselect: back to the overview of every exhibit on show. */
function closeExhibit() {
  if (S.mus.touring) setTour(false);
  S.mus.open = false;
  renderMusList();
  renderExhibit(true);
  if (S.mode === 'museum') museum.overview(false, panelInset());
}
function stepExhibit(d: number) {
  const list = musList();
  let pos = S.mus.open ? list.indexOf(TILES[S.mus.idx]) : -1;
  if (pos < 0) pos = d > 0 ? -1 : 0;
  pos = (pos + d + list.length) % list.length;
  setExhibit(TILES.indexOf(list[pos]), true);
}
let tourTimer = 0;
function setTour(on: boolean) {
  S.mus.touring = on;
  clearInterval(tourTimer);
  if (on) {
    if (!S.mus.open) setExhibit(S.mus.idx, true);
    tourTimer = window.setInterval(() => stepExhibit(1), 2600);
  }
  $('#tourBtn').setAttribute('aria-pressed', String(on));
  $('#tourLabel').textContent = on ? 'Stop tour' : 'Start tour';
  $('#tourIcon').setAttribute('href', on ? '#i-pause' : '#i-play');
}
function buildTags() {
  const cur = S.mus.open ? exhibitIndex(S.mus.idx) : -1;
  $('#tags').innerHTML = musList()
    .map((t, i) => `<button class="tag${i === cur ? ' is-current' : ''}" data-i="${i}" tabindex="-1">${t.name}</button>`)
    .join('');
}
const tmpV = new THREE.Vector3();
function placeLabels() {
  if (S.mode !== 'museum' || !museum.exhibits.length) return;
  const w = window.innerWidth, h = window.innerHeight;
  const project = (i: number) => {
    museum.anchor(museum.exhibits[i], tmpV).project(stage.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * w, y: (-tmpV.y * 0.5 + 0.5) * h, visible: tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 };
  };
  if (S.mus.labels) {
    const camPos = stage.camera.position;
    const tags = $('#tags').children;
    // a single family's overview keeps every name readable (and clickable); the full
    // collection fades far tags out to avoid a wall of labels
    const reach = !S.mus.open && tags.length <= 30 ? 400 : 70;
    for (let i = 0; i < tags.length; i++) {
      const el = tags[i] as HTMLElement;
      const p = project(i);
      if (!p.visible) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }
      const dist = camPos.distanceTo(museum.anchor(museum.exhibits[i], tmpV));
      const o = Math.max(0, Math.min(0.9, 1.6 - dist / reach));
      el.style.opacity = String(o);
      el.style.pointerEvents = o > 0.25 ? '' : 'none';
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
  const cur = S.mus.open ? exhibitIndex(S.mus.idx) : -1;
  if (cur < 0) return;
  const p = project(cur);
  const plaque = $('#plaque');
  plaque.style.left = `${p.x.toFixed(1)}px`;
  plaque.style.top = `${p.y.toFixed(1)}px`;
}

// --- UI visibility -------------------------------------------------------------------------------

let pillTimer = 0;
function setUiHidden(hidden: boolean) {
  S.uiHidden = hidden;
  body.classList.toggle('ui-hidden', hidden);
  const hud = $('#hud');
  hud.inert = hidden || broom.active;
  hud.setAttribute('aria-hidden', String(hidden));
  const pill = $('#showUi');
  clearTimeout(pillTimer);
  if (hidden) {
    pill.classList.add('is-on');
    pillTimer = window.setTimeout(() => pill.classList.remove('is-on'), 2400);
    $('#toast').classList.remove('is-on');
  } else pill.classList.remove('is-on');
}

// --- events --------------------------------------------------------------------------------------

$$('.tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));
$$('.ibtn[data-time]').forEach((b) => b.addEventListener('click', () => setTime(b.dataset.time as TimeOfDay)));
$('#helpBtn').addEventListener('click', () => $<HTMLDialogElement>('#helpDlg').showModal());
$('#hideBtn').addEventListener('click', () => setUiHidden(true));
$('#showUi').addEventListener('click', () => setUiHidden(false));
$('#bookToggle').addEventListener('click', () => {
  const collapsed = body.classList.toggle('book-collapsed');
  $('#bookToggle').setAttribute('aria-expanded', String(!collapsed));
  $('#bookToggle').setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel');
});

// build
$('#cats').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.chip');
  if (!b) return;
  S.cat = b.dataset.cat as FamilyId;
  S.query = '';
  input('#tileSearch').value = '';
  renderCats();
  renderTiles();
  $('#tileScroll').scrollTop = 0;
});
$('#tiles').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (b) selectTile(b.dataset.id!);
});
$('#hotbar').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.slot');
  if (!b) return;
  S.slot = +b.dataset.slot!;
  selectTile(S.hotbar[S.slot], { syncCat: true, reveal: true });
});
input('#tileSearch').addEventListener('input', (e) => {
  S.query = (e.target as HTMLInputElement).value;
  renderCats();
  renderTiles();
});
$('#clearSearch').addEventListener('click', () => {
  S.query = '';
  input('#tileSearch').value = '';
  renderCats();
  renderTiles();
  input('#tileSearch').focus();
});
input('#autoToggle').addEventListener('change', (e) => setAuto((e.target as HTMLInputElement).checked));
input('#socketsToggle').addEventListener('change', (e) => {
  build.showSockets = (e.target as HTMLInputElement).checked;
  renderStats();
});
$('#fillBtn').addEventListener('click', fill);
$('#clearBtn').addEventListener('click', askClear);

// generate
const bindGen = (sel: string, apply: (v: number) => void) => {
  const el = input(sel);
  sliderFill(el);
  el.addEventListener('input', () => {
    apply(+el.value);
    sliderFill(el);
    renderGen();
  });
};
bindGen('#genW', (v) => (params.sx = v));
bindGen('#genD', (v) => (params.sz = v));
bindGen('#genF', (v) => (params.sy = v));
bindGen('#genSpeed', (v) => {
  S.speedLevel = v;
  params.speed = SPEEDS[v - 1];
});
input('#genSeed').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  const v = Math.max(0, Math.floor(+el.value || 0));
  el.value = String(v);
  params.seed = v;
  renderGen();
});
$('#randomSeed').addEventListener('click', () => {
  params.seed = 1 + Math.floor(Math.random() * 99999);
  input('#genSeed').value = String(params.seed);
  renderGen();
  cast();
});
input('#genWatch').addEventListener('change', (e) => {
  params.animate = (e.target as HTMLInputElement).checked;
  renderGen();
});
input('#genClosed').addEventListener('change', (e) => {
  params.borderOpen = (e.target as HTMLInputElement).checked;
  toast(params.borderOpen ? 'An outer wall will ring the grounds' : 'The grounds will run open to the edge');
});
$('#castBtn').addEventListener('click', cast);

// infinite
const radius = input('#infRadius');
sliderFill(radius);
radius.addEventListener('input', () => {
  infinite.radius = +radius.value;
  sliderFill(radius);
  renderInf();
});
$('#newWorldBtn').addEventListener('click', newWorld);
$('#broomBtn').addEventListener('click', () => setFlying(!broom.active));

// --- sound ---------------------------------------------------------------------------------------

function renderSound(on: boolean) {
  const btn = $('#soundBtn');
  btn.setAttribute('aria-pressed', String(!on));
  btn.setAttribute('aria-label', on ? 'Mute sound' : 'Turn sound on');
  btn.title = on ? 'Mute sound (N)' : 'Turn sound on (N)';
  btn.querySelector('use')!.setAttribute('href', on ? '#i-sound' : '#i-sound-off');
}
sfx.onToggle = (on) => {
  renderSound(on);
  toast(on ? 'Sound on' : 'Sound off');
};
renderSound(sfx.enabled);
$('#soundBtn').addEventListener('click', () => sfx.setEnabled(!sfx.enabled));
// a soft tick for every button, tab and tile in the interface
document.addEventListener('click', (e) => {
  const el = (e.target as Element).closest?.('button, [role="button"], .row, .chip, summary');
  if (!el || (el as HTMLButtonElement).disabled || el.id === 'stickBoost') return;
  sfx.ui(el.classList.contains('tab') ? 'tab' : el.matches('[aria-pressed], .chip') ? 'toggle' : 'button');
});
$$('.key').forEach((k) => {
  const dir = k.dataset.dir!;
  const up = () => {
    keys.delete(dir);
    pressKey(dir, false);
  };
  k.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    keys.add(dir);
    pressKey(dir, true);
    k.setPointerCapture(e.pointerId);
  });
  k.addEventListener('pointerup', up);
  k.addEventListener('pointercancel', up);
});

// museum
$('#musCats').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.chip');
  if (!b) return;
  S.mus.cat = b.dataset.cat as FamilyId | 'all';
  renderMusCats();
  $('#musScroll').scrollTop = 0;
  if (!musList().includes(TILES[S.mus.idx])) S.mus.idx = TILES.indexOf(musList()[0]);
  // the 3D follows the filter: only this family stays on show, framed as a whole
  if (S.mode === 'museum') layoutMuseum();
  closeExhibit();
});
$('#musClose').addEventListener('click', closeExhibit);
$('#plaqueClose').addEventListener('click', closeExhibit);
$('#tags').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.tag');
  if (b) setExhibit(TILES.indexOf(musList()[+b.dataset.i!]), true);
});
// click an exhibit in the 3D to visit it (a drag still orbits)
{
  const el = stage.renderer.domElement;
  let down: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', (e) => (down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null));
  el.addEventListener('pointerup', (e) => {
    if (S.mode !== 'museum' || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const r = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, stage.camera);
    const i = museum.pick(ray.ray);
    if (i >= 0 && !(S.mus.open && i === exhibitIndex(S.mus.idx))) setExhibit(TILES.indexOf(musList()[i]), true);
  });
}
$('#musList').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.row');
  if (b) setExhibit(+b.dataset.idx!, false);
});
$('#musPrev').addEventListener('click', () => stepExhibit(-1));
$('#musNext').addEventListener('click', () => stepExhibit(1));
$('#tourBtn').addEventListener('click', () => setTour(!S.mus.touring));
input('#musLabels').addEventListener('change', (e) => {
  S.mus.labels = (e.target as HTMLInputElement).checked;
  body.classList.toggle('labels-on', S.mus.labels);
});
input('#musTurn').addEventListener('change', (e) => {
  S.mus.turntable = (e.target as HTMLInputElement).checked;
  museum.turntable = S.mus.turntable;
});
const spacing = input('#musSpacing');
sliderFill(spacing);
spacing.addEventListener('input', () => {
  museum.spacing = +spacing.value;
  sliderFill(spacing);
  input('#musSpacingVal').value = spacing.value;
  if (S.mode === 'museum') {
    layoutMuseum();
    if (S.mus.open) museum.focus(currentExhibit());
    else museum.overview(false, panelInset());
  }
  renderStats();
});

// typed slider values
$$<HTMLInputElement>('.slider__num').forEach((num) => {
  const range = document.getElementById(num.dataset.for!) as HTMLInputElement;
  num.addEventListener('change', () => {
    const min = +range.min, max = +range.max, step = +range.step || 1;
    let v = Number(num.value);
    if (!Number.isFinite(v)) v = +range.value;
    v = Math.min(max, Math.max(min, Math.round(v / step) * step));
    num.value = String(v);
    range.value = String(v);
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
  num.addEventListener('focus', () => num.select());
});

// keyboard
const DIRS = new Set(['w', 'a', 's', 'd']);
const FLIGHT_KEYS = new Set([...DIRS, ' ', 'shift', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  const isInput = t instanceof HTMLInputElement;
  const typing = isInput && !['range', 'checkbox'].includes((t as HTMLInputElement).type);
  if (typing) {
    if (e.key === 'Escape') (t as HTMLInputElement).blur();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === '?') {
    e.preventDefault();
    $<HTMLDialogElement>('#helpDlg').showModal();
    return;
  }
  const k = e.key.toLowerCase();
  if (broom.active) {
    if (k === 'escape') {
      // the first Esc only frees the mouse (the browser may also hand us that keypress)
      if (broom.locked) return document.exitPointerLock();
      if (performance.now() - unlockedAt < 250) return;
      return setFlying(false);
    }
    if (k === 'f') return setFlying(false);
    if (FLIGHT_KEYS.has(k)) {
      e.preventDefault();
      keys.add(k);
      if (DIRS.has(k) && !e.repeat) pressKey(k, true);
      return;
    }
  } else if (k === 'f' && S.mode === 'infinite') return setFlying(true);
  if (DIRS.has(k) && (S.mode === 'infinite' || S.mode === 'build' || S.mode === 'generate')) {
    keys.add(k);
    if (!e.repeat) pressKey(k, true);
    return;
  }
  if (k === 'h') return setUiHidden(!S.uiHidden);
  if (k === 'n') return sfx.setEnabled(!sfx.enabled);
  if (k === 'b') return setMode('build');
  if (k === 'g') return setMode('generate');
  if (k === 'i') return setMode('infinite');
  if (k === 'm') return setMode('museum');
  if (k === 't') return setTime(TIMES[(TIMES.indexOf(S.time) + 1) % TIMES.length]);
  const onControl = t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement || isInput;

  if (S.mode === 'build') {
    if (/^[1-9]$/.test(k)) {
      S.slot = +k - 1;
      selectTile(S.hotbar[S.slot], { syncCat: true, reveal: true });
      return;
    }
    if (k === 'r') return cycleFit();
    if (k === 'f') return fill();
    if (k === '/') {
      e.preventDefault();
      if (S.uiHidden) setUiHidden(false);
      body.classList.remove('book-collapsed');
      input('#tileSearch').focus();
      return;
    }
  }
  if (S.mode === 'generate' && e.key === 'Enter' && !onControl) {
    e.preventDefault();
    if (!generator.running) cast();
    return;
  }
  if (S.mode === 'museum') {
    const onRange = isInput && (t as HTMLInputElement).type === 'range';
    if (e.key === 'ArrowRight' && !onRange) {
      e.preventDefault();
      stepExhibit(1);
    } else if (e.key === 'ArrowLeft' && !onRange) {
      e.preventDefault();
      stepExhibit(-1);
    } else if (e.key === ' ' && !onControl) {
      e.preventDefault();
      setTour(!S.mus.touring);
    } else if (e.key === 'Escape' && S.mus.open) {
      closeExhibit();
    }
  }
});
document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys.delete(k);
  if (DIRS.has(k)) pressKey(k, false);
});
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', () => moveIndicator(true));

// --- boot + loop ---------------------------------------------------------------------------------

let debug: ReturnType<typeof import('./debug').createDebugPane> | null = null;

async function boot() {
  try {
    await stage.init();
  } catch (err) {
    console.error(err);
    $('#veilText').textContent = 'This browser cannot start WebGPU or WebGL 2.';
    return;
  }
  if (new URLSearchParams(location.search).has('debug')) (window as any).debug = debug = (await import('./debug')).createDebugPane(stage);
  setTime('dusk', true);
  renderBuild();
  build.select(S.auto ? null : S.selected);
  renderGen();
  renderInf();
  renderMusCats();
  renderMusList();
  renderExhibit(false);
  input('#musSpacingVal').value = String(museum.spacing);
  // warm every piece behind the veil: no first-appearance stalls in generate or infinite
  await world.warmUp(stage.controls.target, () => {
    stage.update();
    stage.warmOutputs();
  }, (k) => ($('#veilText').textContent = `Summoning the castle… ${Math.round(k * 100)}%`));
  setMode('generate', true);
  moveIndicator(true);
  document.fonts?.ready.then(() => moveIndicator(true));

  let statT = 0;
  let rushShown = 0;
  let boostShown = 0;
  let windowT = 1;
  let lastSpots: Float32Array | null = null;
  let lastEpoch = world.epoch;
  stage.renderer.setAnimationLoop(() => {
    const t0 = performance.now();
    const dt = stage.update();
    pan(dt);
    broom.update(dt, flightInput());
    museum.update(dt);
    generator.update();
    sfx.update(dt, {
      generating: generator.running,
      progress: generator.total ? generator.done / generator.total : 1,
      flight: broom.active ? { speed: broom.speed, boost: broom.boostLevel, boosting: broom.boosting, bank: broom.bank } : null,
    });
    infinite.update(stage.controls.target);
    build.update(stage.now());
    world.flush();
    smoke.setSources(world.smokeSources());
    windowT += dt;
    // a brand-new castle: the old window light goes at once (the new one fades in as it rises)
    if (world.epoch !== lastEpoch) {
      lastEpoch = world.epoch;
      windowT = 1;
    }
    if (windowT > 0.3 && stage.lampLevel > 0.01 && stage.fx.windowLight) {
      // window spots change with the castle; throttled while chunks stream in
      windowT = 0;
      const spots = world.windowSpots(stage.now());
      if (spots !== lastSpots) stage.windowPools.setSpots((lastSpots = spots));
    }
    if (stage.fx.windowLight) stage.windowPools.update(stage.renderer, stage.controls.target, stage.now());
    lanterns.center.value.copy(stage.controls.target);
    world.cull(stage.camera, stage.viewDistance, stage.shadowDir);
    stage.render();
    genProgress();
    placeLabels();
    if (S.mode === 'infinite') renderCoord();
    if (broom.active || rushShown > 0) {
      const r = broom.rushLevel;
      if (Math.abs(r - rushShown) > 0.01 || (r === 0 && rushShown > 0)) body.style.setProperty('--rush', (rushShown = r).toFixed(3));
      const b = broom.boostLevel;
      if (Math.abs(b - boostShown) > 0.01 || (b === 0 && boostShown > 0)) body.style.setProperty('--boost', (boostShown = b).toFixed(3));
    }
    debug?.frame(dt, performance.now() - t0);
    statT += dt;
    if (statT > 0.25) {
      statT = 0;
      renderStats();
    }
  });
  requestAnimationFrame(() => $('#veil').classList.add('is-off'));
  console.info(`[magic-school] rendering with ${stage.backend}`);
}
boot();

// handy for debugging from the console / screenshots
Object.assign(window, { stage, world, generator, infinite, build, museum, broom, sfx, setMode, setTime, cast, params, VARIANTS });
