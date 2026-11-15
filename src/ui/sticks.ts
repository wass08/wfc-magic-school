/**
 * On-screen joysticks for broom flight on touch screens: the left stick flies (forward / back,
 * strafe), the right one looks (turn, aim up and down). Each value is −1…1, y down positive.
 * Shown only while flying on a touch device (`body.is-touch.is-flying`, see style.css).
 */
export interface StickValue {
  x: number;
  y: number;
}

/** knob travel in px at full deflection */
const RADIUS = 46;
/** ignore tiny offsets around the centre */
const DEAD = 0.12;

function stick(el: HTMLElement, value: StickValue) {
  const knob = el.querySelector<HTMLElement>('.stick__knob')!;
  let id: number | null = null;
  let cx = 0, cy = 0;
  const set = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    const k = len > RADIUS ? RADIUS / len : 1;
    knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    // dead zone, then a soft curve so small moves are precise
    const m = Math.min(1, len / RADIUS);
    const amount = m < DEAD ? 0 : ((m - DEAD) / (1 - DEAD)) ** 1.4;
    value.x = len ? (dx / len) * amount : 0;
    value.y = len ? (dy / len) * amount : 0;
  };
  const release = () => {
    id = null;
    value.x = value.y = 0;
    knob.style.transform = '';
    el.classList.remove('is-active');
  };
  el.addEventListener('pointerdown', (e) => {
    if (id !== null) return;
    e.preventDefault();
    id = e.pointerId;
    const r = el.getBoundingClientRect();
    cx = r.left + r.width / 2;
    cy = r.top + r.height / 2;
    try {
      el.setPointerCapture(id);
    } catch {
      /* the stick still tracks moves over itself */
    }
    el.classList.add('is-active');
    set(e.clientX - cx, e.clientY - cy);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerId === id) set(e.clientX - cx, e.clientY - cy);
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    el.addEventListener(t, (e) => {
      if ((e as PointerEvent).pointerId === id) release();
    });
  return release;
}

export function createSticks(root: HTMLElement) {
  const move: StickValue = { x: 0, y: 0 };
  const look: StickValue = { x: 0, y: 0 };
  const releases = [stick(root.querySelector<HTMLElement>('.stick--move')!, move), stick(root.querySelector<HTMLElement>('.stick--look')!, look)];
  // the first touch anywhere marks a touch device (a mouse never does)
  const markTouch = (e: PointerEvent) => document.body.classList.toggle('is-touch', e.pointerType === 'touch');
  window.addEventListener('pointerdown', markTouch, { capture: true, passive: true });
  if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('is-touch');
  return {
    move,
    look,
    /** let go of both sticks (landing, losing focus) */
    reset: () => releases.forEach((r) => r()),
  };
}
