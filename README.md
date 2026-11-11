# Arcanum: a WFC magic school

Three.js + TypeScript + Vite. Every module is generated procedurally; there are no assets.

```bash
npm install
npm run dev
```

## Modes

- **Build**: hover the ground or any module face and click to place. The palette restricts which module goes in; **Auto** picks the best socket fit. `R` cycles the variants that fit. Right-click or Shift-click removes a module. Glowing markers show open sockets. **Fill with WFC** solves the area around your modules and keeps them as fixed constraints.
- **Generate**: WFC over a W×D×floors grid. You can watch it collapse cell by cell or solve it instantly. **Closed border** forces open sockets on the grid edge.
- **Infinite**: 8×8×5 chunks are solved around the camera. Each chunk is constrained by the cells its neighbours already decided, so the seams match. Pan with right-drag or WASD.

## Layout

| Path | What |
| --- | --- |
| `src/wfc/modules.ts` | Module catalogue: sockets, weights, level, style count. Pure data. |
| `src/wfc/variants.ts` | Expands rotations into variants and precomputes adjacency bitsets. |
| `src/wfc/solver.ts` | Bitset WFC: weighted entropy, bottom-up collapse, affinity, fixed and external constraints. |
| `src/wfc/fit.ts` | Build-mode candidate search and scoring. |
| `src/geo/builder.ts` | `GeoBuilder`: merges transformed primitives into one geometry with custom attributes. |
| `src/geo/parts.ts` | Reusable parts: gothic windows, merlons, gable and cone roofs, banners, lanterns, ivy, trees… |
| `src/geo/registry.ts` | Module id → builder registry and the per-(module, style) geometry cache. |
| `src/geo/modules.ts` | Core builders (grounds, walls, round towers, straight halls) plus shared helpers and decor. Each module has N styles. |
| `src/geo/extra.ts` | Hall junctions, square towers, gatehouse, bridges, cloisters, special gardens. |
| `src/geo/blocks.ts` | Wide-hall footprint tiles (bodies, wings, flat-roof furniture). |
| `src/geo/terraces.ts` | Terraces, stairs, waterfalls, sky bridges, wall galleries, chapels, new gardens. |
| `src/render/atmosphere.ts` | Chimney smoke (from emitters registered by builders) and floating sky lanterns, both animated in shaders. |
| `src/render/materials.ts` | Castle shader: procedural brick, slate, wood and glass patterns, emissive flicker, banner and foliage sway, spawn pop-in. Also the water shader. |
| `src/render/world.ts` | Sparse cell store + one `InstancedMesh` per (module, style). |
| `src/render/stage.ts` | Renderer, lights, sky, fog, bloom, fireflies, day/dusk/night presets. |
| `src/modes/*` | Build / generate / infinite controllers and the voxel DDA picker. |

## Modules (82)

| Family | Modules |
| --- | --- |
| Grounds | Garden (5 styles), Courtyard (fountain, armillary, lamps), Canal |
| Terraces & Stairs | Terrace: a raised plateau whose top counts as ground, so gardens, canals, towers and halls can all sit on it. Grand Stairs climb onto it. Retaining walls, balustrades and waterfalls (a raised canal pouring off the edge) are added automatically |
| Gardens | Hedge Maze, Great Tree (green / wisteria), Crystal Grove, Owl Shrine (floating candles), Greenhouse, Wishing Well (water / magic), Lily Pond (stepping stones / stone lantern), Statue Avenue |
| Walls | Wall, Rune Gate, Gatehouse, Wall Gallery (timber walkway on the wall top), Corner, T, Cross, Turret end |
| Towers | Round: base, floor, spire, crown. Square: base, floor, spire |
| Halls | Chapel End (rose window, portal), Chapel Nave (flying buttresses, tall stained glass). Straight, End, Corner (L), T and Crossing footprints, each with a ground body, an upper floor and a matching roof (valleys, timber gables, flèche on crossings) |
| Wide Halls | Buildings of any rectilinear footprint, tiled like marching squares: interior, facade, corner, inner corner, narrow, end, T, plus inner wings (straight / T / crossing) that split big blocks into courts. Each tile has a body, an upper floor and a roof: pitched wings around the perimeter, flat roofs in the middle (terrace, purple glass atrium, roof garden, chimneys…) |
| Bridges & Cloisters | Sky Bridge (floating covered gallery on a corbelled deck, 1–3 cells, always docked at both ends to tower floors or hall facades), stone humpback bridge, covered timber bridge, Cloister straight / corner / T / pavilion end (stone or timber) |

## Sockets

Horizontal sockets (side order `+X, -Z, -X, +Z`):

- **Joins** (must continue): `w` wall, `h` hall body, `hr` hall roof, `c` cloister.
- **Faces**: `wf` wall face, `hf` hall face/facade, `rf` roof eave, `cf` open cloister side. Faces only accept open ground or water, so halls never stand side by side and towers never touch a wall or hall face. The one exception: a cloister may arrive at a hall facade, which is how halls get linked.
- **Ground**: `o` open ground or air, `wa` canal edge, `wx` bridge flank (needs water beside it), `bk` bridge end (needs open ground).
- `t` tower: fits open ground, water, wall ends, cloister ends and other towers.
- **Terraces & upper levels**: `tr` terrace side, `su` / `sl` / `sf` stair upper end / lower end / flank, `tm` tower floor (sky bridges dock here), `sb` sky bridge end (docks only at `tm` / `hf`), `sm` 2-cell joint, `sp`/`sq` 3-cell end/middle joints (`sp` only fits `sq`, so spans can't exceed 3 cells). A cell counts as ground when its bottom socket is `ground`, which is either the grid floor or the top of a terrace.
- **Wide halls**: `ge` (a roof ridge crosses this edge) and `gi` (flat roof line along this edge) at body floors, `re` / `ri` at roof level. Separate names per layer keep every cell of a building at the same height.

The table is checked for symmetry on load. Vertical sockets carry the footprint and a symmetry (`inv` / `axis` / `full`), so oriented stacks line up after rotation: an L-shaped hall gets an L-shaped roof turned the same way.

Some details depend on neighbours, so they're derived at render time rather than being WFC modules (`World.rebuildDecor`), at any height: canal banks (bridges count as water), waterfalls at terrace edges (only where water waits below), terrace retaining walls and balustrades, sky-bridge docking stubs, tower doors (into an arriving cloister, otherwise onto walkable ground), stubs that bridge round and square towers to walls and cloisters, and cloister extensions that reach a hall facade.

## Solver heuristics

On top of plain weighted WFC:

- **Bottom-up collapse**: the ground layer decides the layout and upper floors follow.
- **Affinity**: canals, gardens and courtyards attract their own group, so they cluster.
- **Solitary landmarks** (`solitary`): special gardens (greenhouse, great tree, maze, pond…) never sit next to a copy of themselves, including across chunk borders.
- **Soft size cap** (`softCap` on wide halls): as a building grows, tiles that would extend it into undecided cells lose weight. Most blocks close off at a moderate size, while long ones (5×30) still happen.

Propagation unions each cell's allowed neighbours for all 6 directions in one pass over its bitset. A 24×5×24 grid with 207 variants solves in about 60 ms. Infinite mode solves chunks time-sliced (about 6 ms per frame), so streaming doesn't hitch. When a chunk can't be completed against its neighbours (about 40% of chunks), the solve region widens 2–4 cells into the solved neighbours and those cells are re-solved with it ("modifying in blocks"), so seams resolve instead of being cut. Dropping neighbour constraints is a last resort that the simulation never reaches (`bun scripts/infinite-sim.ts <seed>`).

## Adding a module

1. Add an entry to `MODULES` in `src/wfc/modules.ts` (sockets, rotations, weight, level, styles).
2. Register a builder with the same id (`register({...})` in `src/geo/modules.ts`, `src/geo/extra.ts`, or a new file imported from `src/geo/index.ts`). Local frame: the origin is at the bottom-centre of the cell, the cell spans x,z ∈ [-2, 2] and y ∈ [0, 3], and the +X socket is built along +X.
3. It shows up in the palette and in generation automatically.

## Dev scripts

- `bun scripts/solver-test.ts`: solver stats and timing.
- `node scripts/shot.mjs <name> [js] [waitMs]`: headless Chrome screenshot into `shots/`. The dev server must be running.
- `node scripts/build-test.mjs`: drives build mode with real mouse clicks.
- `node scripts/hover-test.mjs`: prints which cell the cursor targets over and around structures.
- `node scripts/shot.mjs row2 "window.__only=2; $(cat scripts/showcase.js); __row(2)"`: renders one module family in isolation (rows 0–4).
- `bun scripts/density.ts`: share of open ground vs structures over 20 generated grids.
- `node scripts/shot.mjs t "$(cat scripts/showcase3.js); __view(-5, 0, 1.2)"`: terraces, sky bridge, chapel and garden showcase.
- `bun scripts/landmarks.ts`: checks that no landmark garden touches its twin.
- `bun scripts/sky.ts`: sky-bridge span lengths and docking check.
- `bun scripts/prof.ts`: solver benchmark (add `--cpu-prof` to profile).
- `bun scripts/blocks.ts`: wide-hall tile mix and building size distribution.
- `node scripts/shot.mjs blocks "$(cat scripts/blocks-demo.js)"`: composes test footprints (solid block, quad, L) and checks their sockets.
