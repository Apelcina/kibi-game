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

const BODY_RADIUS = 0.5;
const HEAD_RADIUS = 0.32;

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
    const size = radius * 1.65;
    return new RoundedBoxGeometry(size, size, size, 2, radius * 0.45);
  }
  return new THREE.IcosahedronGeometry(radius, 1); // detail 1: faceted but not chunky
}

function headGeometry(shape, radius) {
  if (shape === 'cube') {
    const size = radius * 1.7;
    return new RoundedBoxGeometry(size, size, size, 2, radius * 0.5);
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
  body.position.y = BODY_RADIUS * 0.9;
  body.scale.y = 0.88;
  group.add(body);

  const headMat = track(lowPolyMaterial(NEUTRAL_COLOR));
  const head = new THREE.Mesh(track(headGeometry(shape, HEAD_RADIUS)), headMat);
  head.position.y = BODY_RADIUS * 1.55;
  group.add(head);

  // --- eyes: smooth + glossy, contrasting with the faceted body ----------
  const eyeGeo = track(new THREE.SphereGeometry(0.075, 12, 10));
  const eyeMat = track(new THREE.MeshStandardMaterial({ color: 0x171512, roughness: 0.25 }));
  const highlightGeo = track(new THREE.SphereGeometry(0.024, 8, 6));
  const highlightMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, emissive: 0x333333 }));

  function makeEye(x) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, head.position.y + 0.015, HEAD_RADIUS * 0.88);
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.position.set(-0.022 * Math.sign(x || 1), 0.028, 0.045);
    eye.add(highlight);
    group.add(eye);
    return eye;
  }
  const eyeL = makeEye(-0.14);
  const eyeR = makeEye(0.14);

  // --- tail (present from age 1, a Chao staple) ---------------------------
  const tailMat = track(lowPolyMaterial(NEUTRAL_COLOR));
  const tail = new THREE.Mesh(track(new THREE.ConeGeometry(0.1, 0.28, 8)), tailMat);
  tail.position.set(0, BODY_RADIUS * 0.55, -BODY_RADIUS * 0.85);
  tail.rotation.x = Math.PI * 0.55;
  group.add(tail);

  // --- age 2+: arms and legs -----------------------------------------------
  const limbs = [];
  if (age >= 2) {
    const limbMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const armGeo = track(new THREE.CapsuleGeometry(0.058, 0.2, 4, 6));
    const legGeo = track(new THREE.CapsuleGeometry(0.072, 0.22, 4, 6));

    const armL = new THREE.Mesh(armGeo, limbMat);
    const armR = new THREE.Mesh(armGeo, limbMat);
    armL.position.set(-BODY_RADIUS * 0.92, BODY_RADIUS * 0.78, 0.02);
    armR.position.set(BODY_RADIUS * 0.92, BODY_RADIUS * 0.78, 0.02);
    armL.rotation.z = Math.PI * 0.12;
    armR.rotation.z = -Math.PI * 0.12;
    group.add(armL, armR);
    limbs.push(armL, armR);

    const legL = new THREE.Mesh(legGeo, limbMat);
    const legR = new THREE.Mesh(legGeo, limbMat);
    legL.position.set(-0.2, 0.11, 0.03);
    legR.position.set(0.2, 0.11, 0.03);
    group.add(legL, legR);
    limbs.push(legL, legR);
  }

  // --- age 3+: basic wings --------------------------------------------------
  let wings = [];
  if (age >= 3) {
    const wingMat = track(lowPolyMaterial(NEUTRAL_COLOR, { transparent: true, opacity: 0.9 }));
    const wingGeo = track(new THREE.ConeGeometry(0.22, 0.42, 3));

    const wingL = new THREE.Mesh(wingGeo, wingMat);
    const wingR = new THREE.Mesh(wingGeo, wingMat);
    wingL.scale.z = 0.12;
    wingR.scale.z = 0.12;
    wingL.position.set(-0.28, BODY_RADIUS * 1.05, -BODY_RADIUS * 0.5);
    wingR.position.set(0.28, BODY_RADIUS * 1.05, -BODY_RADIUS * 0.5);
    wingL.rotation.set(Math.PI * 0.5, 0, Math.PI * 0.32);
    wingR.rotation.set(Math.PI * 0.5, 0, -Math.PI * 0.32);
    group.add(wingL, wingR);
    wings = [wingL, wingR];
  }

  // --- element accessories: fire orb + nature sprout ------------------------
  const orbMat = track(new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.fire.color,
    emissive: ELEMENT_INFO.fire.accent,
    emissiveIntensity: 1,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const orb = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.09, 0)), orbMat);
  orb.position.set(0, head.position.y + 0.5, 0);
  orb.scale.setScalar(0.01);
  group.add(orb);

  const leafMat = track(new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.nature.color,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const leaf = new THREE.Mesh(track(new THREE.ConeGeometry(0.05, 0.16, 4)), leafMat);
  leaf.position.set(0, head.position.y + 0.42, 0);
  leaf.scale.setScalar(0.01);
  group.add(leaf);

  const skinMeshes = [body, head, tail, ...limbs, ...wings];
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

    // fire -> a small flame orb fades/grows in above the head.
    orb.material.opacity = Math.min(fire * 1.2, 1);
    orb.scale.setScalar(0.01 + fire * 0.85);

    // water -> wetter/glossier surface (lower roughness, slight sheen).
    for (const m of skinMeshes) {
      m.material.roughness = 0.7 - water * 0.55;
      m.material.metalness = 0.05 + water * 0.25;
    }

    // nature -> leaf sprout grows in from nothing (existing behavior).
    leaf.material.opacity = nature;
    leaf.scale.setScalar(0.01 + nature * 0.9);

    // speed -> aerodynamic: body/head stretch forward and taper.
    const stretch = 1 + speed * 0.5;
    const taper = 1 - speed * 0.2;
    body.scale.set(taper, 0.88, stretch);
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

    // fire orb: gentle bob + flicker, independent of the body bob above
    if (orb.material.opacity > 0.01) {
      orb.position.y = head.position.y + 0.5 + Math.sin(t * 3.2) * 0.025;
      orb.material.emissiveIntensity = 0.8 + Math.sin(t * 9) * 0.2;
    }

    // wings: idle flutter
    if (wings.length) {
      const flap = Math.sin(t * 2.2) * 0.15;
      wings[0].rotation.z = Math.PI * 0.32 + flap;
      wings[1].rotation.z = -Math.PI * 0.32 - flap;
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
