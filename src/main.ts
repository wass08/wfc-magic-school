import { Stage, TimeOfDay } from './render/stage';
import { World } from './render/world';
import { BuildMode } from './modes/build';
import { GenParams, Generator, Region, centeredRegion } from './modes/generate';
import { InfiniteWorld } from './modes/infinite';
import { MODULES, Category } from './wfc/modules';
import { AIR_INDEX, VARIANTS } from './wfc/variants';
import { CELL_H, CELL_W } from './config';
import * as THREE from 'three';
import { Smoke, createSkyLanterns } from './render/atmosphere';

type Mode = 'build' | 'generate' | 'infinite';

const stage = new Stage(document.getElementById('scene') as HTMLCanvasElement);
const world = new World();
stage.scene.add(world.root);
const smoke = new Smoke();
const skyLanterns = createSkyLanterns();
stage.scene.add(smoke.points, skyLanterns);

const generator = new Generator(world, () => stage.now());
const infinite = new InfiniteWorld(world, () => stage.now());
const build = new BuildMode(stage, world);

const params: GenParams = { sx: 12, sz: 12, sy: 4, seed: 7, animate: true, speed: 6, borderOpen: true };
let mode: Mode = 'generate';

// --- UI ------------------------------------------------------------------------

const ui = document.getElementById('ui')!;
ui.innerHTML = /* html */ `
  <div class="panel">
    <header>
      <h1>Arcanum</h1>
      <p>a wave-function-collapse school of magic</p>
    </header>
    <nav class="tabs">
      <button data-mode="build">Build</button>
      <button data-mode="generate">Generate</button>
      <button data-mode="infinite">Infinite</button>
    </nav>

    <section data-section="generate">
      <label>Width <output id="o-sx"></output><input id="sx" type="range" min="3" max="32" /></label>
      <label>Depth <output id="o-sz"></output><input id="sz" type="range" min="3" max="32" /></label>
      <label>Floors <output id="o-sy"></output><input id="sy" type="range" min="2" max="7" /></label>
      <label class="row">Seed <input id="seed" type="number" /><button id="dice" title="Random seed">Random</button></label>
      <label class="check"><input id="animate" type="checkbox" /> Watch it collapse</label>
      <label>Speed <output id="o-speed"></output><input id="speed" type="range" min="1" max="60" /></label>
      <label class="check"><input id="border" type="checkbox" /> Closed border</label>
      <button class="primary" id="generate">Generate</button>
    </section>

    <section data-section="build">
      <div class="palette" id="palette"></div>
      <label class="check"><input id="sockets" type="checkbox" checked /> Show open sockets</label>
      <div class="row">
        <button id="fill" title="Run WFC around your modules, keeping them as constraints">Fill with WFC</button>
        <button id="clear">Clear</button>
      </div>
      <p class="help">Click a face to place · R cycles fits · Right-click or Shift-click removes · Right-drag pans</p>
    </section>

    <section data-section="infinite">
      <p class="help">Drag with the right mouse button (or WASD) to wander. Chunks are solved as you go, each one constrained by its neighbours.</p>
      <label>View radius <output id="o-radius"></output><input id="radius" type="range" min="1" max="6" /></label>
      <button class="primary" id="restart-inf">New world</button>
    </section>

    <footer>
      <div class="tabs small" id="tod">
        <button data-tod="day">Day</button>
        <button data-tod="dusk">Dusk</button>
        <button data-tod="night">Night</button>
      </div>
      <div class="status" id="status"></div>
    </footer>
  </div>
  <div class="hint" id="hint"></div>
`;

const $ = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const status = (msg: string) => ($<HTMLDivElement>('status').textContent = msg);
generator.onStatus = status;
infinite.onStatus = status;
build.onHint = (msg) => ($<HTMLDivElement>('hint').textContent = msg);

function bindRange(id: 'sx' | 'sz' | 'sy' | 'speed') {
  const el = $(id);
  const out = $<HTMLOutputElement>(`o-${id}`);
  el.value = String(params[id]);
  out.textContent = el.value;
  el.addEventListener('input', () => {
    params[id] = +el.value;
    out.textContent = el.value;
  });
}
(['sx', 'sz', 'sy', 'speed'] as const).forEach(bindRange);
$('seed').value = String(params.seed);
$('seed').addEventListener('change', () => (params.seed = +$('seed').value | 0));
$('dice').addEventListener('click', (e) => {
  e.preventDefault();
  params.seed = Math.floor(Math.random() * 99999);
  $('seed').value = String(params.seed);
  regenerate();
});
$('animate').checked = params.animate;
$('animate').addEventListener('change', () => (params.animate = $('animate').checked));
$('border').checked = params.borderOpen;
$('border').addEventListener('change', () => (params.borderOpen = $('border').checked));
$('generate').addEventListener('click', regenerate);

$('radius').value = String(infinite.radius);
$<HTMLOutputElement>('o-radius').textContent = String(infinite.radius);
$('radius').addEventListener('input', () => {
  infinite.radius = +$('radius').value;
  $<HTMLOutputElement>('o-radius').textContent = $('radius').value;
});
$('restart-inf').addEventListener('click', () => infinite.start(Math.floor(Math.random() * 99999)));

// palette
const palette = $<HTMLDivElement>('palette');
const CATS: [Category, string][] = [['ground', 'Grounds'], ['terrace', 'Terraces & Stairs'], ['garden', 'Gardens'], ['wall', 'Walls'], ['tower', 'Towers'], ['hall', 'Halls'], ['block', 'Wide Halls'], ['passage', 'Bridges & Cloisters']];
palette.innerHTML =
  `<button class="mod active" data-mod="">✦ Auto (any fit)</button>` +
  CATS.map(([cat, label]) => `<h3>${label}</h3><div class="mods">${MODULES.filter((m) => m.category === cat).map((m) => `<button class="mod" data-mod="${m.id}">${m.name}</button>`).join('')}</div>`).join('');
palette.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button.mod') as HTMLButtonElement | null;
  if (!btn) return;
  palette.querySelectorAll('.mod').forEach((b) => b.classList.toggle('active', b === btn));
  build.select(btn.dataset.mod || null);
});
$('sockets').addEventListener('change', () => (build.showSockets = $('sockets').checked));
$('clear').addEventListener('click', () => {
  generator.stop();
  world.clear();
});
$('fill').addEventListener('click', () => {
  const region = fillRegion();
  if (!region) return status('Place a few modules first.');
  generator.run({ ...params, borderOpen: false }, region);
});

document.querySelectorAll<HTMLButtonElement>('nav.tabs button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode as Mode)));
document.querySelectorAll<HTMLButtonElement>('#tod button').forEach((b) =>
  b.addEventListener('click', () => {
    stage.setTime(b.dataset.tod as TimeOfDay);
    document.querySelectorAll('#tod button').forEach((x) => x.classList.toggle('active', x === b));
  }),
);
document.querySelector('#tod button[data-tod="dusk"]')!.classList.add('active');

// --- modes -----------------------------------------------------------------------

function setMode(m: Mode) {
  const prev = mode;
  mode = m;
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', (b as HTMLElement).dataset.mode === m));
  document.querySelectorAll<HTMLElement>('section[data-section]').forEach((s) => (s.hidden = s.dataset.section !== m));
  build.setEnabled(m === 'build');
  $<HTMLDivElement>('hint').textContent = m === 'build' ? 'Hover the ground or a module face' : '';
  if (m === 'infinite') {
    generator.stop();
    infinite.start(params.seed);
    stage.controls.target.set(0, 0, 0);
  } else if (prev === 'infinite') {
    infinite.stop();
  }
  if (m === 'build' && prev === 'infinite') world.clear();
}

function regenerate() {
  generator.stop();
  world.clear();
  const region = centeredRegion(params);
  generator.run(params, region);
  const half = new THREE.Vector3((region.sx * CELL_W) / 2, 0, (region.sz * CELL_W) / 2);
  stage.frame(new THREE.Box3(half.clone().negate(), half.clone().setY(params.sy * CELL_H)));
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

// WASD panning (handy in infinite mode)
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName !== 'INPUT') keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
function pan(dt: number) {
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

// --- loop ------------------------------------------------------------------------

setMode('generate');
regenerate();

function frame() {
  const dt = stage.update();
  pan(dt);
  generator.update();
  infinite.update(stage.controls.target);
  build.update(stage.now());
  world.flush();
  smoke.setSources(world.smokeSources());
  skyLanterns.material.uniforms.uCenter.value.copy(stage.controls.target);
  stage.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy for debugging from the console / screenshots
Object.assign(window, { stage, world, generator, infinite, build, setMode, regenerate, params, VARIANTS });
