import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ELEMENTS, ELEMENT_INFO, NEUTRAL_COLOR } from './traits.js';

// Builds one Chao as a small hierarchy of low-poly primitives, then exposes
// applyTraits()/update() so traits (see traits.js) drive its look continuously
// instead of swapping to a different mesh per "evolution".
//
// Two structural params control the base silhouette, separate from traits:
//   age:   1 = bare blob (body + head only), 2 = + arms/legs, 3 = + wings.
//          This is the coarse "evolution stage" skeleton; traits then layer
//          finer detail (color, props, proportions) on top of whatever the
//          current age built.
//   shape: 'sphere' | 'cube' — which primitive family the body/head are
//          built from. Ears are deliberately NOT part of the base body —
//          per design, those (and other animal features) are meant to come
//          from feeding animal-type items later, not from age/element state.
//
// Proportions are deliberately chibi: the head is the dominant mass and sits
// deep into the body (heavy overlap) so it reads as one soft blob with a big
// face, not two stacked primitives with a visible waist/neck seam.

const BODY_RADIUS = 0.3;
const HEAD_RADIUS = 0.42;
const BODY_Y = BODY_RADIUS * 0.85; // body center height; squash keeps its base near the ground
const HEAD_Y = 0.6; // overlaps the body for a chibi read, but leaves the body's
                     // sides/bottom clear so age-2 limbs have somewhere to attach

function lowPolyMaterial(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.05,
    emissive: 0x000000,
    emissiveIntensity: 0,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
  });
}

function bodyGeometry(shape, radius) {
  if (shape === 'cube') {
    const size = radius * 1.6;
    return new RoundedBoxGeometry(size, size, size, 2, radius * 0.6); // heavily rounded — a soft cube, not a Lego block
  }
  return new THREE.IcosahedronGeometry(radius, 1); // detail 1: faceted but not chunky
}

function headGeometry(shape, radius) {
  if (shape === 'cube') {
    const size = radius * 1.6;
    return new RoundedBoxGeometry(size, size, size, 2, radius * 0.6);
  }
  return new THREE.IcosahedronGeometry(radius, 1);
}

export function createChao({ age = 1, shape = 'sphere' } = {}) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (obj) => {
    disposables.push(obj);
    return obj;
  };

  // --- body + head -------------------------------------------------------
  const bodyMat = track(lowPolyMaterial(NEUTRAL_COLOR));
  const body = new THREE.Mesh(track(bodyGeometry(shape, BODY_RADIUS)), bodyMat);
  body.position.y = BODY_Y;
  body.scale.y = 0.9;
  group.add(body);

  const headMat = track(lowPolyMaterial(NEUTRAL_COLOR));
  const head = new THREE.Mesh(track(headGeometry(shape, HEAD_RADIUS)), headMat);
  head.position.y = HEAD_Y;
  group.add(head);

  const headTopY = HEAD_Y + HEAD_RADIUS;

  // --- eyes: smooth + glossy, contrasting with the faceted body -----------
  // Children of `head` (not `group`) so they scale/move with it — keeps them
  // pinned to the face surface even when a trait (e.g. speed) stretches the
  // head, instead of clipping into or floating off the mesh.
  const eyeGeo = track(new THREE.SphereGeometry(0.08, 12, 10));
  const eyeMat = track(new THREE.MeshStandardMaterial({ color: 0x171512, roughness: 0.25 }));
  const highlightGeo = track(new THREE.SphereGeometry(0.026, 8, 6));
  const highlightMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, emissive: 0x333333 }));

  function makeEye(x) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 0.05, HEAD_RADIUS * 0.82);
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.position.set(-0.024 * Math.sign(x || 1), 0.03, 0.05);
    eye.add(highlight);
    head.add(eye);
    return eye;
  }
  const eyeL = makeEye(-0.17);
  const eyeR = makeEye(0.17);

  // --- tail (present from age 1, a Chao staple) ----------------------------
  const tailMat = track(lowPolyMaterial(NEUTRAL_COLOR));
  const tail = new THREE.Mesh(track(new THREE.ConeGeometry(0.075, 0.22, 8)), tailMat);
  tail.position.set(0, BODY_Y + 0.02, -BODY_RADIUS * 1.3);
  tail.rotation.x = Math.PI * 0.55;
  group.add(tail);

  // --- age 2+: arms and legs, with a small "joint" sphere hiding the seam --
  const limbs = [];
  const joints = [];
  if (age >= 2) {
    const limbMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const jointGeo = track(new THREE.SphereGeometry(0.1, 10, 8));
    const armGeo = track(new THREE.CapsuleGeometry(0.06, 0.18, 4, 6));
    const legGeo = track(new THREE.CapsuleGeometry(0.075, 0.2, 4, 6));

    const shoulderY = 0.3;
    const shoulderX = 0.37;
    for (const side of [-1, 1]) {
      const joint = new THREE.Mesh(jointGeo, limbMat);
      joint.position.set(shoulderX * side, shoulderY, 0.03);
      group.add(joint);
      joints.push(joint);

      const arm = new THREE.Mesh(armGeo, limbMat);
      arm.position.set(shoulderX * side + 0.1 * side, shoulderY - 0.09, 0.03);
      arm.rotation.z = Math.PI * 0.18 * side;
      group.add(arm);
      limbs.push(arm);
    }

    const hipY = 0.09;
    for (const side of [-1, 1]) {
      const joint = new THREE.Mesh(jointGeo.clone(), limbMat);
      joint.scale.setScalar(0.85);
      joint.position.set(0.27 * side, hipY, 0.04);
      group.add(joint);
      joints.push(joint);

      const leg = new THREE.Mesh(legGeo, limbMat);
      leg.position.set(0.27 * side, hipY - 0.02, 0.04);
      group.add(leg);
      limbs.push(leg);
    }
  }

  // --- age 3+: basic wings ---------------------------------------------------
  // Own accent material (not the shared skin tint) and thick enough to read
  // as a wing rather than a sliver, mounted high on the back near the
  // shoulders so they're visible from a 3/4 front angle, not just from behind.
  let wings = [];
  if (age >= 3) {
    const wingMat = track(new THREE.MeshStandardMaterial({
      color: 0xeaf6ff,
      flatShading: true,
      transparent: true,
      opacity: 0.85,
      roughness: 0.3,
      emissive: 0x8fc7e8,
      emissiveIntensity: 0.25,
    }));
    const wingGeo = track(new THREE.ConeGeometry(0.26, 0.5, 3));

    const wingL = new THREE.Mesh(wingGeo, wingMat);
    const wingR = new THREE.Mesh(wingGeo, wingMat);
    wingL.scale.z = 0.32;
    wingR.scale.z = 0.32;
    wingL.position.set(-0.22, HEAD_Y + 0.05, -BODY_RADIUS * 0.7);
    wingR.position.set(0.22, HEAD_Y + 0.05, -BODY_RADIUS * 0.7);
    wingL.rotation.set(Math.PI * 0.42, 0, Math.PI * 0.4);
    wingR.rotation.set(Math.PI * 0.42, 0, -Math.PI * 0.4);
    group.add(wingL, wingR);
    wings = [wingL, wingR];
  }

  // --- element accessories --------------------------------------------------
  // fire: a two-tone flame anchored right at the head's surface (no gap).
  const flameGroup = new THREE.Group();
  flameGroup.position.set(-0.06, headTopY - 0.06, 0.02);
  const flameOuterMat = track(new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.fire.color,
    emissive: ELEMENT_INFO.fire.color,
    emissiveIntensity: 1.1,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const flameInnerMat = track(new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.fire.accent,
    emissive: ELEMENT_INFO.fire.accent,
    emissiveIntensity: 1.4,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const flameOuter = new THREE.Mesh(track(new THREE.ConeGeometry(0.08, 0.22, 6)), flameOuterMat);
  flameOuter.position.y = 0.09;
  const flameInner = new THREE.Mesh(track(new THREE.ConeGeometry(0.045, 0.13, 6)), flameInnerMat);
  flameInner.position.y = 0.13;
  flameGroup.add(flameOuter, flameInner);
  flameGroup.scale.setScalar(0.01);
  group.add(flameGroup);

  // water: a small held/worn gem — the readable prop the flat color tint was missing.
  const gemMat = track(new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.water.accent,
    emissive: ELEMENT_INFO.water.color,
    emissiveIntensity: 0.5,
    roughness: 0.05,
    metalness: 0.7,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const gem = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.09, 0)), gemMat);
  gem.position.set(0, BODY_Y + 0.05, BODY_RADIUS * 0.95);
  gem.scale.setScalar(0.01);
  group.add(gem);

  // nature: a flattened leaf blade (not a horn) sprouting from the head.
  const leafMat = track(new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.nature.color,
    flatShading: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  }));
  const leaf = new THREE.Mesh(track(new THREE.ConeGeometry(0.07, 0.2, 4)), leafMat);
  leaf.position.set(0.09, headTopY - 0.05, 0);
  leaf.rotation.z = -0.35;
  leaf.scale.set(0.35, 1, 1);
  leaf.scale.multiplyScalar(0.01);
  group.add(leaf);

  const skinMeshes = [body, head, tail, ...limbs, ...joints, ...wings];
  const blinkState = { timer: randomBlinkDelay(), blinking: false, phase: 0 };

  function applyTraits(traits) {
    const weights = ELEMENTS.map((el) => traits[el] ?? 0);
    const total = weights.reduce((a, b) => a + b, 0);

    // Blend element colors by affinity; fall back to neutral when nothing fed yet.
    const blended = new THREE.Color(NEUTRAL_COLOR);
    if (total > 0.001) {
      blended.setRGB(0, 0, 0);
      for (const el of ELEMENTS) {
        const w = (traits[el] ?? 0) / total;
        if (w <= 0) continue;
        blended.add(new THREE.Color(ELEMENT_INFO[el].color).multiplyScalar(w));
      }
      const strength = Math.min(total, 1);
      blended.lerp(new THREE.Color(NEUTRAL_COLOR), 1 - strength);
    }

    for (const m of skinMeshes) {
      m.material.color.copy(blended);
      m.material.emissive.copy(blended);
      m.material.emissiveIntensity = Math.min(total, 1) * 0.3;
    }

    const fire = traits.fire ?? 0;
    const water = traits.water ?? 0;
    const nature = traits.nature ?? 0;
    const speed = traits.speed ?? 0;

    // fire -> flame grows in, anchored at the head.
    const fireT = Math.min(fire * 1.2, 1);
    flameOuterMat.opacity = fireT;
    flameInnerMat.opacity = fireT;
    flameGroup.scale.setScalar(0.01 + fire * 1.1);

    // water -> wetter/glossier skin + a held gem fades in.
    for (const m of skinMeshes) {
      m.material.roughness = 0.7 - water * 0.55;
      m.material.metalness = 0.05 + water * 0.25;
    }
    gemMat.opacity = water;
    gem.scale.setScalar(0.01 + water * 1.1);

    // nature -> leaf blade grows in from nothing.
    leafMat.opacity = nature;
    leaf.scale.set(0.35, 1, 1).multiplyScalar(0.01 + nature * 1.1);

    // speed -> aerodynamic: body/head stretch forward and taper. Eyes are
    // children of `head` so they stay pinned to its surface as it stretches.
    const stretch = 1 + speed * 0.5;
    const taper = 1 - speed * 0.2;
    body.scale.set(taper, 0.9, stretch);
    head.scale.set(taper, 1, stretch);
    tail.scale.set(1 - speed * 0.4, 1 + speed * 0.6, 1 - speed * 0.4);
  }

  function update(dt, t) {
    // idle bob
    group.position.y = Math.sin(t * 1.6) * 0.035;
    group.rotation.y = Math.sin(t * 0.5) * 0.12;

    // blink
    blinkState.timer -= dt;
    if (!blinkState.blinking && blinkState.timer <= 0) {
      blinkState.blinking = true;
      blinkState.phase = 0;
    }
    if (blinkState.blinking) {
      blinkState.phase += dt / 0.12;
      const s = blinkState.phase < 0.5
        ? 1 - blinkState.phase * 2
        : (blinkState.phase - 0.5) * 2;
      eyeL.scale.y = eyeR.scale.y = Math.max(0.08, s);
      if (blinkState.phase >= 1) {
        blinkState.blinking = false;
        blinkState.timer = randomBlinkDelay();
        eyeL.scale.y = eyeR.scale.y = 1;
      }
    }

    // fire flame: gentle flicker (scale + emissive jitter), no bob offset
    // needed now since it's anchored directly to the head.
    if (flameOuterMat.opacity > 0.01) {
      const flicker = 1 + Math.sin(t * 9) * 0.08;
      flameGroup.children[0].scale.set(flicker, 1 + Math.sin(t * 7) * 0.12, flicker);
      flameOuterMat.emissiveIntensity = 1 + Math.sin(t * 9) * 0.25;
      flameInnerMat.emissiveIntensity = 1.3 + Math.sin(t * 11) * 0.3;
    }

    // wings: idle flutter
    if (wings.length) {
      const flap = Math.sin(t * 2.2) * 0.12;
      wings[0].rotation.z = Math.PI * 0.4 + flap;
      wings[1].rotation.z = -Math.PI * 0.4 - flap;
    }
  }

  function dispose() {
    for (const obj of disposables) obj.dispose?.();
  }

  applyTraits({ fire: 0, water: 0, nature: 0, speed: 0 });

  return { group, applyTraits, update, dispose };
}

function randomBlinkDelay() {
  return 2.5 + Math.random() * 3;
}
