import * as THREE from 'three';
import { ELEMENTS, ELEMENT_INFO, NEUTRAL_COLOR } from './traits.js';

// Builds one Chao as a small hierarchy of low-poly primitives, then exposes
// applyTraits()/update() so traits (see traits.js) drive its look continuously
// instead of swapping to a different mesh per "evolution". A real evolution
// later is just this same mapping pushed further, plus new accessory meshes
// (wings, webbed feet, ...) fading in the way the leaf accessory does here.

const BODY_RADIUS = 0.5;
const HEAD_RADIUS = 0.32;

function lowPolyMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.7,
    metalness: 0.05,
    emissive: 0x000000,
    emissiveIntensity: 0,
  });
}

export function createChao() {
  const group = new THREE.Group();

  // --- body + head -------------------------------------------------------
  const bodyGeo = new THREE.IcosahedronGeometry(BODY_RADIUS, 0);
  const bodyMat = lowPolyMaterial(NEUTRAL_COLOR);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = BODY_RADIUS * 0.95;
  body.scale.y = 0.85; // slightly squashed, less "ball"
  group.add(body);

  const headGeo = new THREE.IcosahedronGeometry(HEAD_RADIUS, 0);
  const headMat = lowPolyMaterial(NEUTRAL_COLOR);
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = BODY_RADIUS * 1.55;
  group.add(head);

  // --- eyes ----------------------------------------------------------------
  const eyeGeo = new THREE.SphereGeometry(0.055, 8, 6);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.3 });
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.13, head.position.y + 0.02, HEAD_RADIUS * 0.85);
  eyeR.position.set(0.13, head.position.y + 0.02, HEAD_RADIUS * 0.85);
  group.add(eyeL, eyeR);

  // --- ears (shape lerps with trait affinities) -----------------------------
  const earGeo = new THREE.ConeGeometry(0.09, 0.24, 6);
  const earMat = lowPolyMaterial(NEUTRAL_COLOR);
  const earL = new THREE.Mesh(earGeo, earMat);
  const earR = new THREE.Mesh(earGeo, earMat.clone());
  earL.position.set(-0.2, head.position.y + 0.28, -0.02);
  earR.position.set(0.2, head.position.y + 0.28, -0.02);
  earL.rotation.z = 0.35;
  earR.rotation.z = -0.35;
  group.add(earL, earR);

  // --- tail ------------------------------------------------------------
  const tailGeo = new THREE.ConeGeometry(0.1, 0.28, 6);
  const tailMat = lowPolyMaterial(NEUTRAL_COLOR);
  const tail = new THREE.Mesh(tailGeo, tailMat);
  tail.position.set(0, BODY_RADIUS * 0.55, -BODY_RADIUS * 0.85);
  tail.rotation.x = Math.PI * 0.55;
  group.add(tail);

  // --- nature accessory: leaf sprouts, grow in with nature affinity --------
  const leafGeo = new THREE.ConeGeometry(0.05, 0.16, 4);
  const leafMat = new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.nature.color,
    flatShading: true,
    transparent: true,
    opacity: 0,
  });
  const leaf = new THREE.Mesh(leafGeo, leafMat);
  leaf.position.set(0, head.position.y + 0.45, 0);
  leaf.scale.setScalar(0.01);
  group.add(leaf);

  const meshes = { body, head, earL, earR, tail, leaf };
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
      // Keep some neutral base mixed in so low totals stay pale, not saturated.
      const strength = Math.min(total, 1);
      blended.lerp(new THREE.Color(NEUTRAL_COLOR), 1 - strength);
    }

    for (const m of [body, head, earL, earR, tail]) {
      m.material.color.copy(blended);
      m.material.emissive.copy(blended);
      m.material.emissiveIntensity = Math.min(total, 1) * 0.35;
    }

    const fire = traits.fire ?? 0;
    const water = traits.water ?? 0;
    const nature = traits.nature ?? 0;

    // Fire -> taller, pointier ears. Water -> shorter, rounder ears.
    const earHeight = 1 + fire * 0.7 - water * 0.35;
    const earWidth = 1 - fire * 0.25 + water * 0.35;
    earL.scale.set(earWidth, earHeight, earWidth);
    earR.scale.set(earWidth, earHeight, earWidth);

    // Water -> tail elongates into a droplet.
    const tailStretch = 1 + water * 0.8;
    tail.scale.set(1, tailStretch, 1);

    // Nature -> leaf sprout grows in from nothing.
    leaf.material.opacity = nature;
    leaf.scale.setScalar(0.01 + nature * 0.9);
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
      blinkState.phase += dt / 0.12; // full blink takes ~0.12s
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
  }

  applyTraits({ fire: 0, water: 0, nature: 0 });

  return { group, meshes, applyTraits, update };
}

function randomBlinkDelay() {
  return 2.5 + Math.random() * 3;
}
