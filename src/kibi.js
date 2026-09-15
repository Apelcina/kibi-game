import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ELEMENTS, ELEMENT_INFO, NEUTRAL_COLOR, MAJOR_ELEMENTS, MINOR_ELEMENTS, MISC_ELEMENTS } from './traits.js';

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
const BODY_RADIUS = 0.24; // experimenting with a smaller body (was 0.3) — head stays the
                           // same size, so this also exaggerates the big-head chibi look
const HEAD_RADIUS = 0.38;
const BODY_SQUASH_Y = 0.9; // body's own vertical squash scale
// Body center height, solved so its bottom (BODY_Y - BODY_RADIUS*BODY_SQUASH_Y)
// sits just above y=0 instead of clipping below it — the previous *0.85 left
// the bottom ~0.015 below ground, which became visible ("butt sits below his
// feet") once the legs' own ground-clip was fixed to sit exactly at y=0.
const BODY_Y = BODY_RADIUS * BODY_SQUASH_Y + 0.02;
const HEAD_Y = 0.58; // overlaps the body for a chibi read, but leaves the body's
                      // sides/bottom clear so age-2 limbs have somewhere to attach
// Arms: Y (2nd component) is the long axis now, not Z — per feedback, arms
// reaching forward read wrong; they hang DOWN at Kibi's sides instead (see
// armMeshOffset below, which shifts the mesh down from the shoulder pivot
// so it hangs from it rather than being centered on it). ARM_PIVOT_BASE's
// z also pulled back toward the body's side (was 0.15) to match.
// Legs: z (3rd component, forward/back) is still bumped up from the
// original 1.05 so legs reach further (per earlier feedback: "too stubby,
// he couldn't reach anything") — walking legs are supposed to swing
// forward/back, unlike arms. The matching mesh.position.z offset applied
// in makeLimb() below keeps the BACK edge where it was and puts all of
// that added length on the front.
const ARM_BASE_SCALE = [0.9, 1.2, 0.8];
const LEG_BASE_SCALE = [0.82, 0.68, 1.25];
const ARM_PIVOT_BASE = [0.22, 0.27, 0.06];
const ARM_RADIUS = 0.12; // must match armGeo's IcosahedronGeometry radius below
const LEG_RADIUS = 0.13; // must match legGeo's IcosahedronGeometry radius below
// Leg pivot Y solved so the leg's BOTTOM edge sits exactly at y=0 (ground
// level) given the mesh is centered on its pivot with no Y offset — the
// previous hand-picked 0.06 left the leg bottom ~0.03 below y=0 (visibly
// clipping into the ground, worse once legs got longer).
const LEG_PIVOT_BASE = [0.14, LEG_RADIUS * LEG_BASE_SCALE[1], 0.11];

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
    vertexColors: opts.vertexColors ?? false,
  });
}

// Ensures `geometry` has a per-vertex 'color' attribute to paint into (added
// lazily — same lazy-init idea as the flame's, but here the values get
// overwritten every applyTraits() call instead of once at construction).
function ensureVertexColorAttribute(geometry) {
  let attr = geometry.attributes.color;
  if (!attr) {
    attr = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3);
    geometry.setAttribute('color', attr);
  }
  return attr;
}

// Paints colorA/colorB across `mesh`'s OWN local geometry along `axis` — but
// NOT as one long 0->1 blend (that read as a wide, muddy wash of the
// in-between color across most of the surface, per direct feedback). Real
// character design reads as mostly ONE clear color (the back/majority) with
// a SHORT, soft accent patch of the second color near the other end (a
// belly, toes, the front of a face/arm) — so colorA holds solid across most
// of the range, and only the last FRONT_BAND fraction eases into colorB,
// with a smoothstep curve so that short transition itself is soft-edged
// rather than a hard seam.
const FRONT_BAND = 0.4;
function applyGradientColors(mesh, axis, colorA, colorB) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const colorAttr = ensureVertexColorAttribute(geo);
  const get = axis === 'x' ? (i) => pos.getX(i) : axis === 'z' ? (i) => pos.getZ(i) : (i) => pos.getY(i);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const v = get(i);
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const bandStart = 1 - FRONT_BAND;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = (get(i) - min) / range;
    let et = t <= bandStart ? 0 : (t - bandStart) / FRONT_BAND;
    et = et * et * (3 - 2 * et); // smoothstep: soft edges on the short transition itself
    c.copy(colorA).lerp(colorB, et);
    colorAttr.setXYZ(i, c.r, c.g, c.b);
  }
  colorAttr.needsUpdate = true;
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
    // Base color left white — the actual look comes entirely from the
    // per-vertex gradient painted in applyTraits (see applyGradientColors),
    // same as the flame's vertex-color gradient.
    const soloMat = track(lowPolyMaterial(0xffffff, { vertexColors: true }));
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
    const bodyMat = track(lowPolyMaterial(0xffffff, { vertexColors: true }));
    const bodyMesh = new THREE.Mesh(track(primitiveGeometry(shape, BODY_RADIUS)), bodyMat);
    bodyMesh.position.y = BODY_Y;
    bodyMesh.scale.y = BODY_SQUASH_Y;
    group.add(bodyMesh);

    const headMat = track(lowPolyMaterial(0xffffff, { vertexColors: true }));
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

  // Frozen construction-time y positions — the reference "zero lift" heights
  // that ground's ramp-up lifts away from. Everything anchored to the body
  // or head (tail, gem, thorns, wings, flame) computes its offset from
  // THESE, not from the live (possibly lifted) position, so lift and zoom
  // don't get double-counted into those offsets.
  const bodyBaseY = body.position.y;
  const headBaseY = head.position.y;

  // --- head vertex morphs: lightning quills, dark horns ---------------------
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

  function applyHeadMorph(lightningT, darkT) {
    const pos = headGeo.attributes.position;
    pos.array.set(headOriginalPos);
    const push = (entries, amount) => {
      for (const { index, weight, normal } of entries) {
        const d = amount * weight;
        pos.setXYZ(index, pos.getX(index) + normal.x * d, pos.getY(index) + normal.y * d, pos.getZ(index) + normal.z * d);
      }
    };
    push(quillVerts, 0.26 * lightningT);
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
  const tailMat = track(lowPolyMaterial(0xffffff, { vertexColors: true }));
  const tail = new THREE.Mesh(track(new THREE.IcosahedronGeometry(0.09, 1)), tailMat);
  tail.scale.set(0.65, 0.65, 1.7); // shorter than the 2.4 that read as too long
  const tailBaseY = backY - 0.05;
  const tailBaseZ = backZ;
  tail.position.set(0, tailBaseY, tailBaseZ);
  tail.rotation.x = -Math.PI * 0.75;
  group.add(tail);

  // --- age 2+: arms and legs — soft embedded blobs, reaching forward -------
  const limbs = [];
  let armL, armR, legL, legR, armMeshL, armMeshR, legMeshL, legMeshR;
  if (age >= 2) {
    const limbMat = track(lowPolyMaterial(0xffffff, { vertexColors: true }));
    const armGeo = track(new THREE.IcosahedronGeometry(ARM_RADIUS, 1));
    const legGeo = track(new THREE.IcosahedronGeometry(LEG_RADIUS, 2));

    // meshOffset shifts the mesh WITHIN its pivot's local space — the pivot
    // itself (the swing/rotation center) never moves. Used for:
    //  - arms hanging by the side: the mesh is shifted DOWN from the
    //    shoulder pivot so the arm hangs from it (like a real shoulder
    //    joint) instead of being centered on it (which made half the arm
    //    stick out ABOVE the shoulder).
    //  - leg forward reach: since LEG_BASE_SCALE's z got bigger, offsetting
    //    the mesh forward by the added half-length keeps the BACK edge
    //    where it was and puts the growth entirely on the front.
    //  - leg pivot, nudged toward the back (per feedback on the swing
    //    animation pivoting around dead center): a small extra +z pushes
    //    the effective pivot slightly behind the leg's own center.
    // Note: unlike the ground-scaling anchor fixes elsewhere in this file,
    // these offsets are NOT re-anchored against `bulk` each applyTraits()
    // call — they're small enough that the drift at high ground values is
    // negligible, so a one-time offset at construction is enough here.
    function makeLimb(geo, pivotPos, scale, meshOffset = [0, 0, 0]) {
      const pivot = new THREE.Group();
      pivot.position.set(...pivotPos);
      const mesh = new THREE.Mesh(geo, limbMat);
      mesh.scale.set(...scale);
      mesh.position.set(...meshOffset);
      pivot.add(mesh);
      group.add(pivot);
      limbs.push(mesh);
      return { pivot, mesh };
    }

    const armMeshOffset = [0, -ARM_RADIUS * ARM_BASE_SCALE[1] * 0.55, 0];
    const legForwardOffset = LEG_RADIUS * (LEG_BASE_SCALE[2] - 1.05);
    const legMeshOffset = [0, 0, 0.02 + legForwardOffset];

    const armSideL = makeLimb(armGeo, ARM_PIVOT_BASE, ARM_BASE_SCALE, armMeshOffset);
    const armSideR = makeLimb(armGeo, [-ARM_PIVOT_BASE[0], ARM_PIVOT_BASE[1], ARM_PIVOT_BASE[2]], ARM_BASE_SCALE, armMeshOffset);
    const legSideL = makeLimb(legGeo, LEG_PIVOT_BASE, LEG_BASE_SCALE, legMeshOffset);
    const legSideR = makeLimb(legGeo, [-LEG_PIVOT_BASE[0], LEG_PIVOT_BASE[1], LEG_PIVOT_BASE[2]], LEG_BASE_SCALE, legMeshOffset);
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
  const wingBaseX = 0.26;
  const wingBaseY = 0.36;
  const wingBaseZ = -0.34;
  wingL.position.set(-wingBaseX, wingBaseY, wingBaseZ);
  wingR.position.set(wingBaseX, wingBaseY, wingBaseZ);
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
  const flame = new THREE.Mesh(track(flameTongueGeometry(0.09, 2.0, 0.82, flameColorBase, flameColorTip)), flameMat);
  flameGroup.add(flame);
  flameGroup.scale.setScalar(0.01);
  group.add(flameGroup);

  // Two smaller companion flames, angled outward to either side of the main
  // tongue. They stay hidden until the main flame is most of the way to its
  // own full size (fire >= SIDE_FLAME_THRESHOLD), then grow/fade in over the
  // rest of fire's range — reinforcing "this is becoming a bigger blaze" at
  // high fire rather than the single tongue just topping out. Each gets its
  // own little group (growth scale, set in applyTraits, + the fixed outward
  // tilt) wrapping the actual mesh (flicker wobble only, set in update()) —
  // same growth/flicker separation as flameGroup/flame above.
  const SIDE_FLAME_THRESHOLD = 0.75;
  const SIDE_FLAME_X = 0.08;
  const SIDE_FLAME_TILT = 0.35;
  const sideFlameMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    emissive: ELEMENT_INFO.fire.color,
    emissiveIntensity: 0.5,
    flatShading: true,
    transparent: true,
    opacity: 0,
  }));
  const sideFlameGeo = track(flameTongueGeometry(0.055, 1.6, 0.82, flameColorBase, flameColorTip));
  const sideFlameGroupL = new THREE.Group();
  const sideFlameGroupR = new THREE.Group();
  sideFlameGroupL.position.set(-SIDE_FLAME_X, 0, 0);
  sideFlameGroupR.position.set(SIDE_FLAME_X, 0, 0);
  sideFlameGroupL.rotation.z = SIDE_FLAME_TILT; // leans further left/outward
  sideFlameGroupR.rotation.z = -SIDE_FLAME_TILT; // leans further right/outward
  sideFlameGroupL.scale.setScalar(0.01);
  sideFlameGroupR.scale.setScalar(0.01);
  const sideFlameL = new THREE.Mesh(sideFlameGeo, sideFlameMat);
  const sideFlameR = new THREE.Mesh(sideFlameGeo, sideFlameMat);
  sideFlameGroupL.add(sideFlameL);
  sideFlameGroupR.add(sideFlameR);
  flameGroup.add(sideFlameGroupL, sideFlameGroupR);

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
  function makeThorn(parent, pos, quat, scale, kind) {
    const t = new THREE.Mesh(thornGeo, thornMat);
    t.position.set(...pos);
    if (quat) t.quaternion.copy(quat);
    t.userData.baseScale = scale;
    // basePos/kind: same anchor-tracking need the flame/gem had — these
    // are positioned once at construction from an unscaled torso/arm
    // radius, so without this they'd sink into the body as ground grows
    // it (found in review). Re-applied every applyTraits() call below.
    t.userData.basePos = pos;
    t.userData.kind = kind;
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
    makeThorn(group, pos, quat, spec.s, 'spine');
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
      makeThorn(armL, posL, quat, s, 'arm');
      const dMirrored = new THREE.Vector3(-d.x, d.y, d.z);
      const quatR = new THREE.Quaternion().setFromUnitVectors(upAxis, dMirrored);
      const posR = [dMirrored.x * armRadius * 1.15, dMirrored.y * armRadius * 1.15, dMirrored.z * armRadius * 1.15];
      makeThorn(armR, posR, quatR, s, 'arm');
    }
  }

  const skinMeshes = [body, head, tail, ...limbs, wingL, wingR];
  // Each body part gets its own two-color gradient painted across its OWN
  // local geometry (the "banana/apple" look — see applyGradientColors).
  // `axis` picks which local axis the gradient runs along: z (back-to-front)
  // for body/head/limbs, matching the existing +z-is-front convention used
  // elsewhere (eyes/chestZ/gemZ are all positive z) — this is what gives the
  // "soft belly/face/front-of-arm" accent-patch read, back stays the solid
  // dominant color. The tail keeps its own local z too (its length axis,
  // base to tip, unrelated to the body's front/back). armMeshL/legMeshL are
  // each other's mirror and SHARE one geometry with their R counterpart (see
  // makeLimb/armGeo/legGeo above), so painting the L mesh's geometry already
  // paints R too — only one entry per geometry is needed here, not one per
  // mesh.
  const gradientParts = isSolo ? [{ mesh: body, axis: 'z' }] : [{ mesh: body, axis: 'z' }, { mesh: head, axis: 'z' }];
  gradientParts.push({ mesh: tail, axis: 'z' });
  if (armMeshL) gradientParts.push({ mesh: armMeshL, axis: 'z' });
  if (legMeshL) gradientParts.push({ mesh: legMeshL, axis: 'z' });

  const blinkState = { timer: randomBlinkDelay(), blinking: false, phase: 0 };
  let bulk = 1; // current ground "zoom" factor — computed in the ground block below,
                // but referenced later (wings) too, so it's hoisted to function scope
  // Accumulated (not wall-clock) phase for the solo rock — dt-integrated so
  // switching its speed (idle vs walking, see update()) changes the RATE
  // smoothly without a jump, unlike `t * speed` which would snap to a
  // different absolute phase the instant the speed constant changes.
  let rockPhaseAccum = 0;
  const ROCK_IDLE_SPEED = 1.15;
  const ROCK_WALK_SPEED = 4; // faster — per feedback, was the same rate whether
                              // idling or actually traveling, which didn't read
                              // as matching how fast Kibi was covering ground

  function applyTraits(traits) {
    // Two-color scheme, FIXED category membership rather than rank. Two
    // earlier versions both tied slot membership to relative trait VALUE
    // (top-2 by rank, then a fully continuous value-weighted version) — and
    // both had a real problem: whenever which color counted as "dominant"
    // depends on comparing values, two traits being close in value forces a
    // choice between a discrete identity swap (rank version) or a genuinely
    // muddy blend across a wide near-tie zone (continuous version), because
    // there's no principled tiebreak based on value alone.
    // Fixed instead: every element has a PERMANENT slot, decided by what it
    // is, not by how strong it currently is (MAJOR_ELEMENTS/MINOR_ELEMENTS,
    // shared with main.js's panel grouping — see traits.js). Nothing here
    // ever compares one trait's value against another's to decide
    // membership, so there is no crossover to snap at: each slot is just a
    // continuous weighted blend of its OWN fixed members, which shifts
    // smoothly as those specific values change.
    const CATEGORY_POWER = 1.6; // within a slot, still lean toward that
                                 // slot's own strongest active member rather
                                 // than a flat average of its whole category.

    const total = ELEMENTS.filter((el) => !MISC_ELEMENTS.includes(el)).reduce((s, el) => s + (traits[el] ?? 0), 0);
    const strength = Math.min(total, 1);
    const neutral = new THREE.Color(NEUTRAL_COLOR);

    // categoryBlend returns the category's "pure" hue (its members' weighted
    // blend, ignoring how small their values are — same continuous mixing as
    // before) PLUS a separate `presence` (0..1, this category's own total
    // value). Keeping these separate is what fixes the snap: a category with
    // one newly-active member used to jump straight from "absent" to "100%
    // represented" the instant that member crossed the 0.001 threshold,
    // because the weighted average normalizes to 1 even for a single tiny
    // value. `presence` now scales how much that pure hue actually shows,
    // so a trait fading in from 0 fades its category's color in with it.
    function categoryBlend(elementList) {
      const active = elementList.map((el) => ({ el, v: traits[el] ?? 0 })).filter((e) => e.v > 0.001);
      const presence = Math.min(active.reduce((s, e) => s + e.v, 0), 1);
      let pure = null;
      if (active.length > 0) {
        const weighted = active.map((e) => ({ c: new THREE.Color(ELEMENT_INFO[e.el].color), w: Math.pow(e.v, CATEGORY_POWER) }));
        const wsum = weighted.reduce((s, e) => s + e.w, 0) || 1;
        pure = new THREE.Color(0, 0, 0);
        for (const e of weighted) pure.add(e.c.multiplyScalar(e.w / wsum));
      }
      return { pure, presence };
    }

    const back = categoryBlend(MAJOR_ELEMENTS);
    const front = categoryBlend(MINOR_ELEMENTS);
    // Each side's "not there yet" identity is a tint of the OTHER side's
    // pure hue (or neutral if that's empty too) — same fallback idea as
    // before, but now it's the LERP START POINT rather than a hard swap:
    // colorA/colorB ease from this fallback toward their own pure hue as
    // their own category's presence rises from 0, instead of snapping.
    const backFallback = front.pure ? front.pure.clone().lerp(new THREE.Color(0x000000), 0.25) : neutral.clone();
    const frontFallback = back.pure ? back.pure.clone().lerp(new THREE.Color(0xffffff), 0.4) : neutral.clone();
    const colorA = backFallback.clone().lerp(back.pure ?? backFallback, back.presence);
    const colorB = frontFallback.clone().lerp(front.pure ?? frontFallback, front.presence);
    colorA.lerp(neutral, 1 - strength);
    colorB.lerp(neutral, 1 - strength);

    // No uniform emissive tint on the gradient parts (there used to be one,
    // colored by the blended trait color): a material's emissive is ONE
    // flat color for the whole mesh, so tinting it toward either colorA or
    // colorB washes that same tint over BOTH ends of the gradient, muddying
    // whichever color it isn't — e.g. a red emissive glow pushed the blue
    // "front" accent toward magenta, and a 50/50-averaged glow did the same
    // to both ends at once. The vertex-painted gradient itself is left to
    // read on its own, at full clarity, with no added tint.

    const fire = traits.fire ?? 0;
    const water = traits.water ?? 0;
    const ice = traits.ice ?? 0;
    const nature = traits.nature ?? 0;
    const lightning = traits.lightning ?? 0;
    const fairy = traits.fairy ?? 0;
    const ground = traits.ground ?? 0;
    const dark = traits.dark ?? 0;

    // fire -> the flame grows in, centered above the head. (Horns moved
    // to "dark", see below — fire is just the flame now.)
    const fireT = Math.min(fire * 1.2, 1);
    flameMat.opacity = fireT;
    // Final size trimmed to 75% of what it was (per feedback) — the *0.75
    // is the only change here, fire still drives the same 0.01->1.1 range.
    flameGroup.scale.setScalar((0.01 + fire * 1.1) * 0.75);

    // Two smaller side flames stay hidden until fire nears the main flame's
    // own full size, then grow/fade in over the remaining range — 0 at
    // SIDE_FLAME_THRESHOLD, 1 at fire=1.
    const sideT = Math.max(0, (fire - SIDE_FLAME_THRESHOLD) / (1 - SIDE_FLAME_THRESHOLD));
    sideFlameMat.opacity = sideT;
    sideFlameGroupL.scale.setScalar(0.01 + sideT * 1.0);
    sideFlameGroupR.scale.setScalar(0.01 + sideT * 1.0);

    // ice -> glossy/icy skin sheen + a held ice gem fades in. (Moved off
    // water per feedback — water keeps just the webbed-feet effect below;
    // the gem and shine now belong to ice instead.)
    for (const m of skinMeshes) {
      m.material.roughness = 0.7 - ice * 0.55;
      m.material.metalness = 0.05 + ice * 0.25;
    }
    gemMat.opacity = ice;
    gem.scale.setScalar(0.01 + ice * 1.1);

    // water -> (age 2+) the feet flatten and flare into webbed flippers.
    // (see legMeshL/R scale below, still keyed on `water`.)

    // ground -> bigger AND taller. A pure uniform zoom (the previous
    // version) was correctly proportional but read as static — the whole
    // rig inflating around one fixed center doesn't look like "standing
    // taller." Per direct feedback: keep the same uniform `bulk` scale on
    // every axis (still the base of the effect, still what keeps arms
    // clearing the head etc.), but ALSO lift the body and head centers
    // upward as ground grows, and lift the head MORE than the body. That
    // extra head lift is what stops the head from reading as "squashed
    // onto" the body — without it, both were merely scaling up from fixed
    // centers, so the head-to-body gap didn't grow along with everything
    // else and the head looked pressed down into the body at high ground.
    bulk = 1 + ground * 0.35;
    const bodyLift = ground * 0.09;
    const headLift = ground * 0.2; // rises faster than the body
    if (isSolo) {
      body.scale.setScalar(bulk);
      body.position.y = bodyBaseY + bodyLift;
    } else {
      body.scale.set(bulk, BODY_SQUASH_Y * bulk, bulk);
      body.position.y = bodyBaseY + bodyLift;
      head.scale.set(bulk, bulk, bulk);
      head.position.y = headBaseY + headLift;
    }
    if (armMeshL) {
      armMeshL.scale.set(ARM_BASE_SCALE[0] * bulk, ARM_BASE_SCALE[1] * bulk, ARM_BASE_SCALE[2] * bulk);
      armMeshR.scale.set(ARM_BASE_SCALE[0] * bulk, ARM_BASE_SCALE[1] * bulk, ARM_BASE_SCALE[2] * bulk);
      // Arms/legs also spread a bit further out from center (beyond plain
      // uniform scale) as ground increases, so the limbs read as pushing
      // outward to brace a bigger frame rather than the rig just growing
      // toward/from a single point. They also ride up with the body lift.
      const armSpread = 1 + ground * 0.18;
      armL.position.set(ARM_PIVOT_BASE[0] * bulk * armSpread, ARM_PIVOT_BASE[1] * bulk + bodyLift, ARM_PIVOT_BASE[2] * bulk);
      armR.position.set(-ARM_PIVOT_BASE[0] * bulk * armSpread, ARM_PIVOT_BASE[1] * bulk + bodyLift, ARM_PIVOT_BASE[2] * bulk);
    }
    if (legMeshL) {
      const [sx, sy, sz] = LEG_BASE_SCALE;
      const legScaleY = sy * (1 - water * 0.4);
      legMeshL.scale.set(sx * (1 + water * 0.55) * bulk, legScaleY * bulk, sz * (1 + water * 0.7) * bulk);
      legMeshR.scale.set(sx * (1 + water * 0.55) * bulk, legScaleY * bulk, sz * (1 + water * 0.7) * bulk);
      const legSpread = 1 + ground * 0.15;
      // Feet stay planted: the leg pivot Y is NOT just bulk-scaled-and-lifted
      // like the arms — it's solved so the BOTTOM of the leg mesh
      // (pivot.y - LEG_RADIUS*legScaleY*bulk) stays exactly where it was at
      // ground=0, however tall the legs grow. Without this, the legs grew
      // taller from a pivot that was ALSO rising (bulk + bodyLift), so the
      // bottom lifted clear off the ground — the character visibly
      // levitated at high ground values (found by direct review).
      const legPivotY = LEG_PIVOT_BASE[1] + LEG_RADIUS * legScaleY * (bulk - 1);
      legL.position.set(LEG_PIVOT_BASE[0] * bulk * legSpread, legPivotY, LEG_PIVOT_BASE[2] * bulk);
      legR.position.set(-LEG_PIVOT_BASE[0] * bulk * legSpread, legPivotY, LEG_PIVOT_BASE[2] * bulk);
    }
    tail.scale.set(0.65 * bulk, 0.65 * bulk, 1.7 * bulk);
    // Anchor fix (as before): position tracks the body's CURRENT (now
    // possibly lifted) center, plus the construction-time offset from that
    // center scaled by bulk — using bodyBaseY (frozen) rather than the live
    // body.position.y in the offset math, so the lift isn't double-counted.
    tail.position.set(0, body.position.y + (tailBaseY - bodyBaseY) * bulk, tailBaseZ * bulk);
    // Same pattern for the flame (anchored off the head) and the gem
    // (anchored off the body).
    flameBaseY = head.position.y + (headTopY - headBaseY + 0.03) * bulk;
    gem.position.set(0, body.position.y + (chestY - bodyBaseY) * bulk, chestZ * bulk);
    // Thorns: spine thorns live in `group`-local space around the torso
    // center, so they get the same center+offset*bulk treatment (using the
    // live body.position.y as the center, torsoCenterY — frozen, ==
    // bodyBaseY — only for the offset). Arm thorns live in the arm PIVOT's
    // local space, where the pivot's own origin already IS the center (the
    // pivot itself now carries bodyLift), so their local position just
    // scales by bulk directly.
    for (const th of thorns) {
      const [px, py, pz] = th.userData.basePos;
      if (th.userData.kind === 'spine') {
        th.position.set(px * bulk, body.position.y + (py - torsoCenterY) * bulk, pz * bulk);
      } else {
        th.position.set(px * bulk, py * bulk, pz * bulk);
      }
    }

    // nature -> dark thorn spikes grow in along the spine (and arms, age 2+).
    thornMat.opacity = Math.min(nature * 1.2, 1);
    for (const th of thorns) th.scale.setScalar(0.01 + nature * (th.userData.baseScale ?? 1));

    // lightning -> the head's own vertices at the back/crown pull outward
    // into swept quills (Sonic/Shadow-style). dark -> small devil horns pull
    // out of the head's own vertices near the temples (moved from fire).
    applyHeadMorph(lightning, dark);

    // Paint the two-color gradient now, AFTER the head morph — the head's
    // gradient is computed from its CURRENT local vertex positions, so it
    // has to run after quills/horns have already displaced them, or the
    // gradient's own top/bottom bounds would be stale.
    for (const { mesh, axis } of gradientParts) {
      applyGradientColors(mesh, axis, colorA, colorB);
    }

    // fairy -> wings, purely trait-driven now (they used to also appear
    // automatically at age 3+ regardless of fairy; feedback was that they
    // read as "permanently there," so age no longer grants them at all —
    // only the fairy trait does), tinted pink as the trait grows.
    const wingPresence = fairy;
    wingMat.opacity = 0.85 * wingPresence;
    // Neither wing position nor scale accounted for ground's `bulk` at all
    // (found in review) - at high ground they read as shrunken/sunken
    // against the now-much-bigger body. Same fix pattern as the tail: scale
    // multiplies straight through, position gets center+offset*bulk (using
    // body.position.y as the center, consistent with the other back-mounted
    // props — body and head scale together anyway).
    const wingScale = (0.02 + wingPresence * 0.98) * bulk;
    wingL.scale.set(wingScale, wingScale, 0.28 * wingScale);
    wingR.scale.set(wingScale, wingScale, 0.28 * wingScale);
    wingL.position.set(-wingBaseX * bulk, body.position.y + (wingBaseY - bodyBaseY) * bulk, wingBaseZ * bulk);
    wingR.position.set(wingBaseX * bulk, body.position.y + (wingBaseY - bodyBaseY) * bulk, wingBaseZ * bulk);
    wingMat.color.set(wingBaseColor).lerp(new THREE.Color(ELEMENT_INFO.fairy.color), fairy);
    wingMat.emissive.set(wingBaseEmissive).lerp(new THREE.Color(ELEMENT_INFO.fairy.accent), fairy);
  }

  function update(dt, t, moving = false) {
    // Returned to the caller (main.js passes it to wander.js) so forward
    // translation can be scaled by the SAME phase driving the leg swing —
    // per feedback, a constant glide while the legs cycled independently
    // read as skating rather than walking. Stays 1 (no change to whatever
    // speed wander.js was already using) except during the legged gait
    // below, which computes its own pulsing value from its own phase.
    let speedMultiplier = 1;
    if (isSolo) {
      // Rocks side to side in place with a squash on each "landing" — this
      // was the cube's flop animation; the cube shape itself is shelved for
      // now, but the motion reads well for the sphere too. Speeds up while
      // actually walking so the rock reads as matching Kibi's travel pace
      // rather than the same rate whether idle or on the move.
      rockPhaseAccum += dt * (moving ? ROCK_WALK_SPEED : ROCK_IDLE_SPEED);
      const rockPhase = rockPhaseAccum;
      group.rotation.z = Math.sin(rockPhase) * 0.55;
      const landing = Math.pow(Math.abs(Math.sin(rockPhase)), 8);
      group.scale.y = 1 - landing * 0.14;
      group.position.y = -landing * 0.018;
      group.position.x = 0;
    } else {
      // Feet stay planted at all times — a previous version bobbed the
      // whole group vertically here, which visibly lifted the feet off the
      // ground while idle (per feedback). A gentle breathing SCALE pulse
      // gives idle some life instead, without moving anything in world
      // space; while walking, the footfall bounce below (tied to the
      // actual gait phase) is the only vertical motion.
      group.position.y = 0;
      group.rotation.y = Math.sin(t * 0.5) * 0.12;
      group.position.x = 0;
      group.rotation.z = 0;
      group.scale.y = moving ? 1 : 1 + Math.sin(t * 1.8) * 0.015;
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
    // pulse), plus a slow float bob for the whole flame. Slowed down a
    // notch from the original timing (per feedback) — same motions, just
    // eased back so the flicker reads calmer rather than jittery.
    if (flameMat.opacity > 0.01) {
      const flicker = 1 + Math.sin(t * 6.5) * 0.09;
      flame.scale.set(flicker, 1 + Math.sin(t * 4.8) * 0.14, flicker);
      flame.rotation.z = Math.sin(t * 2.3) * 0.1;
      flame.rotation.x = Math.sin(t * 1.8) * 0.06;
      flameMat.emissiveIntensity = 0.5 + Math.sin(t * 6.5) * 0.2;
      flameGroup.position.y = flameBaseY + Math.sin(t * 1.6) * 0.02;
    }

    // side flames: same flicker idea as the main tongue, but with their own
    // phase offsets and a touch faster/livelier so all three don't pulse in
    // lockstep (which read as one robotic flame instead of three separate
    // tongues).
    if (sideFlameMat.opacity > 0.01) {
      const flickerL = 1 + Math.sin(t * 7.2 + 1.1) * 0.1;
      const flickerR = 1 + Math.sin(t * 7.2 + 2.6) * 0.1;
      sideFlameL.scale.set(flickerL, 1 + Math.sin(t * 5.3 + 0.6) * 0.15, flickerL);
      sideFlameR.scale.set(flickerR, 1 + Math.sin(t * 5.3 + 1.9) * 0.15, flickerR);
      sideFlameL.rotation.x = Math.sin(t * 2.0 + 0.3) * 0.05;
      sideFlameR.rotation.x = Math.sin(t * 2.0 + 1.7) * 0.05;
      sideFlameMat.emissiveIntensity = 0.5 + Math.sin(t * 7.2) * 0.2;
    }

    // wings: idle flutter
    if (wingMat.opacity > 0.01) {
      const flap = Math.sin(t * 2.2) * 0.15;
      wingL.rotation.x = wingTilt + flap;
      wingR.rotation.x = wingTilt + flap;
    }

    // age 2+: running-in-place gait — legs swing, opposite arm swings with
    // each leg (contralateral, like a real trot), body/head bounce twice
    // per stride (once per footfall) layered on top of the idle bob. Only
    // plays while actually moving — it used to run continuously regardless,
    // which read as perpetually trotting in place even while idle (per
    // feedback: idle should read as generally still, with just the light
    // bob/sway above). Eases back to a neutral rest pose when idle instead
    // of snapping straight to it.
    if (legL) {
      if (moving) {
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

        // Forward speed pulses in sync with the stride — two peaks per
        // full leg cycle (once per footfall, matching `footfall` above)
        // instead of a flat 1. Averages to exactly 1 over a full cycle
        // (cos's own average is 0), so overall travel speed/ETA still
        // matches whatever pace wander.js configured — this only changes
        // the RHYTHM of the motion, not the average speed.
        const STEP_AMPLITUDE = 0.6;
        speedMultiplier = 1 - STEP_AMPLITUDE * Math.cos(2 * runPhase);
      } else {
        const ease = Math.min(1, dt * 8);
        legL.rotation.x *= 1 - ease;
        legR.rotation.x *= 1 - ease;
        armL.rotation.x *= 1 - ease;
        armR.rotation.x *= 1 - ease;
        head.rotation.x *= 1 - ease;
      }
    }
    return speedMultiplier;
  }

  function dispose() {
    for (const obj of disposables) obj.dispose?.();
  }

  applyTraits({ fire: 0, water: 0, ice: 0, nature: 0, lightning: 0, fairy: 0, ground: 0, dark: 0 });

  return { group, applyTraits, update, dispose };
}

function randomBlinkDelay() {
  return 2.5 + Math.random() * 3;
}
