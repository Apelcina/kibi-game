import * as THREE from 'three';

// A one-off "satoshi" collectible, alongside the per-element orbs in
// collectionOrb.js — same two-nested-spheres shell/breathing-glow idea, but
// smaller, Bitcoin-orange/gold instead of an element color, and with a
// floating low-poly "sats" glyph (three horizontal bars + two short angled
// strokes crossing the top and bottom bars) in place of the seedling
// sprout, since this one isn't an element seed.

const OUTER_RADIUS = 0.14;
const INNER_RADIUS = 0.06;

const BASE_COLOR = 0xf7931a; // Bitcoin orange
const ACCENT_COLOR = 0xffe6a8; // pale gold, for the glyph

function lowPolySphere(radius, detail = 1) {
  return new THREE.IcosahedronGeometry(radius, detail);
}

export function createSatoshiOrb() {
  const group = new THREE.Group();
  const disposables = [];
  const track = (obj) => {
    disposables.push(obj);
    return obj;
  };

  const baseColor = new THREE.Color(BASE_COLOR);
  const darkColor = baseColor.clone().multiplyScalar(0.55);
  const lightColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.45);
  const accentColor = new THREE.Color(ACCENT_COLOR);

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
    metalness: 0.1,
    emissive: baseColor,
    emissiveIntensity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  }));
  const outer = new THREE.Mesh(outerGeo, outerMat);
  group.add(outer);

  // --- inner core: small solid gold ball ----------------------------------
  const innerMat = track(new THREE.MeshStandardMaterial({
    color: baseColor,
    flatShading: true,
    roughness: 0.4,
    metalness: 0.3,
    emissive: baseColor,
    emissiveIntensity: 0.25,
  }));
  const inner = new THREE.Mesh(track(lowPolySphere(INNER_RADIUS, 1)), innerMat);
  group.add(inner);

  // --- floating sats glyph: 3 horizontal bars + 2 short angled strokes ---
  // crossing the top and bottom bars (not the middle one) — a low-poly
  // stand-in for the community-proposed "sats" symbol, not attached to the
  // inner core, so it can drift/spin on its own and read as "floating."
  const glyph = new THREE.Group();
  const glyphMat = track(new THREE.MeshStandardMaterial({
    color: accentColor,
    flatShading: true,
    roughness: 0.25,
    metalness: 0.5,
    emissive: accentColor,
    emissiveIntensity: 0.5,
  }));
  const BAR_LENGTH = 0.1;
  const BAR_THICKNESS = 0.016;
  const barGeo = track(new THREE.BoxGeometry(BAR_LENGTH, BAR_THICKNESS, BAR_THICKNESS));
  const BAR_GAP = 0.045;
  for (const y of [-BAR_GAP, 0, BAR_GAP]) {
    const bar = new THREE.Mesh(barGeo, glyphMat);
    bar.position.y = y;
    glyph.add(bar);
  }
  const STROKE_LENGTH = 0.07;
  const strokeGeo = track(new THREE.BoxGeometry(BAR_THICKNESS, STROKE_LENGTH, BAR_THICKNESS));
  const STROKE_TILT = 0.36; // ~20 degrees, "angled slightly"
  const strokeTop = new THREE.Mesh(strokeGeo, glyphMat);
  strokeTop.position.y = BAR_GAP;
  strokeTop.rotation.z = STROKE_TILT;
  glyph.add(strokeTop);
  const strokeBottom = new THREE.Mesh(strokeGeo, glyphMat);
  strokeBottom.position.y = -BAR_GAP;
  strokeBottom.rotation.z = STROKE_TILT;
  glyph.add(strokeBottom);
  group.add(glyph);

  const GLOW_MIN = 0.03;
  const GLOW_MAX = 1.3;
  const OPACITY_MIN = 0.28;
  const OPACITY_MAX = 0.64;
  const GLOW_SPEED = 0.7;
  const glowPhase = Math.random() * Math.PI * 2;
  const GLYPH_BOB_RANGE = 0.012;

  function update(dt, t) {
    inner.rotation.y += dt * 0.3;
    group.rotation.y += dt * 0.18;
    // Glyph floats independently of the inner core: its own slow spin plus
    // a gentle vertical bob.
    glyph.rotation.y += dt * 0.6;
    glyph.position.y = Math.sin(t * 0.9) * GLYPH_BOB_RANGE;

    const breathe = 0.5 + 0.5 * Math.sin(t * GLOW_SPEED + glowPhase);
    outerMat.emissiveIntensity = GLOW_MIN + breathe * (GLOW_MAX - GLOW_MIN);
    outerMat.opacity = OPACITY_MIN + breathe * (OPACITY_MAX - OPACITY_MIN);
  }

  function dispose() {
    for (const obj of disposables) obj.dispose?.();
  }

  return { group, update, dispose };
}
