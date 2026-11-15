// The light model of the Pascal viewer's sun (packages/viewer/src/lib/daylight/solar.ts, main @ 51bf407),
// driven by an art-directed elevation/azimuth instead of a real date and site location, so the
// castle's Day / Dusk / Night land on the same sun elevations as Pascal's Midday / Blue hour / Night
// presets and can be tweened between.
import { Color, MathUtils, Vector3 } from 'three';

const RAD = Math.PI / 180;

export type SolarLight = {
  azimuth: number;
  elevation: number;
  /** Unit vector towards the sun, site frame (x east, y up, z south). */
  direction: Vector3;
  /** Linear RGB, max channel 1: white at noon, gold low, orange at sunset. */
  color: Color;
  /** 0…1 relative strength of the disc (horizon fade × air-mass extinction). */
  strength: number;
  /** 0 day … 1 night (sun below −7°). */
  night: number;
};

// Rayleigh (680/550/440 nm) plus a light aerosol term.
const TAU = [0.043 + 0.07, 0.098 + 0.08, 0.236 + 0.095];

function airMass(elevation: number) {
  const z = 90 - Math.max(elevation, -0.5);
  return 1 / (Math.cos(z * RAD) + 0.50572 * (96.07995 - z) ** -1.6364);
}

export function createSolarLight(): SolarLight {
  return { azimuth: 0, elevation: 0, direction: new Vector3(), color: new Color(), strength: 0, night: 0 };
}

/** Same outputs as Pascal's `solarLight`, from a sun elevation/azimuth in degrees. */
export function solarLightAt(elevation: number, azimuth: number, s: SolarLight = createSolarLight()): SolarLight {
  s.azimuth = azimuth;
  s.elevation = elevation;
  const bearing = azimuth * RAD;
  const el = elevation * RAD;
  s.direction.set(Math.sin(bearing) * Math.cos(el), Math.sin(el), -Math.cos(bearing) * Math.cos(el)).normalize();
  const m = airMass(elevation);
  const ratio = TAU.map((tau) => Math.exp(-tau * m) / Math.exp(-tau));
  const peak = Math.max(...ratio, 1e-6);
  // pow 0.6: golden rather than raw-physical orange.
  s.color.setRGB((ratio[0] / peak) ** 0.6, (ratio[1] / peak) ** 0.6, (ratio[2] / peak) ** 0.6);
  s.strength = MathUtils.smoothstep(elevation, -1, 1.5) * peak * Math.min(1, Math.sin(Math.max(el, 0)) * 0.5 + 0.55);
  s.night = 1 - MathUtils.smoothstep(elevation, -7, 2);
  return s;
}
