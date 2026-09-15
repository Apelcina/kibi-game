import * as THREE from 'three';
import { ELEMENT_INFO } from './traits.js';

// A standalone "seed" collectible — NOT part of Kibi itself, just a small
// display object per element, previewing what an as-yet-unbuilt collection/
// inventory system would show. Two nested spheres:
//   outer: semi-transparent shell, a dark(bottom)->light(top) vertical
//          vertex-color gradient of the element's own color, with a slow
//          breathing glow (emissive intensity easing up and down) rather
//          than a moving scan/highlight — a scanning band was tried across
//          a few iterations (a separate ring mesh, then a highlight blended
//          into the shell's own vertex colors, tuned narrower/sharper, then
//          changed to a one-way bottom->top pass) but didn't land, so for
//          now the shell is kept simple: just a calm ambient pulse.
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

  // --- outer shell: semi-transparent, dark(bottom)->light(top) gradient ---
  const outerGeo = track(lowPolySphere(OUTER_RADIUS, 1));
  {
    const pos = outerGeo.attributes.position;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const range = maxY - minY || 1;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - minY) / range;
      c.copy(darkColor).lerp(lightColor, t);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    outerGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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

  const GLOW_BASE = 0.15;
  const GLOW_PEAK = 1.3;
  const OPACITY_BASE = 0.4;
  const OPACITY_PEAK = 0.68;
  const PULSE_PERIOD = 5; // seconds between flashes
  const PULSE_SPEED = (Math.PI * 2) / PULSE_PERIOD;
  const PULSE_SHARPNESS = 10; // higher = briefer flash, more time at rest
  const glowPhase = Math.random() * Math.PI * 2; // stagger multiple orbs so they don't flash in sync

  function update(dt, t) {
    inner.rotation.y += dt * 0.5;
    group.rotation.y += dt * 0.18;

    // A brief bright flash every PULSE_PERIOD seconds, not a continuous
    // dark<->bright breath — per feedback, resting near-dark most of the
    // time read worse than just sitting at a steady baseline and pulsing
    // UP briefly. sin raised to a high power stays near 0 for most of the
    // cycle and only spikes toward 1 in a short window around the peak.
    const pulse = Math.pow(Math.max(0, Math.sin(t * PULSE_SPEED + glowPhase)), PULSE_SHARPNESS);
    outerMat.emissiveIntensity = GLOW_BASE + pulse * (GLOW_PEAK - GLOW_BASE);
    outerMat.opacity = OPACITY_BASE + pulse * (OPACITY_PEAK - OPACITY_BASE);
  }

  function dispose() {
    for (const obj of disposables) obj.dispose?.();
  }

  return { group, update, dispose };
}
