import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ELEMENTS, ELEMENT_INFO, NEUTRAL_COLOR } from './traits.js';

// Builds one Chao as a small hierarchy of low-poly primitives, then exposes
// applyTraits()/update() so traits (see traits.js) drive its look continuously
// instead of swapping to a different mesh per "evolution".
//
// Two structural params control the base silhouette, separate from traits:
//   age:   1 = a single primitive, no separate head/body yet — just a ball
//          (rolls) or a rounded cube (flops over). 2 = the real two-part
//          head+body silhouette appears, plus arms/legs. 3 = + wings.
//   shape: 'sphere' | 'cube' — which primitive family body/head (or the
//          age-1 solo blob) are built from. Ears are deliberately NOT part
//          of the base body — per design, those (and other animal features)
//          are meant to come from feeding animal-type items later, not from
//          age/element state.
//
// From age 2 on, proportions are deliberately chibi: the head is the
// dominant mass and sits deep into the body (heavy overlap) so it reads as
// one soft blob with a big face, not two stacked primitives with a visible
// waist/neck seam.
//
// Design rule (per direct feedback): prefer deforming the ORIGINAL head
// vertices over bolting on new prop meshes wherever the effect is plausibly
// part of the head's own surface (quills, horns, a mouth). New meshes are
// reserved for things that genuinely aren't part of the body — a held gem,
// a floating flame, a leaf sprout. See headMorph below.

const SOLO_RADIUS = 0.4; // age-1 single-primitive size
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

function primitiveGeometry(shape, radius) {
  if (shape === 'cube') {
    const size = radius * 1.6;
    return new RoundedBoxGeometry(size, size, size, 2, radius * 0.6); // heavily rounded — a soft cube, not a Lego block
  }
  return new THREE.IcosahedronGeometry(radius, 1); // detail 1: faceted but not chunky
}

// Finds the vertices of `geometry` whose direction from its own center is
// close to one of `dirs` (unit vectors), for pulling/pushing a patch of the
// original surface rather than attaching a new shape. Returns
// {index, weight, normal} — weight tapers 0→1 from the cone's edge to its
// center so the displacement blends into the surrounding surface instead of
// creating a hard crease.
function collectMorphRegion(geometry, dirs, threshold) {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  const entries = [];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    let best = -1;
    for (const dir of dirs) best = Math.max(best, n.dot(dir));
    if (best > threshold) {
      entries.push({ index: i, weight: (best - threshold) / (1 - threshold), normal: n });
    }
  }
  return entries;
}

export function createChao({ age = 1, shape = 'sphere' } = {}) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (obj) => {
    disposables.push(obj);
    return obj;
  };

  const isSolo = age === 1;

  // --- body + head ---------------------------------------------------------
  // Age 1: one primitive plays both roles (a ball or a rounded cube — no
  // head/body split yet). Age 2+: the real two-part chibi silhouette.
  let body, head, headTopY, chestY, chestZ, tailY, tailZ;
  if (isSolo) {
    const soloMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const solo = new THREE.Mesh(track(primitiveGeometry(shape, SOLO_RADIUS)), soloMat);
    solo.position.y = SOLO_RADIUS * 0.95;
    group.add(solo);
    body = solo;
    head = solo;
    headTopY = solo.position.y + SOLO_RADIUS;
    chestY = solo.position.y;
    chestZ = SOLO_RADIUS * 0.9;
    tailY = solo.position.y;
    tailZ = -SOLO_RADIUS * 1.05;
  } else {
    const bodyMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const bodyMesh = new THREE.Mesh(track(primitiveGeometry(shape, BODY_RADIUS)), bodyMat);
    bodyMesh.position.y = BODY_Y;
    bodyMesh.scale.y = 0.9;
    group.add(bodyMesh);

    const headMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const headMesh = new THREE.Mesh(track(primitiveGeometry(shape, HEAD_RADIUS)), headMat);
    headMesh.position.y = HEAD_Y;
    group.add(headMesh);

    body = bodyMesh;
    head = headMesh;
    headTopY = HEAD_Y + HEAD_RADIUS;
    chestY = BODY_Y + 0.05;
    chestZ = BODY_RADIUS * 0.95;
    tailY = BODY_Y + 0.02;
    tailZ = -BODY_RADIUS * 1.3;
  }

  // --- head vertex morphs: speed quills, fire horns, water mouth -----------
  // All three pull/push a small patch of the head's OWN vertices instead of
  // attaching a new mesh. Original positions are cached once; applyTraits()
  // rebuilds the buffer from that cache each call (never compounds).
  const headGeo = head.geometry;
  const headOriginalPos = headGeo.attributes.position.array.slice();
  const QUILL_DIRS = [
    new THREE.Vector3(0, 0.5, -0.87).normalize(),
    new THREE.Vector3(-0.68, 0.45, -0.58).normalize(),
    new THREE.Vector3(0.68, 0.45, -0.58).normalize(),
  ];
  const HORN_DIRS = [
    new THREE.Vector3(-0.55, 0.72, 0.2).normalize(),
    new THREE.Vector3(0.55, 0.72, 0.2).normalize(),
  ];
  const MOUTH_DIRS = [new THREE.Vector3(0, -0.3, 0.92).normalize()];
  const quillVerts = collectMorphRegion(headGeo, QUILL_DIRS, 0.9);
  const hornVerts = collectMorphRegion(headGeo, HORN_DIRS, 0.82);
  const mouthVerts = collectMorphRegion(headGeo, MOUTH_DIRS, 0.72);

  function applyHeadMorph(speedT, fireT, waterT) {
    const pos = headGeo.attributes.position;
    pos.array.set(headOriginalPos);

    const push = (entries, amount) => {
      for (const { index, weight, normal } of entries) {
        const d = amount * weight;
        pos.setXYZ(
          index,
          pos.getX(index) + normal.x * d,
          pos.getY(index) + normal.y * d,
          pos.getZ(index) + normal.z * d,
        );
      }
    };
    push(quillVerts, 0.26 * speedT); // pulled outward: swept-back hair spikes
    push(hornVerts, 0.15 * fireT); // pulled outward: small devil horns
    push(mouthVerts, -0.08 * waterT); // pushed inward: a hint of an open mouth

    pos.needsUpdate = true;
    headGeo.computeVertexNormals();
  }

  // --- eyes: smooth + glossy, contrasting with the faceted body -----------
  // Children of `head` (not `group`) so they scale/move with it — keeps them
  // pinned to the face surface if the head is ever non-uniformly scaled,
  // instead of clipping into or floating off the mesh.
  const eyeRadius = isSolo ? 0.075 : 0.08;
  const eyeGeo = track(new THREE.SphereGeometry(eyeRadius, 12, 10));
  const eyeMat = track(new THREE.MeshStandardMaterial({ color: 0x171512, roughness: 0.25 }));
  const highlightGeo = track(new THREE.SphereGeometry(0.026, 8, 6));
  const highlightMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, emissive: 0x333333 }));

  const headRadiusForEyes = isSolo ? SOLO_RADIUS : HEAD_RADIUS;
  function makeEye(x) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(x, 0.05, headRadiusForEyes * 0.82);
    const highlight = new THREE.Mesh(highlightGeo, highlightMat);
    highlight.position.set(-0.024 * Math.sign(x || 1), 0.03, 0.05);
    eye.add(highlight);
    head.add(eye);
    return eye;
  }
  const eyeSpread = isSolo ? 0.16 : 0.17;
  const eyeL = makeEye(-eyeSpread);
  const eyeR = makeEye(eyeSpread);

  // --- tail (present from age 1, a Chao staple) ----------------------------
  // A smooth oblong capsule, not a pointed cone — matches the "oblong, not
  // pointy/blocky" direction the limbs also moved to.
  const tailMat = track(lowPolyMaterial(NEUTRAL_COLOR));
  const tail = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.075, 0.15, 4, 8)), tailMat);
  tail.position.set(0, tailY, tailZ);
  tail.rotation.x = Math.PI * 0.55;
  group.add(tail);

  // --- age 2+: arms and legs — smooth oblong, reaching forward -------------
  // Capsules (rounded caps at both ends), not tapered cones/cylinders — a
  // point or a flat cap both read as "blocky"/"weapon-like" per feedback.
  // Held in a pivot Group at the shoulder/hip so update() can swing the limb
  // from its joint without fighting the mesh's own fixed forward-reach tilt.
  const limbs = [];
  let armL, armR, legL, legR;
  if (age >= 2) {
    const limbMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const armGeo = track(new THREE.CapsuleGeometry(0.08, 0.3, 4, 8));
    const legGeo = track(new THREE.CapsuleGeometry(0.09, 0.26, 4, 8));

    function makeLimb(geo, pivotPos, rot) {
      const pivot = new THREE.Group();
      pivot.position.set(...pivotPos);
      const mesh = new THREE.Mesh(geo, limbMat);
      mesh.rotation.set(...rot);
      pivot.add(mesh);
      group.add(pivot);
      limbs.push(mesh);
      return pivot;
    }

    // Capsule's local height axis (Y) rotated ~90° about X points forward
    // (+Z); a partial tilt keeps the base embedded in the body while the
    // rounded far end reaches out ahead instead of just to the side.
    armL = makeLimb(armGeo, [0.22, 0.27, 0.1], [Math.PI * 0.42, 0, 0.3]);
    armR = makeLimb(armGeo, [-0.22, 0.27, 0.1], [Math.PI * 0.42, 0, -0.3]);
    legL = makeLimb(legGeo, [0.15, 0.07, 0.08], [Math.PI * 0.4, 0, 0.15]);
    legR = makeLimb(legGeo, [-0.15, 0.07, 0.08], [Math.PI * 0.4, 0, -0.15]);
  }

  // --- age 3+: basic wings ---------------------------------------------------
  // Own accent material (not the shared skin tint) and thick enough to read
  // as a wing rather than a sliver, mounted clear of the head sphere so
  // they don't read as spikes piercing the skull, oriented so the wide
  // triangular face (not its thin edge) is what the front-3/4 camera sees.
  let wings = [];
  let wingTilt = 0;
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
    const wingGeo = track(new THREE.ConeGeometry(0.22, 0.5, 3));

    const wingL = new THREE.Mesh(wingGeo, wingMat);
    const wingR = new THREE.Mesh(wingGeo, wingMat);
    wingL.scale.z = 0.28;
    wingR.scale.z = 0.28;
    wingL.position.set(-0.26, 0.36, -0.34);
    wingR.position.set(0.26, 0.36, -0.34);
    wingTilt = 0.28; // base up/back tilt, layered with the idle flutter in update()
    wingL.rotation.set(wingTilt, 0, Math.PI * 0.5);
    wingR.rotation.set(wingTilt, 0, -Math.PI * 0.5);
    group.add(wingL, wingR);
    wings = [wingL, wingR];
  }

  // --- element accessories: still separate meshes for things that plausibly
  // aren't part of the head's own surface --------------------------------
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

  // water: a small held/worn gem — bright white-cyan + strong emissive so
  // it pops against water-blue-tinted skin instead of blending into it.
  const gemMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0x8fe0ff,
    emissiveIntensity: 0.9,
    roughness: 0.05,
    metalness: 0.6,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const gem = new THREE.Mesh(track(new THREE.OctahedronGeometry(0.11, 0)), gemMat);
  gem.position.set(0, chestY, chestZ);
  gem.scale.setScalar(0.01);
  group.add(gem);

  // nature: a leaf blade sprouting from the head. The cone's local X/Y stay
  // full-size (its front-view silhouette: a full-width triangle) and only
  // local Z is flattened — Z is the camera's line-of-sight axis, so the
  // *thin* dimension points away from the viewer and the *wide* dimension
  // (X) is what actually reads on screen.
  const leafMat = track(new THREE.MeshStandardMaterial({
    color: ELEMENT_INFO.nature.color,
    flatShading: true,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
  }));
  const leaf = new THREE.Mesh(track(new THREE.ConeGeometry(0.08, 0.2, 4)), leafMat);
  leaf.position.set(0.09, headTopY - 0.05, 0);
  leaf.rotation.z = -0.3;
  leaf.scale.set(1, 1, 0.22);
  leaf.scale.multiplyScalar(0.01);
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

    // fire -> flame grows in, anchored at the head, AND small horns pull out
    // of the head's own vertices near the temples.
    const fireT = Math.min(fire * 1.2, 1);
    flameOuterMat.opacity = fireT;
    flameInnerMat.opacity = fireT;
    flameGroup.scale.setScalar(0.01 + fire * 1.1);

    // water -> wetter/glossier skin + a held gem fades in, AND the head's
    // own vertices dimple inward near the lower face — a hint of a mouth.
    for (const m of skinMeshes) {
      m.material.roughness = 0.7 - water * 0.55;
      m.material.metalness = 0.05 + water * 0.25;
    }
    gemMat.opacity = water;
    gem.scale.setScalar(0.01 + water * 1.1);

    // nature -> leaf blade grows in from nothing.
    leafMat.opacity = nature;
    leaf.scale.set(1, 1, 0.22).multiplyScalar(0.01 + nature * 1.1);

    // speed -> the head's own vertices at the back/crown pull outward into
    // swept quills (Sonic/Shadow-style) instead of a separate mesh.
    applyHeadMorph(speed, fire, water);
  }

  function update(dt, t) {
    if (isSolo) {
      if (shape === 'sphere') {
        // rolling: rocks back and forth in place, rotation tied to the same
        // phase as the position sway so it reads as true rolling (not a
        // free spin that would turn the face away from camera most of the
        // time — capped well under a full turn so the eyes stay legible).
        const rollPhase = t * 0.9;
        group.position.x = Math.sin(rollPhase) * 0.16;
        body.rotation.x = Math.sin(rollPhase) * 0.18;
        group.position.y = Math.abs(Math.sin(rollPhase * 2)) * 0.015;
        group.rotation.y = 0;
      } else {
        // flopping cube: rock side to side, dipping/squashing at each "landing"
        const flopPhase = t * 1.15;
        group.rotation.z = Math.sin(flopPhase) * 0.55;
        const landing = Math.pow(Math.abs(Math.sin(flopPhase)), 8);
        group.scale.y = 1 - landing * 0.14;
        group.position.y = -landing * 0.018;
        group.position.x = 0;
      }
    } else {
      // idle bob
      group.position.y = Math.sin(t * 1.6) * 0.035;
      group.rotation.y = Math.sin(t * 0.5) * 0.12;
      group.position.x = 0;
      group.rotation.z = 0;
      group.scale.y = 1;
    }

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

    // wings: idle flutter (rotation.x — rotation.z holds the fixed outward mount angle)
    if (wings.length) {
      const flap = Math.sin(t * 2.2) * 0.15;
      wings[0].rotation.x = wingTilt + flap;
      wings[1].rotation.x = wingTilt + flap;
    }

    // age 2+: running-in-place gait — legs swing, opposite arm swings with
    // each leg (contralateral, like a real trot), body/head bounce twice
    // per stride (once per footfall) layered on top of the idle bob.
    if (legL) {
      const runPhase = t * 6.5;
      const legSwing = 0.55;
      const armSwing = 0.4;
      legL.rotation.x = Math.sin(runPhase) * legSwing;
      legR.rotation.x = Math.sin(runPhase + Math.PI) * legSwing;
      armL.rotation.x = Math.sin(runPhase + Math.PI) * armSwing;
      armR.rotation.x = Math.sin(runPhase) * armSwing;

      const footfall = Math.abs(Math.sin(runPhase));
      group.position.y += footfall * 0.02;
      head.rotation.x = footfall * 0.05 - 0.02;
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
