import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createChao } from './chao.js';
import { ELEMENTS, ELEMENT_INFO, AGES, BODY_SHAPES, createDefaultTraits } from './traits.js';
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
scene.fog = new THREE.Fog(0xbfe6ff, 6, 16);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(1.6, 1.4, 2.4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;
controls.minDistance = 1.2;
controls.maxDistance = 6;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// --- lights ----------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4e, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 5, 2);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

// --- ground platform (low-poly garden patch) --------------------------------
const groundGeo = new THREE.CylinderGeometry(2.2, 2.2, 0.2, 24, 1);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x7fc96b, flatShading: true, roughness: 0.9 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.position.y = -0.1;
ground.receiveShadow = true;
scene.add(ground);

// --- chao (rebuilt whenever age/shape change; traits persist across that) ---
const traits = createDefaultTraits();
const structure = { age: 1, shape: 'sphere' };
let chao = null;

function rebuildChao() {
  if (chao) {
    scene.remove(chao.group);
    chao.dispose();
  }
  chao = createChao(structure);
  chao.group.traverse((obj) => {
    if (obj.isMesh) obj.castShadow = true;
  });
  chao.applyTraits(traits);
  scene.add(chao.group);
}
rebuildChao();

// Dev-only hook: reliable state setter for scripted screenshot/testing tools,
// since driving <input type="range">/radio elements from outside the page is
// flaky (native events, ref drift across rebuilds). Not part of the game.
window.__chaoDebug = {
  setStructure(partial) {
    Object.assign(structure, partial);
    rebuildChao();
    syncPanelInputs();
  },
  setTraits(partial) {
    Object.assign(traits, partial);
    chao.applyTraits(traits);
    syncPanelInputs();
  },
  reset() {
    Object.assign(structure, { age: 1, shape: 'sphere' });
    for (const el of ELEMENTS) traits[el] = 0;
    rebuildChao();
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
  title.textContent = 'chao garden — trait test';
  panel.appendChild(title);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Age/shape set the base skeleton. Sliders stand in for "items fed" and drive color, glow, and per-element effects on top of it.';
  panel.appendChild(hint);

  panel.appendChild(buildSection('Age'));
  const ageRow = buildRadioRow('age', AGES.map((a) => ({ value: a, label: `${a}` })), structure.age, (v) => {
    structure.age = Number(v);
    rebuildChao();
  });
  panel.appendChild(ageRow);

  panel.appendChild(buildSection('Shape'));
  const shapeRow = buildRadioRow('shape', BODY_SHAPES.map((s) => ({ value: s, label: s })), structure.shape, (v) => {
    structure.shape = v;
    rebuildChao();
  });
  panel.appendChild(shapeRow);

  panel.appendChild(buildSection('Elements'));
  const sliderEls = {};
  for (const el of ELEMENTS) {
    const { row, slider, readout } = buildSliderRow(el, traits, () => chao.applyTraits(traits));
    sliderEls[el] = { slider, readout };
    panel.appendChild(row);
  }

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
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const t = clock.elapsedTime;
  chao.update(dt, t);
  controls.update();
  renderer.render(scene, camera);
});
