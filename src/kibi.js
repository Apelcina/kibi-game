import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ELEMENTS, ELEMENT_INFO, NEUTRAL_COLOR } from './traits.js';

// Builds one Kibi as a small hierarchy of low-poly primitives, then exposes
// applyTraits()/update() so traits (see traits.js) drive its look continuously
// instead of swapping to a different mesh per "evolution".
//
// Two structural params control the base silhouette, separate from traits:
//   age:   1 = a single primitive, no separate head/body yet — a ball that
//          rocks side to side in place. 2 = the real two-part head+body
//          silhouette appears, plus arms/legs. 3 currently adds nothing of
//          its own — wings used to auto-appear here but are now purely
//          driven by the fairy trait at any age (see applyTraits).
//   shape: 'sphere' | 'cube' — cube is shelved for now (not offered in the
//          UI, see traits.js) but primitiveGeometry() still supports it.
//
// From age 2 on, proportions are deliberately chibi: the head is the
// dominant mass and sits deep into the body (heavy overlap) so it reads as
// one soft blob with a big face, not two stacked primitives with a visible
// waist/neck seam.
//
// Design rule (per direct feedback): prefer deforming the ORIGINAL head
// vertices over bolting on new prop meshes wherever the effect is plausibly
// part of the head's own surface (quills, horns). New meshes are reserved
// for things that genuinely aren't part of the body — a held gem, a
// floating flame tongues, thorn spikes — or where a distinct (e.g. darker)
// accent color is needed that a shared-material vertex morph can't provide.

const SOLO_RADIUS = 0.4; // age-1 single-primitive size
const BODY_RADIUS = 0.3;
const HEAD_RADIUS = 0.38;
const BODY_Y = BODY_RADIUS * 0.85; // body center height; squash keeps its base near the ground
const HEAD_Y = 0.58; // overlaps the body for a chibi read, but leaves the body's
                      // sides/bottom clear so age-2 limbs have somewhere to attach
const ARM_BASE_SCALE = [1, 0.8, 0.95];
const LEG_BASE_SCALE = [0.82, 0.68, 1.05];
const ARM_PIVOT_BASE = [0.22, 0.27, 0.15];
const LEG_PIVOT_BASE = [0.14, 0.06, 0.11];

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

function primitiveGeometry(shape, radius, detail = 1) {
  if (shape === 'cube') {
    const size = radius * 1.6;
    return new RoundedBoxGeometry(size, size, size, 2, radius * 0.6); // heavily rounded — a soft cube, not a Lego block
  }
  return new THREE.IcosahedronGeometry(radius, detail); // detail 1: faceted but not chunky
}

// A flame "tongue": ONE continuous mesh, not two primitives glued together,
// and — per round-20 feedback that two separately-colored tongues looked
// "janky" — not two separate meshes either. This builds a single
// icosahedron, tapers each vertex's X/Z toward the top (bottom keeps full
// radius, top pinches to a point), and shifts the whole thing so its base
// sits exactly at local y=0 (an untouched icosahedron is CENTERED on y=0,
// so roughly half of it used to hang below the mount point — that's what
// was clipping into the head). Vertex colors blend from `baseColor` at the
// root to `tipColor` at the point, so the two-tone read comes from color
// gradient on one continuous surface instead of two separate shapes that
// have to visually align.
function flameTongueGeometry(radius, heightScale, taperAmount, baseColor, tipColor) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geo.attributes.position;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const range = maxY - minY;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const t = (y - minY) / range; // 0 at the base, 1 at the tip
    const taper = 1 - t * taperAmount;
    pos.setXYZ(i, x * taper, t * range * heightScale, z * taper); // base fixed at y=0, grows upward only
    c.copy(baseColor).lerp(tipColor, Math.min(t * 1.4, 1)); // tip color arrives a bit before the very point
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
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

export function createKibi({ age = 1, shape = 'sphere' } = {}) {
  const group = new THREE.Group();
  const disposables = [];
  const track = (obj) => {
    disposables.push(obj);
    return obj;
  };

  const isSolo = age === 1;

  // --- body + head ---------------------------------------------------------
  let body, head, headTopY, chestY, chestZ, backY, backZ;
  const headDetail = shape === 'sphere' ? 2 : 1;

  if (isSolo) {
    const soloMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const solo = new THREE.Mesh(track(primitiveGeometry(shape, SOLO_RADIUS, headDetail)), soloMat);
    solo.position.y = SOLO_RADIUS * 0.95;
    group.add(solo);
    body = solo;
    head = solo;
    headTopY = solo.position.y + SOLO_RADIUS;
    chestY = solo.position.y - SOLO_RADIUS * 0.4;
    chestZ = SOLO_RADIUS * 0.85;
    backY = solo.position.y;
    backZ = -SOLO_RADIUS * 0.9;
  } else {
    const bodyMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const bodyMesh = new THREE.Mesh(track(primitiveGeometry(shape, BODY_RADIUS)), bodyMat);
    bodyMesh.position.y = BODY_Y;
    bodyMesh.scale.y = 0.9;
    group.add(bodyMesh);

    const headMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const headMesh = new THREE.Mesh(track(primitiveGeometry(shape, HEAD_RADIUS, headDetail)), headMat);
    headMesh.position.y = HEAD_Y;
    group.add(headMesh);

    body = bodyMesh;
    head = headMesh;
    headTopY = HEAD_Y + HEAD_RADIUS;
    chestY = BODY_Y + 0.05;
    chestZ = BODY_RADIUS * 0.95;
    backY = BODY_Y + 0.02;
    backZ = -BODY_RADIUS * 1.05;
  }

  // --- head vertex morphs: speed quills, dark horns -------------------------
  // Pull/push a patch of the head's OWN vertices instead of attaching a new
  // mesh. Original positions are cached once; applyTraits() rebuilds the
  // buffer from that cache each call (never compounds).
  const headGeo = head.geometry;
  const headOriginalPos = headGeo.attributes.position.array.slice();
  const QUILL_DIRS = [
    new THREE.Vector3(0, 0.5, -0.87).normalize(),
    new THREE.Vector3(-0.85, 0.25, -0.35).normalize(),
    new THREE.Vector3(0.85, 0.25, -0.35).normalize(),
  ];
  // Horns used to be fire's second effect; moved to "dark" (devil-horn
  // imagery fits a dark/shadow theme better than fire, and fire is now
  // meant to stay a single clean effect — the flame).
  const HORN_DIRS = [
    new THREE.Vector3(-0.5, 0.78, 0.15).normalize(),
    new THREE.Vector3(0.5, 0.78, 0.15).normalize(),
  ];
  const canMorph = shape === 'sphere';
  const quillVerts = canMorph ? collectMorphRegion(headGeo, QUILL_DIRS, 0.9) : [];
  const hornVerts = canMorph ? collectMorphRegion(headGeo, HORN_DIRS, 0.93) : [];

  function applyHeadMorph(speedT, darkT) {
    const pos = headGeo.attributes.position;
    pos.array.set(headOriginalPos);
    const push = (entries, amount) => {
      for (const { index, weight, normal } of entries) {
        const d = amount * weight;
        pos.setXYZ(index, pos.getX(index) + normal.x * d, pos.getY(index) + normal.y * d, pos.getZ(index) + normal.z * d);
      }
    };
    push(quillVerts, 0.26 * speedT);
    push(hornVerts, 0.32 * darkT);
    pos.needsUpdate = true;
    headGeo.computeVertexNormals();
  }

  // --- eyes: smooth + glossy, contrasting with the faceted body -----------
  const eyeGeo = track(new THREE.SphereGeometry(0.075, 12, 10));
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
  const eyeL = makeEye(-0.16);
  const eyeR = makeEye(0.16);

  // --- tail (present from age 1, a Kibi staple) ----------------------------
  const tailMat = track(lowPolyMaterial(NEUTRAL_COLOR));
  const tail = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.09, 1)), tailMat);
  tail.scale.set(0.65, 0.65, 1.7); // shorter than the 2.4 that read as too long
  tail.position.set(0, backY - 0.05, backZ);
  tail.rotation.x = -Math.PI * 0.75;
  group.add(tail);

  // --- age 2+: arms and legs — soft embedded blobs, reaching forward -------
  const limbs = [];
  let armL, armR, legL, legR, armMeshL, armMeshR, legMeshL, legMeshR;
  if (age >= 2) {
    const limbMat = track(lowPolyMaterial(NEUTRAL_COLOR));
    const armGeo = track(new THREE.IcosahedronGeometry(0.12, 1));
    const legGeo = track(new THREE.IcosahedronGeometry(0.13, 2));

    function makeLimb(geo, pivotPos, scale) {
      const pivot = new THREE.Group();
      pivot.position.set(...pivotPos);
      const mesh = new THREE.Mesh(geo, limbMat);
      mesh.scale.set(...scale);
      pivot.add(mesh);
      group.add(pivot);
      limbs.push(mesh);
      return { pivot, mesh };
    }

    const armSideL = makeLimb(armGeo, ARM_PIVOT_BASE, ARM_BASE_SCALE);
    const armSideR = makeLimb(armGeo, [-ARM_PIVOT_BASE[0], ARM_PIVOT_BASE[1], ARM_PIVOT_BASE[2]], ARM_BASE_SCALE);
    const legSideL = makeLimb(legGeo, LEG_PIVOT_BASE, LEG_BASE_SCALE);
    const legSideR = makeLimb(legGeo, [-LEG_PIVOT_BASE[0], LEG_PIVOT_BASE[1], LEG_PIVOT_BASE[2]], LEG_BASE_SCALE);
    armL = armSideL.pivot; armR = armSideR.pivot;
    armMeshL = armSideL.mesh; armMeshR = armSideR.mesh;
    legL = legSideL.pivot; legR = legSideR.pivot;
    legMeshL = legSideL.mesh; legMeshR = legSideR.mesh;
  }

  // --- age 3+ (or fairy trait, any age): wings -------------------------------
  // Always built now — presence (opacity/scale) is driven in applyTraits by
  // max(age>=3 ? 1 : 0, fairyTrait), so age-3 still guarantees wings as
  // before, but the fairy trait can also grant them earlier, tinted pink.
  const wingBaseColor = 0xeaf6ff;
  const wingBaseEmissive = 0x8fc7e8;
  const wingMat = track(new THREE.MeshStandardMaterial({
    color: wingBaseColor,
    flatShading: true,
    transparent: true,
    opacity: 0,
    roughness: 0.3,
    emissive: wingBaseEmissive,
    emissiveIntensity: 0.25,
  }));
  const wingGeo = track(new THREE.ConeGeometry(0.22, 0.5, 3));
  const wingL = new THREE.Mesh(wingGeo, wingMat);
  const wingR = new THREE.Mesh(wingGeo, wingMat);
  const wingTilt = 0.28;
  wingL.position.set(-0.26, 0.36, -0.34);
  wingR.position.set(0.26, 0.36, -0.34);
  wingL.rotation.set(wingTilt, 0, Math.PI * 0.5);
  wingR.rotation.set(wingTilt, 0, -Math.PI * 0.5);
  wingL.scale.setScalar(0.01);
  wingR.scale.setScalar(0.01);
  group.add(wingL, wingR);
  const wings = [wingL, wingR];

  // --- element accessories ---------------------------------------------------
  // fire: ONE flame tongue (see flameTongueGeometry above), hovering just
  // above the head, centered. Two separate tongues (tried previously) read
  // as "janky" — two independently-flickering shapes never quite look like
  // one flame, even with no geometric seam between them. A single mesh
  // with a red-at-root-to-yellow-at-tip VERTEX COLOR gradient gets the
  // two-tone read without needing a second piece of geometry at all. The
  // base is pinned to local y=0 by the geometry builder (not centered like
  // a raw icosahedron), so raising flameBaseY a small amount above the
  // head's own top is enough to clear it with no overlap/clipping.
  const flameGroup = new THREE.Group();
  // `let`, not `const` — recomputed in applyTraits() as the ground trait
  // scales the head, so the flame's mount point rises with the head's
  // actual (currently-scaled) top surface instead of staying pinned to
  // where the head's top was at ground=0 and getting swallowed as the
  // head grows past it.
  let flameBaseY = headTopY + 0.03;
  flameGroup.position.set(0, flameBaseY, 0);
  const flameMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: ELEMENT_INFO.fire.color,
    emissiveIntensity: 0.5,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const flameColorBase = new THREE.Color(ELEMENT_INFO.fire.color);
  const flameColorTip = new THREE.Color(ELEMENT_INFO.fire.accent);
  const flame = new THREE.Mesh(track(flameTongueGeometry(0.09, 2.3, 0.82, flameColorBase, flameColorTip)), flameMat);
  flameGroup.add(flame);
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

  // nature: dark sharp thorn spikes — a real mesh, not a vertex morph,
  // because the darker accent color needs its own material (a
  // shared-material vertex displacement can't differ in color from the
  // skin it's part of).
  const thornColor = new THREE.Color(ELEMENT_INFO.nature.color).multiplyScalar(0.45);
  const thornMat = track(new THREE.MeshStandardMaterial({
    color: thornColor,
    emissive: thornColor,
    emissiveIntensity: 0.15,
    flatShading: true,
    transparent: true,
    opacity: 0,
    roughness: 0.6,
  }));
  // Round-18 feedback: bumped "ever so slightly" bigger again, and a
  // wider/further-out pair added at the base to reinforce a triangular
  // (wide base, narrow crown) spread across the back.
  const thornGeo = track(new THREE.ConeGeometry(0.078, 0.145, 5));
  const thorns = [];
  function makeThorn(parent, pos, quat, scale) {
    const t = new THREE.Mesh(thornGeo, thornMat);
    t.position.set(...pos);
    if (quat) t.quaternion.copy(quat);
    t.userData.baseScale = scale;
    parent.add(t);
    thorns.push(t);
    return t;
  }

  const torsoCenterY = body.position.y;
  const torsoRadius = isSolo ? SOLO_RADIUS : BODY_RADIUS;
  const upAxis = new THREE.Vector3(0, 1, 0);
  const spineSpecs = [
    { dir: new THREE.Vector3(0, 0.6, -0.7), s: 1 },
    { dir: new THREE.Vector3(0.32, 0.42, -0.78), s: 0.9 },
    { dir: new THREE.Vector3(-0.32, 0.42, -0.78), s: 0.9 },
    { dir: new THREE.Vector3(0.4, 0.12, -0.85), s: 0.85 },
    { dir: new THREE.Vector3(-0.4, 0.12, -0.85), s: 0.85 },
    { dir: new THREE.Vector3(0.22, -0.15, -0.9), s: 0.8 },
    { dir: new THREE.Vector3(-0.22, -0.15, -0.9), s: 0.8 },
    { dir: new THREE.Vector3(0.55, -0.02, -0.72), s: 0.85 }, // new wide-base pair —
    { dir: new THREE.Vector3(-0.55, -0.02, -0.72), s: 0.85 }, // triangle "corners"
  ];
  for (const spec of spineSpecs) {
    const d = spec.dir.clone().normalize();
    const embedDepth = torsoRadius * 0.9; // slightly inside the surface so it reads as rooted, not resting on top
    const pos = [d.x * embedDepth, torsoCenterY + d.y * embedDepth, d.z * embedDepth];
    const quat = new THREE.Quaternion().setFromUnitVectors(upAxis, d);
    makeThorn(group, pos, quat, spec.s);
  }
  // Arms (age 2+ only), in the pivot so they inherit the running-gait swing.
  // Round-18 feedback: the previous mostly-(-Z) direction placed them
  // geometrically INSIDE the torso's own ellipsoid at this arm position
  // (verified by hand: world position landed well within the body's
  // radius), which is why they were invisible/clipping rather than just
  // "hard to see." These directions lean hard toward +/-X (away from the
  // body's center, matching the outward side of each mirrored arm) as well
  // as back, which clears the torso.
  if (age >= 2) {
    const armRadius = 0.12;
    const armThornSpecs = [
      { dir: new THREE.Vector3(0.75, 0.15, -0.6), s: 1 },
      { dir: new THREE.Vector3(0.65, -0.25, -0.65), s: 0.8 },
    ];
    for (const { dir, s } of armThornSpecs) {
      const d = dir.clone().normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(upAxis, d);
      const posL = [d.x * armRadius * 1.15, d.y * armRadius * 1.15, d.z * armRadius * 1.15];
      makeThorn(armL, posL, quat, s);
      const dMirrored = new THREE.Vector3(-d.x, d.y, d.z);
      const quatR = new THREE.Quaternion().setFromUnitVectors(upAxis, dMirrored);
      const posR = [dMirrored.x * armRadius * 1.15, dMirrored.y * armRadius * 1.15, dMirrored.z * armRadius * 1.15];
      makeThorn(armR, posR, quatR, s);
    }
  }

  const skinMeshes = [body, head, tail, ...limbs, wingL, wingR];
  // Each part gets a POWER exponent, not a fixed delta. A higher exponent
  // exaggerates the gap between trait values (so a part with a high
  // exponent reads as "mostly the single strongest trait"); a lower
  // exponent flattens the gap (so a part with a low exponent reads as "a
  // fuller blend of everything that's actually fed"). The head leans
  // toward "pure dominant identity," the limbs toward "the full mix" —
  // that's the gradient down the body, without needing a hardcoded
  // top-2-only cutoff.
  const colorParts = isSolo
    ? [{ mesh: body, power: 1.8 }]
    : [{ mesh: body, power: 2.1 }, { mesh: head, power: 3.4 }];
  colorParts.push({ mesh: tail, power: 1.5 });
  for (const m of limbs) colorParts.push({ mesh: m, power: 1.15 });

  const blinkState = { timer: randomBlinkDelay(), blinking: false, phase: 0 };

  function applyTraits(traits) {
    // Power-weighted color blend, replacing an earlier "only the top 2
    // traits count, everything else is a capped accent" scheme that (per
    // direct feedback) effectively ignored a 3rd trait even at ~90% when
    // the other two were maxed. Every ACTIVE trait contributes here, but
    // weighted by value^power instead of value directly: raising each
    // value to a power > 1 exaggerates gaps between them, so a handful of
    // small "leftover" traits (e.g. 0.05 each) stay negligible — solving
    // the original "many weak traits muddy the color" problem — while
    // several genuinely strong traits (e.g. 100/100/90) all still carry
    // real, comparable weight instead of the weakest of the three being
    // capped into irrelevance.
    const entries = ELEMENTS.filter((el) => el !== 'fairy')
      .map((el) => ({ el, v: traits[el] ?? 0 }))
      .filter((e) => e.v > 0.001);
    const total = entries.reduce((s, e) => s + e.v, 0);
    const strength = Math.min(total, 1);
    const neutral = new THREE.Color(NEUTRAL_COLOR);

    function partColor(power) {
      if (entries.length === 0) return neutral.clone();
      const weighted = entries.map((e) => ({ el: e.el, w: Math.pow(e.v, power) }));
      const wsum = weighted.reduce((s, e) => s + e.w, 0) || 1;
      const c = new THREE.Color(0, 0, 0);
      for (const e of weighted) {
        c.add(new THREE.Color(ELEMENT_INFO[e.el].color).multiplyScalar(e.w / wsum));
      }
      c.lerp(neutral, 1 - strength);
      return c;
    }

    for (const { mesh, power } of colorParts) {
      const c = partColor(power);
      mesh.material.color.copy(c);
      mesh.material.emissive.copy(c);
      mesh.material.emissiveIntensity = strength * 0.3;
    }

    const fire = traits.fire ?? 0;
    const water = traits.water ?? 0;
    const nature = traits.nature ?? 0;
    const speed = traits.speed ?? 0;
    const fairy = traits.fairy ?? 0;
    const ground = traits.ground ?? 0;
    const dark = traits.dark ?? 0;

    // fire -> the flame grows in, centered above the head. (Horns moved
    // to "dark", see below — fire is just the flame now.)
    const fireT = Math.min(fire * 1.2, 1);
    flameMat.opacity = fireT;
    flameGroup.scale.setScalar(0.01 + fire * 1.1);

    // water -> wetter/glossier skin + a held gem fades in, AND (age 2+) the
    // feet flatten and flare into webbed flippers.
    for (const m of skinMeshes) {
      m.material.roughness = 0.7 - water * 0.55;
      m.material.metalness = 0.05 + water * 0.25;
    }
    gemMat.opacity = water;
    gem.scale.setScalar(0.01 + water * 1.1);

    // ground -> just bigger, like zooming in on the exact same model.
    // Two earlier attempts both overcorrected: a uniform-but-modest scale
    // read as "puffed up," and pushing height much harder than width to
    // compensate read as "weird, stretchy, out of proportion" (direct
    // feedback). The actual fix is simpler than either: ONE scale factor,
    // applied identically to every axis of every part — body, head, limb
    // meshes, AND limb attachment POINTS. Scaling positions by the same
    // factor as everything else is what makes this a true zoom rather than
    // "grow the mesh from a fixed skeleton": every distance in the rig
    // grows by the same ratio, so relationships that didn't overlap at
    // ground=0 (like the arms clearing the head) can't start overlapping
    // at any ground value either — it's mathematically the same shape,
    // just scaled, not a different shape.
    const bulk = 1 + ground * 0.35;
    if (isSolo) {
      body.scale.setScalar(bulk);
    } else {
      body.scale.set(bulk, 0.9 * bulk, bulk);
      head.scale.set(bulk, bulk, bulk);
    }
    if (armMeshL) {
      armMeshL.scale.set(ARM_BASE_SCALE[0] * bulk, ARM_BASE_SCALE[1] * bulk, ARM_BASE_SCALE[2] * bulk);
      armMeshR.scale.set(ARM_BASE_SCALE[0] * bulk, ARM_BASE_SCALE[1] * bulk, ARM_BASE_SCALE[2] * bulk);
      armL.position.set(ARM_PIVOT_BASE[0] * bulk, ARM_PIVOT_BASE[1] * bulk, ARM_PIVOT_BASE[2] * bulk);
      armR.position.set(-ARM_PIVOT_BASE[0] * bulk, ARM_PIVOT_BASE[1] * bulk, ARM_PIVOT_BASE[2] * bulk);
    }
    if (legMeshL) {
      const [sx, sy, sz] = LEG_BASE_SCALE;
      legMeshL.scale.set(sx * (1 + water * 0.55) * bulk, sy * (1 - water * 0.4) * bulk, sz * (1 + water * 0.7) * bulk);
      legMeshR.scale.set(sx * (1 + water * 0.55) * bulk, sy * (1 - water * 0.4) * bulk, sz * (1 + water * 0.7) * bulk);
      legL.position.set(LEG_PIVOT_BASE[0] * bulk, LEG_PIVOT_BASE[1] * bulk, LEG_PIVOT_BASE[2] * bulk);
      legR.position.set(-LEG_PIVOT_BASE[0] * bulk, LEG_PIVOT_BASE[1] * bulk, LEG_PIVOT_BASE[2] * bulk);
    }
    tail.scale.set(0.65 * bulk, 0.65 * bulk, 1.7 * bulk);
    // The flame and gem are mounted at fixed points computed from the
    // head's/body's UNSCALED radius at construction time — without this,
    // ground growing the head/body past those fixed points makes the flame
    // sink into the head and the gem sink into the chest at high ground
    // values (found in review). Recompute both anchors from the meshes'
    // actual current (scaled) surface each call: offset-from-center * bulk,
    // added back onto the center itself (which doesn't move, only scales).
    flameBaseY = head.position.y + (headTopY - head.position.y + 0.03) * bulk;
    gem.position.set(0, body.position.y + (chestY - body.position.y) * bulk, chestZ * bulk);

    // nature -> dark thorn spikes grow in along the spine (and arms, age 2+).
    thornMat.opacity = Math.min(nature * 1.2, 1);
    for (const th of thorns) th.scale.setScalar(0.01 + nature * (th.userData.baseScale ?? 1));

    // speed -> the head's own vertices at the back/crown pull outward into
    // swept quills (Sonic/Shadow-style). dark -> small devil horns pull
    // out of the head's own vertices near the temples (moved from fire).
    applyHeadMorph(speed, dark);

    // fairy -> wings, purely trait-driven now (they used to also appear
    // automatically at age 3+ regardless of fairy; feedback was that they
    // read as "permanently there," so age no longer grants them at all —
    // only the fairy trait does), tinted pink as the trait grows.
    const wingPresence = fairy;
    wingMat.opacity = 0.85 * wingPresence;
    const wingScale = 0.02 + wingPresence * 0.98;
    wingL.scale.set(wingScale, wingScale, 0.28 * wingScale);
    wingR.scale.set(wingScale, wingScale, 0.28 * wingScale);
    wingMat.color.set(wingBaseColor).lerp(new THREE.Color(ELEMENT_INFO.fairy.color), fairy);
    wingMat.emissive.set(wingBaseEmissive).lerp(new THREE.Color(ELEMENT_INFO.fairy.accent), fairy);
  }

  function update(dt, t) {
    if (isSolo) {
      // Rocks side to side in place with a squash on each "landing" — this
      // was the cube's flop animation; the cube shape itself is shelved for
      // now, but the motion reads well for the sphere too.
      const rockPhase = t * 1.15;
      group.rotation.z = Math.sin(rockPhase) * 0.55;
      const landing = Math.pow(Math.abs(Math.sin(rockPhase)), 8);
      group.scale.y = 1 - landing * 0.14;
      group.position.y = -landing * 0.018;
      group.position.x = 0;
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

    // fire flame: gentle flicker (scale wobble + slight sway + emissive
    // pulse), plus a slow float bob for the whole flame.
    if (flameMat.opacity > 0.01) {
      const flicker = 1 + Math.sin(t * 9) * 0.09;
      flame.scale.set(flicker, 1 + Math.sin(t * 6.5) * 0.14, flicker);
      flame.rotation.z = Math.sin(t * 3.1) * 0.1;
      flame.rotation.x = Math.sin(t * 2.4) * 0.06;
      flameMat.emissiveIntensity = 0.5 + Math.sin(t * 9) * 0.2;
      flameGroup.position.y = flameBaseY + Math.sin(t * 2.2) * 0.02;
    }

    // wings: idle flutter
    if (wingMat.opacity > 0.01) {
      const flap = Math.sin(t * 2.2) * 0.15;
      wingL.rotation.x = wingTilt + flap;
      wingR.rotation.x = wingTilt + flap;
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

  applyTraits({ fire: 0, water: 0, nature: 0, speed: 0, fairy: 0, ground: 0, dark: 0 });

  return { group, applyTraits, update, dispose };
}

function randomBlinkDelay() {
  return 2.5 + Math.random() * 3;
}
