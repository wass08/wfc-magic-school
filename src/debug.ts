import GUI from 'three/examples/jsm/libs/lil-gui.module.min.js';
import type { Effects, LookProfile, Stage } from './render/stage';

/**
 * `?debug` pane: frame timings, effect switches and the depth-of-field / fog profiles for
 * the orbit camera and broom flight. Settings persist in this browser; "Copy settings"
 * puts them on the clipboard as JSON to paste back into `Stage.look`.
 */
// versioned: settings saved under an older version no longer mask new defaults
const KEY = 'magic-school:debug:v3';

interface Saved {
  look?: { orbit?: Partial<LookProfile>; flight?: Partial<LookProfile> };
  fx?: Partial<Effects>;
}

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function createDebugPane(stage: Stage) {
  const defaults = JSON.parse(JSON.stringify({ look: stage.look, fx: stage.fx }));
  const saved = load();
  Object.assign(stage.look.orbit, saved.look?.orbit);
  Object.assign(stage.look.flight, saved.look?.flight);
  const prevFx = { ...stage.fx };
  Object.assign(stage.fx, saved.fx);
  stage.applyEffects(prevFx);

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ look: stage.look, fx: stage.fx }));
    } catch {
      /* private mode: settings just won't persist */
    }
  };

  const gui = new GUI({ title: 'Debug · ?debug' });
  gui.domElement.style.zIndex = '60';

  // --- timings
  const perf = { fps: 0, cpu: 0, gpu: 0, draws: 0, tris: 0 };
  const fPerf = gui.addFolder('Frame');
  fPerf.add(perf, 'fps').name('fps').listen().disable();
  fPerf.add(perf, 'cpu').name('CPU ms (loop)').listen().disable();
  const gpuCtl = fPerf.add(perf, 'gpu').name('GPU ms').listen().disable();
  fPerf.add(perf, 'draws').name('draw calls').listen().disable();
  fPerf.add(perf, 'tris').name('triangles (k)').listen().disable();
  const timestamps = (stage.renderer.backend as any).trackTimestamp === true;
  if (!timestamps) gpuCtl.name('GPU ms (n/a here)');

  // --- effects
  const fFx = gui.addFolder('Effects');
  const onFx = () => {
    stage.applyEffects(last);
    last = { ...stage.fx };
    save();
  };
  let last = { ...stage.fx };
  fFx.add(stage.fx, 'dof').name('depth of field').onChange(onFx);
  fFx.add(stage.fx, 'bloom').name('bloom').onChange(onFx);
  fFx.add(stage.fx, 'shadows').name('sun shadows').onChange(onFx);
  fFx.add(stage.fx, 'windowLight').name('window light on ground').onChange(onFx);
  fFx.add(stage.fx, 'classicWindows').name('classic windows (flat glow)').onChange(onFx);
  fFx.add(stage.fx, 'msaa').name('MSAA ×4').onChange(onFx);
  fFx.add(stage.fx, 'pixelRatio', [1, 1.25, 1.5, 2]).name('pixel ratio').onChange(onFx);

  // --- look profiles
  const lookFolder = (title: string, p: LookProfile, open: boolean, withDof: boolean) => {
    const f = gui.addFolder(title);
    if (withDof) {
      // far-only blur: sharp up to (camera distance + "sharp until"), full blur "ramp" later
      const dofF = f.addFolder('Depth of field (far blur)');
      dofF.add(p, 'bokeh', 0, 6, 0.05).name('blur strength').onChange(save);
      dofF.add(p, 'focusShift', 0, 120, 0.5).name('sharp until (+dist)').onChange(save);
      dofF.add(p, 'dofBase', 1, 200, 0.5).name('blur ramp').onChange(save);
      dofF.add(p, 'dofRange', 0, 3, 0.01).name('ramp × dist').onChange(save);
    }
    const fogF = f.addFolder('Fog');
    fogF.add(p, 'minHaze', 0, 200, 0.5).name('min distance').onChange(save);
    fogF.add(p, 'fogNear', 0, 60, 0.01).name('start × dist').onChange(save);
    fogF.add(p, 'fogFar', 0.5, 80, 0.05).name('end × dist').onChange(save);
    fogF.add(p, 'fogBase', 0, 600, 1).name('end + base').onChange(save);
    if (!open) f.close();
    return f;
  };
  const fFlight = lookFolder('Broom flight', stage.look.flight, true, true);
  // the orbit camera never blurs (its output skips the depth-of-field passes)
  const fOrbit = lookFolder('Orbit camera', stage.look.orbit, false, false);

  gui
    .add(
      {
        copy: () => {
          const text = JSON.stringify({ look: stage.look, fx: stage.fx }, null, 2);
          navigator.clipboard?.writeText(text).catch(() => console.info(text));
          console.info('[debug] settings\n' + text);
        },
      },
      'copy',
    )
    .name('Copy settings (JSON)');
  gui
    .add(
      {
        reset: () => {
          const prev = { ...stage.fx };
          Object.assign(stage.look.orbit, defaults.look.orbit);
          Object.assign(stage.look.flight, defaults.look.flight);
          Object.assign(stage.fx, defaults.fx);
          stage.applyEffects(prev);
          last = { ...stage.fx };
          save();
          gui.controllersRecursive().forEach((c) => c.updateDisplay());
        },
      },
      'reset',
    )
    .name('Reset to defaults');

  // --- per-frame sampling (smoothed so the numbers are readable)
  let acc = 0, frames = 0, cpuAcc = 0, gpuPending = false;
  return {
    /** call once per frame with the frame delta (s) and the loop's own CPU time (ms) */
    frame(dt: number, cpuMs: number) {
      acc += dt;
      frames++;
      cpuAcc += cpuMs;
      const info = stage.renderer.info.render;
      if (acc >= 0.5) {
        perf.fps = Math.round(frames / acc);
        perf.cpu = +(cpuAcc / frames).toFixed(2);
        perf.draws = info.drawCalls;
        perf.tris = Math.round(info.triangles / 1000);
        acc = frames = cpuAcc = 0;
      }
      // resolve every frame (the query pool fills up otherwise); read the last frame's total
      if (timestamps && !gpuPending) {
        gpuPending = true;
        stage.renderer
          .resolveTimestampsAsync('render')
          .then((ms) => {
            if (typeof ms === 'number' && ms > 0) perf.gpu = +(perf.gpu * 0.8 + ms * 0.2).toFixed(2);
          })
          .finally(() => (gpuPending = false));
      }
    },
    /** open the profile that matters for the current camera */
    focusFlight(on: boolean) {
      if (on) {
        fFlight.open();
        fOrbit.close();
      }
    },
    perf,
  };
}
