import * as THREE from 'three';

// Basic autonomous movement for the home scene: walk to a random spot on
// the green area, idle there for a while, then pick a new spot and repeat.
// Deliberately simple — no pathfinding or collision avoidance with props,
// just a straight line to each target — this drives the OUTER "rig" that
// Kibi's own model sits inside, so Kibi's own idle bob/sway/rock (kibi.js's
// update(), applied to its own local group) keeps working unchanged and
// simply composes on top of wherever the rig currently is/faces.

const WALK_SPEED = 1.3; // units/sec
const IDLE_MIN = 3;
const IDLE_MAX = 7;
const ARRIVE_THRESHOLD = 0.15;
const TURN_SPEED = 4; // radians/sec, how fast Kibi turns to face its walking direction

// Roam within the green zone (radius 30, see terrain.js) — inset from both
// the very center (so it doesn't just idle on the same spot near origin
// every time) and the sand/beach edge.
const ROAM_RADIUS_MIN = 4;
const ROAM_RADIUS_MAX = 24;

function randomIdleDuration() {
  return IDLE_MIN + Math.random() * (IDLE_MAX - IDLE_MIN);
}

function randomTarget() {
  const angle = Math.random() * Math.PI * 2;
  const radius = ROAM_RADIUS_MIN + Math.random() * (ROAM_RADIUS_MAX - ROAM_RADIUS_MIN);
  return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
}

export function createWander(rig, opts = {}) {
  const speed = opts.speed ?? WALK_SPEED;
  let state = 'idle';
  let idleTimer = randomIdleDuration();
  let target = rig.position.clone();
  const toTarget = new THREE.Vector3();

  // update(dt) returns true while actively walking (false while idling) so
  // the caller can pass that through to kibi.update() — Kibi's own gait
  // animation only plays while actually moving.
  function update(dt) {
    if (state === 'idle') {
      idleTimer -= dt;
      if (idleTimer <= 0) {
        target = randomTarget();
        state = 'walking';
      }
      return false;
    }

    toTarget.copy(target).sub(rig.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < ARRIVE_THRESHOLD) {
      state = 'idle';
      idleTimer = randomIdleDuration();
      return false;
    }

    const dir = toTarget.multiplyScalar(1 / dist); // normalize (dist > ARRIVE_THRESHOLD > 0)
    const step = Math.min(speed * dt, dist);
    rig.position.addScaledVector(dir, step);

    // Turn to face the walking direction — Kibi's own local +Z is "front"
    // (see kibi.js: eyes/chest are placed at positive z), so the rig's yaw
    // that makes local +Z point along `dir` is atan2(dir.x, dir.z).
    const desiredYaw = Math.atan2(dir.x, dir.z);
    let yawDiff = desiredYaw - rig.rotation.y;
    yawDiff = Math.atan2(Math.sin(yawDiff), Math.cos(yawDiff)); // shortest turn direction
    const maxTurn = TURN_SPEED * dt;
    rig.rotation.y += Math.max(-maxTurn, Math.min(maxTurn, yawDiff));
    return true;
  }

  return { update };
}
