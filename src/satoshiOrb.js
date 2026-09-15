import * as THREE from 'three';

// A one-off "satoshi" collectible, alongside the per-element orbs in
// collectionOrb.js — same semi-transparent shell/breathing-glow idea, but
// smaller, Bitcoin-orange/gold instead of an element color, and with a
// floating low-poly "sats" glyph (three horizontal bars + two short angled
// strokes crossing the top and bottom bars) inside — no solid inner core
// ball (removed per feedback), just the shell and the glyph floating in it.

const OUTER_RADIUS = 0.14;

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

  // --- floating sats glyph: 3 close-set bars + 2 short end caps ----------
  // Built per the reference image: three parallel bars stacked tightly,
  // with two short caps positioned ABOVE the top bar and BELOW the bottom
  // bar only — not crossing/overlapping the bars themselves (an earlier
  // version had the caps crossing through the top/bottom bars, which was
  // wrong). Everything is built axis-aligned in `glyphMark` first (bars
  // horizontal, caps vertical) and the whole assembly is tilted ONE time,
  // so every element ends up parallel at the same angle rather than each
  // piece getting its own independent rotation.
  const glyph = new THREE.Group();
  const glyphMark = new THREE.Group();
  const glyphMat = track(new THREE.MeshStandardMaterial({
    color: accentColor,
    flatShading: true,
    roughness: 0.25,
    metalness: 0.5,
    emissive: accentColor,
    emissiveIntensity: 0.5,
  }));
  const BAR_LENGTH = 0.085;
  const BAR_THICKNESS = 0.014;
  const BAR_GAP = 0.02; // tight stacking, per feedback
  const barGeo = track(new THREE.BoxGeometry(BAR_LENGTH, BAR_THICKNESS, BAR_THICKNESS));
  for (const y of [-BAR_GAP, 0, BAR_GAP]) {
    const bar = new THREE.Mesh(barGeo, glyphMat);
    bar.position.y = y;
    glyphMark.add(bar);
  }
  const CAP_LENGTH = 0.026; // shorter, per feedback
  const CAP_MARGIN = 0.012; // closer to the bar stack, per feedback — still a clear
                             // gap (the earlier 0.006 read as one continuous line)
  const capGeo = track(new THREE.BoxGeometry(BAR_THICKNESS, CAP_LENGTH, BAR_THICKNESS));
  const capOffset = BAR_GAP + BAR_THICKNESS / 2 + CAP_MARGIN + CAP_LENGTH / 2;
  const capTop = new THREE.Mesh(capGeo, glyphMat);
  capTop.position.y = capOffset;
  glyphMark.add(capTop);
  const capBottom = new THREE.Mesh(capGeo, glyphMat);
  capBottom.position.y = -capOffset;
  glyphMark.add(capBottom);
  glyphMark.rotation.z = 0.3; // ~17 degrees — the whole mark tilts as one piece
  glyphMark.scale.setScalar(1.2); // whole glyph a bit bigger, per feedback
  glyph.add(glyphMark);
  group.add(glyph);

  const GLOW_BASE = 0.15;
  const GLOW_PEAK = 1.3;
  const OPACITY_BASE = 0.4;
  const OPACITY_PEAK = 0.68;
  const PULSE_PERIOD = 5; // seconds between flashes
  const PULSE_SPEED = (Math.PI * 2) / PULSE_PERIOD;
  const PULSE_SHARPNESS = 10; // higher = briefer flash, more time at rest
  const glowPhase = Math.random() * Math.PI * 2;
  const GLYPH_BOB_RANGE = 0.012;

  function update(dt, t) {
    group.rotation.y += dt * 0.18;
    // Glyph floats on its own: a slow spin plus a gentle vertical bob.
    glyph.rotation.y += dt * 0.6;
    glyph.position.y = Math.sin(t * 0.9) * GLYPH_BOB_RANGE;

    // A brief bright flash every PULSE_PERIOD seconds, not a continuous
    // dark<->bright breath — see collectionOrb.js for the same fix/reasoning.
    const pulse = Math.pow(Math.max(0, Math.sin(t * PULSE_SPEED + glowPhase)), PULSE_SHARPNESS);
    outerMat.emissiveIntensity = GLOW_BASE + pulse * (GLOW_PEAK - GLOW_BASE);
    outerMat.opacity = OPACITY_BASE + pulse * (OPACITY_PEAK - OPACITY_BASE);
  }

  function dispose() {
    for (const obj of disposables) obj.dispose?.();
  }

  return { group, update, dispose };
}
