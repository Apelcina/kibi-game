import * as THREE from 'three';
import { ELEMENT_INFO } from './traits.js';

// A standalone "seed" collectible — NOT part of Kibi itself, just a small
// display object per element, previewing what an as-yet-unbuilt collection/
// inventory system would show. Two nested spheres:
//   outer: semi-transparent shell, a dark(bottom)->light(top) vertical
//          vertex-color gradient of the element's own color, with a soft
//          bright glow band that sweeps across it. The scan is painted
//          directly into the shell's OWN per-vertex colors (not a separate
//          ring prop floating in front of it) — a first version used a
//          literal torus mesh and read as "a white circle going up and
//          down," disconnected from the sphere underneath. Blending the
//          highlight into the gradient itself, with a soft falloff instead
//          of a hard edge, makes it look like the shell's own surface is
//          catching light as the band passes, not a separate object
//          overlaid on top. The sweep axis is tilted a bit off vertical
//          (randomized per orb) so it reads as a natural diagonal scan
//          rather than a mechanical straight up-down.
//   inner: a small solid, more saturated core — with a tiny low-poly
//          sprout (stem + two leaves, in the element's ACCENT color)
//          growing out of its top, so it reads as a seed germinating
//          rather than just a smaller ball nested in a bigger one.

const OUTER_RADIUS = 0.22;
const INNER_RADIUS = 0.1;

function lowPolySphere(radius, detail = 1) {
  return new THREE.IcosahedronGeometry(radius, detail);
}

export function createCollectionOrb(element) {
  const info = ELEMENT_INFO[element];
  const group = new THREE.Group();
  const disposables = [];
  const track = (obj) => {
    disposables.push(obj);
    return obj;
  };

  const baseColor = new THREE.Color(info.color);
  const darkColor = baseColor.clone().multiplyScalar(0.55);
  const lightColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.45);
  const accentColor = new THREE.Color(info.accent);
  const scanColor = new THREE.Color(0xffffff);

  // --- outer shell: semi-transparent, dark(bottom)->light(top) gradient, --
  // plus a live glow band blended into these same per-vertex colors (see
  // update() below) rather than a separate mesh.
  const outerGeo = track(lowPolySphere(OUTER_RADIUS, 1));
  const outerPos = outerGeo.attributes.position;
  const outerCount = outerPos.count;
  const baseColors = new Float32Array(outerCount * 3); // static gradient, computed once
  const liveColors = new Float32Array(outerCount * 3); // baseColors + this frame's glow band
  // Sweep axis: mostly vertical but tilted a bit off-axis (random per orb,
  // both how far off vertical and which horizontal direction) so the scan
  // reads as a natural diagonal pass across the shell rather than a
  // perfectly straight, mechanical up-down sweep.
  const scanTiltAngle = 0.22 + Math.random() * 0.16; // ~13-22 degrees off vertical
  const scanTiltDir = Math.random() * Math.PI * 2;
  const scanAxis = new THREE.Vector3(
    Math.sin(scanTiltAngle) * Math.cos(scanTiltDir),
    Math.cos(scanTiltAngle),
    Math.sin(scanTiltAngle) * Math.sin(scanTiltDir),
  ).normalize();
  const axisProj = new Float32Array(outerCount); // each vertex's position along scanAxis, cached
  {
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < outerCount; i++) {
      const y = outerPos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const range = maxY - minY || 1;
    const c = new THREE.Color();
    const v = new THREE.Vector3();
    for (let i = 0; i < outerCount; i++) {
      const t = (outerPos.getY(i) - minY) / range;
      c.copy(darkColor).lerp(lightColor, t);
      baseColors[i * 3] = c.r;
      baseColors[i * 3 + 1] = c.g;
      baseColors[i * 3 + 2] = c.b;
      v.fromBufferAttribute(outerPos, i);
      axisProj[i] = v.dot(scanAxis);
    }
    liveColors.set(baseColors);
    outerGeo.setAttribute('color', new THREE.BufferAttribute(liveColors, 3));
  }
  const outerMat = track(new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    transparent: true,
    opacity: 0.48,
    roughness: 0.2,
    metalness: 0.05,
    emissive: baseColor,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false, // semi-transparent shell shouldn't occlude the inner core/sprout behind it
  }));
  const outer = new THREE.Mesh(outerGeo, outerMat);
  group.add(outer);

  // --- inner core: solid, saturated, with a tiny seedling sprout ---------
  const innerMat = track(new THREE.MeshStandardMaterial({
    color: baseColor,
    flatShading: true,
    roughness: 0.5,
    metalness: 0.1,
    emissive: baseColor,
    emissiveIntensity: 0.25,
  }));
  const inner = new THREE.Mesh(track(lowPolySphere(INNER_RADIUS, 1)), innerMat);
  group.add(inner);

  const sproutMat = track(new THREE.MeshStandardMaterial({
    color: accentColor,
    flatShading: true,
    roughness: 0.45,
    emissive: accentColor,
    emissiveIntensity: 0.3,
  }));
  const stem = new THREE.Mesh(track(new THREE.ConeGeometry(0.012, 0.06, 5)), sproutMat);
  stem.position.y = INNER_RADIUS + 0.025;
  inner.add(stem);
  const leafGeo = track(new THREE.ConeGeometry(0.024, 0.05, 4));
  function makeLeaf(side) {
    const leaf = new THREE.Mesh(leafGeo, sproutMat);
    leaf.position.set(side * 0.016, INNER_RADIUS + 0.05, 0);
    leaf.rotation.z = side * -1.0;
    leaf.scale.set(0.55, 1, 0.35);
    inner.add(leaf);
  }
  makeLeaf(-1);
  makeLeaf(1);

  const scanPhase = Math.random() * Math.PI * 2; // stagger multiple orbs so their scans don't sync up
  const SCAN_RANGE = OUTER_RADIUS * 0.95; // stay just inside the poles along scanAxis
  const SCAN_SIGMA = OUTER_RADIUS * 0.09; // glow band width — thin, per feedback
  const SCAN_SHARPNESS = 1.8; // >1 steepens the falloff beyond the raw gaussian, so the
                               // edge reads as a crisp line rather than a soft, wide glow
  const c = new THREE.Color();

  function update(dt, t) {
    inner.rotation.y += dt * 0.5;
    group.rotation.y += dt * 0.18;

    // Ping-pongs along the (tilted) scan axis — sin, not a sawtooth, for a
    // smooth continuous idle loop with no hard reset, matching this
    // project's other idle animations (blink, bob, flicker, flutter).
    const bandCenter = Math.sin(t * 1.1 + scanPhase) * SCAN_RANGE;
    let maxIntensity = 0;
    for (let i = 0; i < outerCount; i++) {
      const dist = axisProj[i] - bandCenter;
      const raw = Math.exp(-(dist * dist) / (2 * SCAN_SIGMA * SCAN_SIGMA));
      const intensity = Math.pow(raw, SCAN_SHARPNESS);
      if (intensity > maxIntensity) maxIntensity = intensity;
      c.setRGB(baseColors[i * 3], baseColors[i * 3 + 1], baseColors[i * 3 + 2]).lerp(scanColor, intensity);
      liveColors[i * 3] = c.r;
      liveColors[i * 3 + 1] = c.g;
      liveColors[i * 3 + 2] = c.b;
    }
    outerGeo.attributes.color.needsUpdate = true;
    // The whole shell brightens as the band passes through it, reinforcing
    // that this is light catching the surface, not a decal — pushed harder
    // than before since the low shell opacity was washing out a subtler
    // pulse against the sky background.
    outerMat.emissiveIntensity = 0.12 + maxIntensity * 0.7;
  }

  function dispose() {
    for (const obj of disposables) obj.dispose?.();
  }

  return { group, update, dispose };
}
