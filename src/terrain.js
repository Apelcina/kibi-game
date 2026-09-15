import * as THREE from 'three';

// The "home scene" ground: a low-poly island — green interior, a sandy
// band, then a beach right at the water's edge — surrounded by open water.
// Built from four concentric flat cylinders at slightly RISING heights
// (green highest, water lowest) rather than a sculpted heightmap: each
// smaller/higher disk sits inside the next bigger/lower one, so its edge
// reveals a ring of the zone below it and the boundary reads as a gentle
// terrace, consistent with the rest of the game's flat-shaded primitive
// style rather than introducing a new terrain technique.
//
// Sizing: green+sand+beach together span 96 units across (48 radius) —
// roughly the "100x100" play area asked for, relative to Kibi's own ~1x1
// scale — with water extending far beyond that toward the fog-hidden
// horizon. `green`'s top sits at y=0, matching where the old small ground
// platform's top was, so Kibi/orb Y positions elsewhere don't need to
// change — only how far out things are placed.
const ZONES = [
  { name: 'water', radius: 300, topY: -0.26, color: 0x3d8fd6, roughness: 0.3, metalness: 0.15 },
  { name: 'beach', radius: 48, topY: -0.16, color: 0xdfc48a, roughness: 0.95 },
  { name: 'sand', radius: 40, topY: -0.08, color: 0xf2e2b0, roughness: 0.95 },
  { name: 'green', radius: 30, topY: 0, color: 0x7fc96b, roughness: 0.9 },
];
const ZONE_HEIGHT = 0.5;
const ZONE_SEGMENTS = 40;

function makeZoneMesh({ radius, topY, color, roughness, metalness }) {
  const geo = new THREE.CylinderGeometry(radius, radius, ZONE_HEIGHT, ZONE_SEGMENTS, 1);
  const mat = new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: roughness ?? 0.9,
    metalness: metalness ?? 0,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = topY - ZONE_HEIGHT / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function lowPolyRock(radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8a86, flatShading: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(1, 0.65 + Math.random() * 0.3, 1);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function lowPolyTree() {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5230, flatShading: true, roughness: 0.9 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 1.4, 6), trunkMat);
  trunk.position.y = 0.7;
  group.add(trunk);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4c9a4c, flatShading: true, roughness: 0.85 });
  for (let i = 0; i < 3; i++) {
    const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75 - i * 0.12, 0), leafMat);
    leaf.position.y = 1.5 + i * 0.5;
    group.add(leaf);
  }
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return group;
}

// Fixed (not random) spot lists so the scene looks the same on every load —
// randomizing per-session would make the "home" feel different each visit.
const ROCK_SPOTS = [
  [20, 34],
  [-24, 30],
  [9, -43],
  [-31, -19],
  [36, -6],
];
const TREE_SPOTS = [
  [12, 10],
  [-14, 6],
  [6, -15],
  [-11, -17],
  [19, -7],
  [-20, 12],
];

export function createTerrain() {
  const group = new THREE.Group();

  for (const zone of ZONES) {
    group.add(makeZoneMesh(zone));
  }

  for (const [x, z] of ROCK_SPOTS) {
    const rock = lowPolyRock(0.55 + (Math.abs(x * 13 + z * 7) % 10) / 20);
    rock.position.set(x, 0.3, z);
    group.add(rock);
  }

  for (const [x, z] of TREE_SPOTS) {
    const tree = lowPolyTree();
    tree.position.set(x, 0, z);
    group.add(tree);
  }

  return { group };
}
