import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createChao } from './chao.js';
import { ELEMENTS, ELEMENT_INFO, createDefaultTraits } from './traits.js';
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

// --- chao ------------------------------------------------------------------
const chao = createChao();
chao.group.traverse((obj) => {
  if (obj.isMesh) {
    obj.castShadow = true;
  }
});
chao.group.position.y = 0;
scene.add(chao.group);

const traits = createDefaultTraits();
chao.applyTraits(traits);

// --- UI: one slider per element ---------------------------------------------
buildSliderPanel(uiRoot, traits, (updated) => chao.applyTraits(updated));

function buildSliderPanel(root, traits, onChange) {
  const panel = document.createElement('div');
  panel.className = 'trait-panel';

  const title = document.createElement('h1');
  title.textContent = 'chao garden — trait test';
  panel.appendChild(title);
  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent = 'Sliders stand in for "items fed" — each nudges an elemental affinity, which drives color, glow, ear shape, tail, and a leaf sprout.';
  panel.appendChild(hint);

  for (const el of ELEMENTS) {
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
      onChange(traits);
    });

    panel.appendChild(row);
  }

  root.appendChild(panel);
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
