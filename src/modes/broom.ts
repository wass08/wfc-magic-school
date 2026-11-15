import * as THREE from 'three/webgpu';
import { abs, float, hash, instanceIndex, length, max, mix, sin, smoothstep, vec3 } from 'three/tsl';
import { CELL_H, CELL_W } from '../config';
import { globalUniforms } from '../render/materials';
import { makeSpriteCloud, markSpriteCloudDirty, spriteSize, spriteUV } from '../render/sprites';
import { Stage } from '../render/stage';
import { World } from '../render/world';
import { VARIANTS } from '../wfc/variants';
import { Collider } from './collide';
import { buildRider } from './rider';

export interface FlightInput {
  /** +1 forward, −1 brake / back (analog from a joystick) */
  forward: number;
  /** +1 strafe right, −1 left (analog) */
  strafe: number;
  /** +1 climb, −1 dive */
  lift: number;
  /** look rate from a joystick (−1…1): x turns right, y aims up */
  lookX?: number;
  lookY?: number;
  /** burst of speed (Shift) */
  boost?: boolean;
}

const CRUISE = 16;
/** top speed while boosting (Shift + forward) */
const BOOST = 30;
const REVERSE = -4;
/** sideways speed (A / D) */
const STRAFE = 9;
/** joystick look: turn and aim rates at full deflection (radians per second) */
const STICK_TURN = 2.1;
const STICK_AIM = 1.3;
const CLIMB = 7;
const MAX_ALT = 42;
/** the rider's collision sphere (centred a little above the handle) */
const BODY_R = 0.75;
const BODY_Y = 0.45;
/** longest step per collision check: no tunnelling through thin walls at low frame rates */
const STEP = 0.3;
/** chase camera distance: default and wheel range */
const CAM_DIST = 5;
/** steepest climb / dive the mouse can aim (radians) */
const MAX_AIM = 1.05;
/** mouse sensitivity (radians per pixel) */
const MOUSE = 0.0026;
const TRAIL = 560;
/** sparkle life (s), launch speed up and out, and gravity */
const SPARK_LIFE = 1.7;
/** the camera sits a little to the right, so the rider flies left of the crosshair */
const SIDE = 1.15;
/** field of view at rest and at full cruise (a wider view sells the speed) */
const FOV_REST = 38;
const FOV_FAST = 48;
/** extra field of view at full boost */
const FOV_BOOST = 9;
/** how far the witch bends forward over the handle at full boost (radians) */
const LEAN_BOOST = 0.42;

/**
 * Third-person broom flight over the infinite grounds. Owns the camera while active
 * (the orbit controls are paused) and keeps `controls.target` on the rider so chunk
 * streaming, fog, depth of field and the window light map follow the flight.
 */
export class BroomFlight {
  readonly object = new THREE.Group();
  active = false;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  speed = 0;
  private vy = 0;
  /** sideways speed (strafing) */
  private side = 0;
  private roll = 0;
  private pitch = 0;
  private time = 0;
  private tilt = new THREE.Group();
  private rider = buildRider();
  // chase camera
  private camPitch = 0.22;
  private camDist = CAM_DIST;
  private collider: Collider;
  private camRange = CAM_DIST;
  private rush = 0;
  /** 0 … 1, eased toward whether Shift is held while flying forward */
  private boost = 0;
  /** the orbit camera's field of view, restored on landing */
  private orbitFov = 32;
  /** nose up (+) / down (−), aimed with the mouse: flying forward climbs or dives along it */
  private aim = 0;
  /** mouse turning accumulated since the last frame (for the bank) */
  private mouseTurn = 0;
  private dragging = false;
  /** fired when the pointer lock is taken or released while flying */
  onLock: (locked: boolean) => void = () => {};
  /** ran into the castle (0 … 1 by speed) */
  onBump: (strength: number) => void = () => {};
  /** skimmed past something: side −1 left, +1 right, 0 overhead (an arch); intensity 0 … 1 */
  onFlyby: (side: number, intensity: number) => void = () => {};
  /** Shift (or the boost button) held while flying forward */
  boosting = false;
  private touching = false;
  private probeT = 0;
  private near = [false, false, false];
  private look = new THREE.Vector3();
  // sparkle trail
  private trail: THREE.Sprite;
  private trailPos = new Float32Array(TRAIL * 3);
  private trailBirth = new Float32Array(TRAIL).fill(-100);
  private trailHead = 0;
  private emit = 0;

  constructor(private stage: Stage, private world: World) {
    this.collider = new Collider(world);
    this.tilt.add(this.rider.root);
    this.object.add(this.tilt);
    this.object.visible = false;

    this.trail = makeSpriteCloud(TRAIL, this.trailPos, this.trailBirth, (m, P, S) => {
      // each spark pops up and out of the bristles, hangs, then falls (per-spark random kick)
      const age = globalUniforms.uTime.sub(S);
      const k = age.div(SPARK_LIFE).clamp(0, 1);
      const r1 = hash(instanceIndex), r2 = hash(instanceIndex.add(7919)), r3 = hash(instanceIndex.add(104729));
      const v0 = vec3(r1.sub(0.5).mul(1.8), r2.mul(1.6).add(1.8), r3.sub(0.5).mul(1.8));
      const c = P.add(v0.mul(age)).add(vec3(0, age.mul(age).mul(-2.4), 0));
      m.positionNode = c;
      // swell in, shrink out; a twinkle per spark
      const twinkle = sin(age.mul(r1.mul(14).add(10)).add(r2.mul(6.28))).mul(0.35).add(0.75);
      const size = smoothstep(0, 0.12, age).mul(float(1).sub(k)).mul(r3.mul(0.6).add(0.7));
      m.sizeNode = spriteSize(c, size.mul(340));
      // a soft core with a four-point glint
      const q = spriteUV().sub(0.5);
      const core = smoothstep(0.32, 0.0, length(q));
      const rays = max(smoothstep(0.07, 0, abs(q.x)).mul(smoothstep(0.5, 0, abs(q.y))), smoothstep(0.07, 0, abs(q.y)).mul(smoothstep(0.5, 0, abs(q.x))));
      const warm = mix(vec3(1, 0.88, 0.55), vec3(1, 0.6, 0.85), r2);
      m.colorNode = mix(warm, vec3(0.62, 0.5, 1), k).mul(twinkle).mul(2.2);
      m.opacityNode = max(core, rays.mul(0.9)).mul(float(1).sub(k.mul(k))).mul(smoothstep(0, 0.04, age));
    });
    this.trail.renderOrder = 6;
    this.trail.visible = false;

    // mouse steering: with the pointer locked the mouse always steers; without it
    // (lock refused, or released with Esc) dragging steers and a click locks again
    const el = stage.renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (!this.locked) this.lock();
      this.dragging = true;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.active || !(this.locked || this.dragging)) return;
      const turn = -e.movementX * MOUSE;
      this.yaw += turn;
      this.mouseTurn += turn;
      this.aim = THREE.MathUtils.clamp(this.aim - e.movementY * MOUSE, -MAX_AIM, MAX_AIM);
    });
    document.addEventListener('pointerlockchange', () => {
      if (this.active) this.onLock(this.locked);
    });
    const up = () => (this.dragging = false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        this.camDist = THREE.MathUtils.clamp(this.camDist * (1 + e.deltaY * 0.001), 2.5, 14);
      },
      { passive: true },
    );
  }

  /** The sparkle trail lives in world space, apart from the rider. */
  get trailObject() {
    return this.trail;
  }

  get locked() {
    return document.pointerLockElement === this.stage.renderer.domElement;
  }

  /** Hide the cursor and steer with raw mouse motion (needs a user gesture). */
  lock() {
    const el = this.stage.renderer.domElement as HTMLCanvasElement;
    try {
      const r = el.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch {
      /* drag steering still works */
    }
  }

  private forward(yaw = this.yaw, out = new THREE.Vector3()) {
    return out.set(Math.sin(yaw), 0, Math.cos(yaw));
  }

  /** Top of whatever stands at a world xz (castle cells), 0 on open ground (take-off height). */
  private floorAt(x: number, z: number) {
    const cx = Math.round(x / CELL_W);
    const cz = Math.round(z / CELL_W);
    for (let y = 7; y >= 0; y--) {
      const c = this.world.get(cx, y, cz);
      if (c && VARIANTS[c.v].module.id !== 'air') return (y + 1) * CELL_H;
    }
    return 0;
  }

  /** Take off from the camera's current view. */
  start() {
    const c = this.stage.controls;
    const dir = c.target.clone().sub(this.stage.camera.position);
    this.yaw = Math.atan2(dir.x, dir.z);
    this.pos.copy(c.target);
    this.pos.y = Math.max(this.floorAt(this.pos.x, this.pos.z) + 3, 9);
    this.speed = 0;
    this.vy = 0;
    this.side = 0;
    this.aim = 0;
    this.mouseTurn = 0;
    this.camPitch = 0.22;
    this.camRange = this.camDist;
    this.look.copy(this.pos);
    this.active = true;
    this.object.visible = this.trail.visible = true;
    this.trailBirth.fill(-100);
    markSpriteCloudDirty(this.trail);
    c.enabled = false;
    this.stage.freeCamera = true;
    this.orbitFov = this.stage.camera.fov;
  }

  /** Land: hand the camera back to the orbit controls, looking at where we were. */
  stop() {
    if (!this.active) return;
    this.active = false;
    if (this.locked) document.exitPointerLock();
    this.object.visible = this.trail.visible = false;
    const c = this.stage.controls;
    const back = this.forward().negate();
    c.target.set(this.pos.x, 0, this.pos.z);
    this.stage.camera.position.copy(c.target).addScaledVector(back, 26).add(new THREE.Vector3(0, 24, 0));
    c.enabled = true;
    this.stage.freeCamera = false;
    this.rush = 0;
    this.boost = 0;
    const cam = this.stage.camera;
    cam.fov = this.orbitFov;
    cam.updateProjectionMatrix();
  }

  /** Move to a spot (new world) without leaving the broom. */
  teleport(x: number, z: number) {
    this.pos.set(x, Math.max(this.floorAt(x, z) + 3, 9), z);
    this.speed = 0;
  }

  update(dt: number, input: FlightInput) {
    if (!this.active) return;
    this.time += dt;
    const fwd = this.forward();

    // --- flight model: eased speed along the aimed direction, banked turns, extra lift keys
    // Shift while flying forward: a burst of speed (eases in quickly, out a little slower)
    const boosting = input.boost && input.forward > 0 ? 1 : 0;
    this.boosting = boosting > 0;
    this.boost += (boosting - this.boost) * Math.min(1, dt * (boosting ? 2.6 : 1.6));
    const top = CRUISE + (BOOST - CRUISE) * this.boost;
    const target = input.forward > 0 ? top * input.forward : input.forward < 0 ? REVERSE * -input.forward : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * (input.forward ? 1.4 + boosting * 1.2 : 0.9));
    // the mouse (or the right stick) steers; A / D slide sideways
    const stickTurn = -(input.lookX ?? 0) * STICK_TURN * dt;
    this.yaw += stickTurn;
    this.mouseTurn += stickTurn;
    this.aim = THREE.MathUtils.clamp(this.aim + (input.lookY ?? 0) * STICK_AIM * dt, -MAX_AIM, MAX_AIM);
    this.side += (input.strafe * STRAFE - this.side) * Math.min(1, dt * (input.strafe ? 3 : 2.2));
    const turnRate = THREE.MathUtils.clamp(this.mouseTurn / Math.max(dt, 1e-3), -3, 3);
    this.mouseTurn = 0;
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const cosA = Math.cos(this.aim);
    const sinA = Math.sin(this.aim);
    this.vy += (input.lift * CLIMB - this.vy) * Math.min(1, dt * 3);
    // fly anywhere (through arches, under bridges, between towers); the castle only stops a
    // sphere around the rider, which slides along whatever it touches
    const move = new THREE.Vector3(fwd.x * this.speed * cosA, this.speed * sinA + this.vy, fwd.z * this.speed * cosA)
      .addScaledVector(right, this.side)
      .multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(move.length() / STEP));
    move.divideScalar(steps);
    const body = new THREE.Vector3();
    let bumped = false;
    for (let i = 0; i < steps; i++) {
      this.pos.add(move);
      body.set(this.pos.x, this.pos.y + BODY_Y, this.pos.z);
      const push = this.collider.resolveSphere(body, BODY_R);
      if (push.lengthSq() > 0) {
        this.pos.add(push);
        bumped = true;
      }
    }
    // a head-on bump bleeds speed (a glancing one barely does)
    if (bumped && !this.touching && Math.abs(this.speed) > 2) this.onBump(Math.min(1, Math.abs(this.speed) / CRUISE));
    this.touching = bumped;
    if (bumped) this.speed *= Math.exp(-dt * 2.5);
    this.probeFlyby(dt, fwd);
    // the open ground and the sky are the only other limits
    if (this.pos.y < BODY_R - 0.2) {
      this.pos.y = BODY_R - 0.2;
      if (this.aim < 0) this.aim *= Math.exp(-dt * 3);
    }
    if (this.pos.y > MAX_ALT) {
      this.pos.y = MAX_ALT;
      if (this.aim > 0) this.aim *= Math.exp(-dt * 3);
    }

    // --- pose: bank into turns, nose follows the climb, gentle bob
    // bank into turns and lean into a sideways slide
    this.roll += (THREE.MathUtils.clamp(-turnRate * 0.32 + this.side * 0.04, -0.7, 0.7) - this.roll) * Math.min(1, dt * 4);
    // nose follows the aim (positive x-rotation tips it down) plus the lift keys
    this.pitch += (-this.aim * 0.85 - this.vy * 0.05 - this.pitch) * Math.min(1, dt * 6);
    const bob = Math.sin(this.time * 1.6) * 0.035;
    this.object.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.object.rotation.set(0, this.yaw, 0);
    this.tilt.rotation.set(this.pitch, 0, this.roll + Math.sin(this.time * 1.1) * 0.012);
    // she bends over the handle as she speeds up, flat out when boosting
    const lean = Math.min(1, Math.max(0, this.speed) / CRUISE) * 0.08 + this.boost * LEAN_BOOST;
    this.rider.body.rotation.x = lean;
    this.rider.arms.rotation.x = -lean;
    const flutter = 0.35 + Math.min(1.5, Math.abs(this.speed) / CRUISE) * 0.6;
    this.rider.scarf.rotation.set(-0.5 + flutter * 0.4 + Math.sin(this.time * 13) * 0.12 * flutter, Math.sin(this.time * 7) * 0.2 * flutter, 0);
    this.rider.lantern.rotation.set(Math.sin(this.time * 2.6) * 0.25 - this.speed * 0.02, 0, -this.roll * 0.6);

    // --- sparkles shed from the bristles (more when fast)
    this.emit += dt * (10 + Math.abs(this.speed) * 4.5 + this.boost * 70);
    const now = globalUniforms.uTime.value as number;
    const tail = new THREE.Vector3(0, 0, -1.6).applyEuler(this.tilt.rotation).applyEuler(this.object.rotation).add(this.object.position);
    let dirty = false;
    while (this.emit >= 1) {
      this.emit -= 1;
      const i = this.trailHead;
      this.trailHead = (i + 1) % TRAIL;
      const spread = 1 + this.boost * 0.8;
      this.trailPos[i * 3] = tail.x + (Math.random() - 0.5) * 0.45 * spread;
      this.trailPos[i * 3 + 1] = tail.y + (Math.random() - 0.5) * 0.3 * spread;
      this.trailPos[i * 3 + 2] = tail.z + (Math.random() - 0.5) * 0.45 * spread;
      this.trailBirth[i] = now - Math.random() * dt;
      dirty = true;
    }
    if (dirty) markSpriteCloudDirty(this.trail);

    // --- chase camera: behind the rider, dipping below a climb and rising over a dive so
    // the way ahead stays in view
    const wantPitch = THREE.MathUtils.clamp(0.3 - this.aim * 0.55, -0.35, 0.95);
    this.camPitch += (wantPitch - this.camPitch) * Math.min(1, dt * 3);
    const k = 1 - Math.exp(-dt * 7);
    const back = this.forward().negate();
    // walls between the rider and the camera pull it in (fast), and it eases back out (slowly)
    const pivot = new THREE.Vector3(this.pos.x, this.pos.y + 1.1, this.pos.z);
    const toCam = back.clone().multiplyScalar(Math.cos(this.camPitch)).setY(Math.sin(this.camPitch)).normalize();
    const room = Math.max(1.2, this.collider.castRay(pivot, toCam, this.camDist + 0.4) - 0.4);
    this.camRange += (Math.min(room, this.camDist) - this.camRange) * Math.min(1, dt * (room < this.camRange ? 9 : 1.2));
    // camera and aim point both sit a little to the right: the rider flies left of the
    // crosshair, which stays on where she is heading
    // (less so on a narrow portrait screen, where she'd slide off the edge)
    const narrow = Math.min(1, this.stage.camera.aspect);
    const side = new THREE.Vector3(-fwd.z, 0, fwd.x).multiplyScalar(SIDE * narrow * narrow * Math.min(1, this.camRange / this.camDist));
    const want = pivot.clone().addScaledVector(toCam, this.camRange).add(side);
    want.y = Math.max(want.y, 0.3);
    const cam = this.stage.camera;
    cam.position.lerp(want, room < this.camDist ? Math.min(1, k * 2.5) : k);
    const lead = 1.2 + Math.max(0, this.speed) * 0.08 + 2;
    const ahead3 = new THREE.Vector3(fwd.x * cosA, sinA, fwd.z * cosA);
    this.look.lerp(this.pos.clone().addScaledVector(ahead3, lead).add(new THREE.Vector3(0, -0.35, 0)), Math.min(1, k * 1.6));
    // speed: the view widens (no shake: a bobbing camera makes people queasy)
    const fast = THREE.MathUtils.smoothstep(this.speed, CRUISE * 0.3, CRUISE);
    this.rush += (fast - this.rush) * Math.min(1, dt * 2.5);
    // portrait screens get a taller view so the sides aren't cramped
    const portrait = 1 + Math.max(0, 1 - cam.aspect) * 0.8;
    const fov = (FOV_REST + (FOV_FAST - FOV_REST) * this.rush + FOV_BOOST * this.boost) * portrait;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.lookAt(this.look.clone().add(side));
    this.stage.controls.target.copy(this.look);
  }

  /**
   * Whooshes past towers and under arches: short rays left, right and up a few times a second;
   * a side fires when something comes close at speed, and re-arms once it has fallen behind.
   */
  private probeFlyby(dt: number, fwd: THREE.Vector3) {
    this.probeT += dt;
    if (this.probeT < 0.08) return;
    this.probeT = 0;
    const speed = Math.abs(this.speed);
    const c = new THREE.Vector3(this.pos.x, this.pos.y + BODY_Y, this.pos.z);
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const dirs = [right.clone().negate(), right, new THREE.Vector3(0, 1, 0)];
    const sides = [-1, 1, 0];
    for (let i = 0; i < 3; i++) {
      const d = this.collider.castRay(c, dirs[i], 4);
      if (!this.near[i] && d < (i === 2 ? 2.2 : 2.6) && speed > 8) {
        this.near[i] = true;
        this.onFlyby(sides[i], (speed - 8) / 20 + 0.3);
      } else if (this.near[i] && d > 3.4) this.near[i] = false;
    }
  }

  /** Bank angle (radians, + = rolled left). */
  get bank() {
    return this.roll;
  }

  /** 0 at rest … 1 at full cruise (eased): drives the speed lines. */
  get rushLevel() {
    return this.active ? this.rush : 0;
  }

  /** 0 … 1 while boosting (eased): denser, longer speed lines. */
  get boostLevel() {
    return this.active ? this.boost : 0;
  }
}
