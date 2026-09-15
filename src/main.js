import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createKibi } from './kibi.js';
import { createCollectionOrb } from './collectionOrb.js';
import { createSatoshiOrb } from './satoshiOrb.js';
import { createTerrain } from './terrain.js';
import { createWander } from './wander.js';
import { ELEMENTS, ELEMENT_INFO, AGES, BODY_SHAPES, createDefaultTraits, MAJOR_ELEMENTS, MINOR_ELEMENTS, MISC_ELEMENTS } from './traits.js';
import './style.css';

const sceneRoot = document.getElementById('scene-root');
const uiRoot = document.getElementById('ui-root');

// --- renderer / scene / camera ------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
sceneRoot.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe6ff);
// Pushed way out from the old (6, 16) — that was tuned for a 2.2-radius
// platform; the home scene's island alone runs out to radius 48, so fog
// needs to stay clear of it and only fade in over the open water beyond.
scene.fog = new THREE.Fog(0xbfe6ff, 30, 220);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(5, 4, 7);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 90; // was 6 — far enough to pull back and see the whole island
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// --- lights ----------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4e, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
// Default shadow-camera frustum is only ~±5 units — far too tight for the
// home scene (orbs/props now spread out to radius ~40), so widen it to
// cover the green+sand area. The water beyond doesn't need shadows.
sun.shadow.camera.left = -45;
sun.shadow.camera.right = 45;
sun.shadow.camera.top = 45;
sun.shadow.camera.bottom = -45;
sun.shadow.camera.far = 60;
scene.add(sun);

// --- home scene terrain (island: green -> sand -> beach -> water) ----------
const terrain = createTerrain();
scene.add(terrain.group);

// --- kibi (rebuilt whenever age/shape change; traits persist across that) ---
// `kibiRig` is the OUTER group that actually moves/turns around the home
// scene (see wander.js) — kept separate from `kibi.group` (the INNER group
// kibi.js's own update() animates: idle bob/sway/rock) so wandering and
// Kibi's own idle animation compose naturally instead of fighting over the
// same transform. rebuildKibi() only ever touches the inner group; the rig
// itself, and its current position/facing, survive an age/shape change.
const kibiRig = new THREE.Group();
scene.add(kibiRig);

const traits = createDefaultTraits();
const structure = { age: 1, shape: 'sphere' };
let kibi = null;

function rebuildKibi() {
  if (kibi) {
    kibiRig.remove(kibi.group);
    kibi.dispose();
  }
  kibi = createKibi(structure);
  kibi.group.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  kibi.applyTraits(traits);
  kibiRig.add(kibi.group);
}
rebuildKibi();

const wander = createWander(kibiRig);

// --- collection orbs (preview only — no inventory system yet) --------------
// One "seed" orb per element that actually feeds a trait, arranged as
// points of interest spread around the green area (radius 18, comfortably
// inside the 30-radius green zone) so exploring the home scene actually
// means walking out to find them, rather than everything huddled right on
// top of Kibi. fairy is left out: it isn't part of the color scheme (see
// MISC_ELEMENTS) and doesn't have a "seed" of its own yet.
const ORB_RING_RADIUS = 18;
const orbElements = [...MAJOR_ELEMENTS, ...MINOR_ELEMENTS];
const ORB_SLOTS = orbElements.length + 1; // +1 for the satoshi orb below, so all orbs share one evenly-spaced ring
const orbs = orbElements.map((el, i) => {
  const orb = createCollectionOrb(el);
  const angle = (i / ORB_SLOTS) * Math.PI * 2;
  const r = ORB_RING_RADIUS;
  orb.group.position.set(Math.cos(angle) * r, 0.26, Math.sin(angle) * r);
  orb.group.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  scene.add(orb.group);
  return orb;
});

// One extra, non-elemental collectible: a smaller Bitcoin-orange "satoshi"
// orb, taking the last slot in the same ring.
const satoshiOrb = createSatoshiOrb();
{
  const angle = (orbElements.length / ORB_SLOTS) * Math.PI * 2;
  const r = ORB_RING_RADIUS;
  satoshiOrb.group.position.set(Math.cos(angle) * r, 0.18, Math.sin(angle) * r);
  satoshiOrb.group.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  scene.add(satoshiOrb.group);
}
orbs.push(satoshiOrb);

// Dev-only hook: reliable state setter for scripted screenshot/testing tools,
// since driving <input type="range">/radio elements from outside the page is
// flaky (native events, ref drift across rebuilds). Not part of the game.
window.__kibiDebug = {
  setStructure(partial) {
    Object.assign(structure, partial);
    rebuildKibi();
    syncPanelInputs();
  },
  setTraits(partial) {
    Object.assign(traits, partial);
    kibi.applyTraits(traits);
    syncPanelInputs();
  },
  reset() {
    Object.assign(structure, { age: 1, shape: 'sphere' });
    for (const el of ELEMENTS) traits[el] = 0;
    rebuildKibi();
    syncPanelInputs();
  },
  getState() {
    return { structure: { ...structure }, traits: { ...traits } };
  },
};
let syncPanelInputs = () => {};

// --- UI ----------------------------------------------------------------------
buildPanel(uiRoot);

function buildPanel(root) {
  const panel = document.createElement('div');
  panel.className = 'trait-panel';

  const title = document.createElement('h1');
  title.textContent = 'kibi — trait test';
  panel.appendChild(title);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Age/shape set the base skeleton. Sliders stand in for "items fed" and drive color, glow, and per-element effects on top of it.';
  panel.appendChild(hint);

  panel.appendChild(buildSection('Age'));
  const ageRow = buildRadioRow('age', AGES.map((a) => ({ value: a, label: `${a}` })), structure.age, (v) => {
    structure.age = Number(v);
    rebuildKibi();
  });
  panel.appendChild(ageRow);

  panel.appendChild(buildSection('Shape'));
  const shapeRow = buildRadioRow('shape', BODY_SHAPES.map((s) => ({ value: s, label: s })), structure.shape, (v) => {
    structure.shape = v;
    rebuildKibi();
  });
  panel.appendChild(shapeRow);

  // Grouped to match the color scheme (see kibi.js applyTraits): Major
  // elements drive the back/dominant color, Minor drive the front/belly
  // accent, Misc sits outside the color scheme entirely (fairy = wings
  // only) — traits.js's MAJOR_ELEMENTS/MINOR_ELEMENTS/MISC_ELEMENTS is the
  // shared source of truth so this grouping can't drift out of sync with
  // the actual color logic.
  const sliderEls = {};
  const addSliderGroup = (label, els) => {
    panel.appendChild(buildSection(label));
    for (const el of els) {
      const { row, slider, readout } = buildSliderRow(el, traits, () => kibi.applyTraits(traits));
      sliderEls[el] = { slider, readout };
      panel.appendChild(row);
    }
  };
  addSliderGroup('Major', MAJOR_ELEMENTS);
  addSliderGroup('Minor', MINOR_ELEMENTS);
  addSliderGroup('Misc', MISC_ELEMENTS);

  root.appendChild(panel);

  syncPanelInputs = () => {
    ageRow.querySelectorAll('input').forEach((i) => { i.checked = Number(i.value) === structure.age; });
    shapeRow.querySelectorAll('input').forEach((i) => { i.checked = i.value === structure.shape; });
    for (const el of ELEMENTS) {
      sliderEls[el].slider.value = String(traits[el]);
      sliderEls[el].readout.textContent = traits[el].toFixed(2);
    }
  };
}

function buildSection(label) {
  const h = document.createElement('h2');
  h.className = 'section';
  h.textContent = label;
  return h;
}

function buildRadioRow(name, options, current, onChange) {
  const row = document.createElement('div');
  row.className = 'radio-row';
  for (const opt of options) {
    const id = `${name}-${opt.value}`;
    const wrap = document.createElement('label');
    wrap.className = 'radio-pill';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.id = id;
    input.value = String(opt.value);
    input.checked = opt.value === current;
    input.addEventListener('change', () => onChange(opt.value));
    const span = document.createElement('span');
    span.textContent = opt.label;
    wrap.appendChild(input);
    wrap.appendChild(span);
    row.appendChild(wrap);
  }
  return row;
}

function buildSliderRow(el, traits, onChange) {
  const info = ELEMENT_INFO[el];
  const row = document.createElement('label');
  row.className = 'trait-row';

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = `#${info.color.toString(16).padStart(6, '0')}`;
  row.appendChild(swatch);

  const name = document.createElement('span');
  name.className = 'trait-name';
  name.textContent = info.label;
  row.appendChild(name);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.01';
  slider.value = String(traits[el]);
  row.appendChild(slider);

  const readout = document.createElement('span');
  readout.className = 'trait-value';
  readout.textContent = traits[el].toFixed(2);
  row.appendChild(readout);

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    traits[el] = v;
    readout.textContent = v.toFixed(2);
    onChange();
  });

  return { row, slider, readout };
}

// --- resize --------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- loop ------------------------------------------------------------------
const cameraTarget = new THREE.Vector3();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;
  wander.update(dt);
  kibi.update(dt, t);
  for (const orb of orbs) orb.update(dt, t);

  // Camera keeps Kibi in view as it wanders the island — follows smoothly
  // rather than snapping, so the user can still freely orbit/zoom around
  // wherever Kibi currently is.
  cameraTarget.set(kibiRig.position.x, 0.6, kibiRig.position.z);
  controls.target.lerp(cameraTarget, Math.min(1, dt * 2));

  controls.update();
  renderer.render(scene, camera);
});
