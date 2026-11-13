// Fishing and harbour clutter for the travel dock: crates, a barrel, a lobster pot
// with its buoy, a coil of rope, a bucket of the day's catch, a rod in a holder
// over the water, a life ring and a lantern post. Everything keeps to the two
// outer edges of the 2 × 3 deck so the walkway down the middle stays clear.
//
// Local frame: the dock building's centre, x across (−1…1), z along the pier
// (−1.5 land end … +1.5 sea end), deck top at y = DOCK_Y.

import * as THREE from 'three';
import { DOCK_Y } from '@hearthwood/shared';
import { fishingRodModel } from './fishing.ts';
import { mat, part } from './primitives.ts';

const WOOD = '#a0703f';
const WOOD_DARK = '#6d4c2f';
const POST = '#5a3e2b';
const ROPE = '#d8c39a';
const NET = '#7f8f7a';
const RED = '#d9483b';
const WHITE = '#f3efe6';
/** Same material key as the decor lantern: environment.ts turns it up at night. */
const LANTERN_GLASS = () => mat('#fff3c4', { emissive: '#ffcf6b', ei: 0.2 });

const ringGeo = new THREE.TorusGeometry(1, 0.3, 6, 16);
const quarterGeo = new THREE.TorusGeometry(1, 0.3, 6, 5, Math.PI / 2);

function mesh(geo: THREE.BufferGeometry, color: string | THREE.Material, s: number, x: number, y: number, z: number) {
  const m = new THREE.Mesh(geo, typeof color === 'string' ? mat(color) : color);
  m.scale.setScalar(s);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function crate(size: number, color = WOOD): THREE.Group {
  const g = new THREE.Group();
  g.add(part('box', color, size, size, size, 0, size / 2, 0));
  // Darker battens round the edges of the two visible faces.
  const b = size * 0.12;
  for (const y of [b / 2, size - b / 2]) {
    g.add(part('box', WOOD_DARK, size + 0.01, b, b, 0, y, size / 2 - b / 2 + 0.006));
    g.add(part('box', WOOD_DARK, b, b, size + 0.01, size / 2 - b / 2 + 0.006, y, 0));
  }
  g.add(part('box', WOOD_DARK, b, size, b * 1.2, 0, size / 2, size / 2 + 0.002));
  return g;
}

function barrel(): THREE.Group {
  const g = new THREE.Group();
  g.add(part('cyl', '#9a6a3c', 0.14, 0.36, 0.14, 0, 0.18, 0));
  for (const y of [0.06, 0.3]) g.add(part('cyl', '#4a4a50', 0.147, 0.03, 0.147, 0, y, 0, false));
  g.add(part('cyl', '#b98450', 0.125, 0.01, 0.125, 0, 0.365, 0, false));
  return g;
}

/** A lobster pot: a slatted half-round cage on a plank base, with a red-and-white buoy on a line. */
function lobsterPot(): THREE.Group {
  const g = new THREE.Group();
  const w = 0.36, d = 0.26;
  g.add(part('box', WOOD_DARK, w, 0.03, d, 0, 0.015, 0));
  for (let i = 0; i < 4; i++) {
    const hoop = mesh(new THREE.TorusGeometry(d / 2, 0.012, 4, 8, Math.PI), WOOD, 1, -w / 2 + 0.03 + (i * (w - 0.06)) / 3, 0.03, 0);
    hoop.rotation.y = Math.PI / 2;
    g.add(hoop);
  }
  for (const a of [0.35, 0.9, 1.57, 2.24, 2.79]) g.add(part('box', WOOD, w, 0.014, 0.014, 0, 0.03 + Math.sin(a) * (d / 2), Math.cos(a) * (d / 2)));
  // Netting inside the cage.
  const net = part('cyl', mat(NET, { opacity: 0.45 }), d / 2 - 0.01, w - 0.04, d / 2 - 0.01, 0, 0.03, 0, false);
  net.rotation.z = Math.PI / 2;
  g.add(net);
  // Buoy lying beside it.
  const buoy = new THREE.Group();
  buoy.add(part('sphere', RED, 0.075, 0.09, 0.075, 0, 0, 0));
  buoy.add(part('cyl', WHITE, 0.071, 0.035, 0.071, 0, 0, 0, false));
  buoy.add(part('cyl', WOOD_DARK, 0.012, 0.12, 0.012, 0, 0.12, 0, false));
  buoy.rotation.z = Math.PI / 2 - 0.3;
  buoy.position.set(0.04, 0.075, d / 2 + 0.09);
  g.add(buoy);
  return g;
}

/** A coil of rope lying flat, a loose end trailing off. */
function ropeCoil(): THREE.Group {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const r = mesh(ringGeo, ROPE, 1, 0, 0.018 + k * 0.03, 0);
    r.scale.set(0.12 - k * 0.012, 0.12 - k * 0.012, 0.09);
    r.rotation.x = Math.PI / 2;
    g.add(r);
  }
  const end = part('cyl', ROPE, 0.018, 0.22, 0.018, 0.16, 0.018, 0.06, false);
  end.rotation.z = Math.PI / 2;
  end.rotation.y = -0.5;
  g.add(end);
  return g;
}

/** A tin bucket with water and a couple of fish tails sticking out. */
function fishBucket(): THREE.Group {
  const g = new THREE.Group();
  g.add(part('cyl', '#8e99a3', 0.1, 0.2, 0.1, 0, 0.1, 0));
  g.add(part('cyl', '#5f6b75', 0.104, 0.02, 0.104, 0, 0.195, 0, false));
  g.add(part('cyl', mat('#4f9fb5', { opacity: 0.85 }), 0.09, 0.01, 0.09, 0, 0.18, 0, false));
  const handle = mesh(new THREE.TorusGeometry(0.1, 0.006, 4, 10, Math.PI), '#5f6b75', 1, 0, 0.2, 0);
  handle.rotation.y = 0.6;
  g.add(handle);
  for (const [x, z, a, c] of [[0.03, 0.01, 0.35, '#8fb3c4'], [-0.035, -0.02, -0.4, '#c9a66b']] as const) {
    const tail = part('cone4', c, 0.05, 0.1, 0.015, x, 0.24, z, false);
    tail.rotation.set(Math.PI, a, a * 0.6);
    g.add(tail);
  }
  return g;
}

/** A short post with a red-and-white life ring hanging on it, facing out over the water. */
function lifeRingPost(): THREE.Group {
  const g = new THREE.Group();
  g.add(part('box', POST, 0.08, 0.75, 0.08, 0, 0.375, 0));
  g.add(part('box', POST, 0.11, 0.04, 0.11, 0, 0.77, 0));
  const ring = new THREE.Group();
  for (let q = 0; q < 4; q++) {
    const m = mesh(quarterGeo, q % 2 ? WHITE : RED, 0.17, 0, 0, 0);
    m.rotation.z = (q * Math.PI) / 2 + Math.PI / 4;
    ring.add(m);
  }
  ring.position.set(0, 0.5, 0.06); // hung on the post's +z face; the group is turned to face the sea
  ring.rotation.x = -0.12;
  g.add(ring);
  g.add(part('cyl', ROPE, 0.012, 0.1, 0.012, 0, 0.64, 0.05, false));
  return g;
}

/** A post with an arm and a hanging lantern that glows at night. */
function lanternPost(): THREE.Group {
  const g = new THREE.Group();
  g.add(part('box', POST, 0.08, 1.25, 0.08, 0, 0.625, 0));
  g.add(part('box', POST, 0.32, 0.05, 0.05, -0.14, 1.2, 0)); // arm reaching in over the deck
  g.add(part('cyl', '#3b3b48', 0.006, 0.08, 0.006, -0.26, 1.13, 0, false));
  const lamp = new THREE.Group();
  lamp.position.set(-0.26, 0.98, 0);
  lamp.add(part('box', '#3b3b48', 0.13, 0.025, 0.13, 0, 0.11, 0));
  lamp.add(part('cone4', '#3b3b48', 0.1, 0.06, 0.1, 0, 0.15, 0));
  lamp.add(part('box', LANTERN_GLASS(), 0.09, 0.15, 0.09, 0, 0.025, 0, false));
  lamp.add(part('box', '#3b3b48', 0.12, 0.02, 0.12, 0, -0.055, 0));
  g.add(lamp);
  return g;
}

/** A rod standing in a holder on the deck edge, leaning out over the water. */
function rodInHolder(outward: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part('cyl', WOOD_DARK, 0.035, 0.16, 0.035, 0, 0.08, 0));
  const rod = fishingRodModel('basic');
  rod.position.set(0, 0.04, 0);
  rod.rotation.y = outward; // the rod leans towards the group's +z, turned to point out to sea
  rod.scale.setScalar(0.9);
  g.add(rod);
  return g;
}

/** A pile of folded net with cork floats along it. */
function netPile(): THREE.Group {
  const g = new THREE.Group();
  g.add(part('ico', NET, 0.2, 0.07, 0.15, 0, 0.05, 0));
  g.add(part('ico', '#6d7d68', 0.14, 0.06, 0.11, 0.06, 0.1, -0.03));
  for (const [x, z] of [[-0.14, 0.06], [-0.02, 0.13], [0.12, 0.08], [0.16, -0.07]]) g.add(part('cyl', '#e0b25a', 0.03, 0.035, 0.03, x, 0.08, z, false));
  return g;
}

export function dockProps(): THREE.Group {
  const g = new THREE.Group();
  const y = DOCK_Y;
  const put = (o: THREE.Object3D, x: number, z: number, rot = 0) => {
    o.position.set(x, y + o.position.y, z);
    o.rotation.y = rot;
    g.add(o);
    return o;
  };
  // West edge (−x), land end to sea end.
  put(crate(0.3), -0.8, -1.2, 0.08);
  const top = put(crate(0.22, '#b98450'), -0.79, -1.19, -0.35);
  top.position.y += 0.3;
  put(crate(0.24), -0.8, -0.86, 0.2);
  put(barrel(), -0.8, -0.45);
  put(fishBucket(), -0.78, 0.05);
  put(netPile(), -0.78, 0.55, 0.3);
  put(lifeRingPost(), -0.93, 1.0, -Math.PI / 2); // ring faces out to the west
  // East edge (+x).
  put(lanternPost(), 0.93, -1.3);
  put(lobsterPot(), 0.78, -0.75, Math.PI / 2 + 0.12);
  put(ropeCoil(), 0.8, -0.15, 0.9);
  put(rodInHolder(Math.PI / 4), 0.88, 0.6); // leaning out east and seawards
  put(barrel(), 0.82, 0.95);
  return g;
}
