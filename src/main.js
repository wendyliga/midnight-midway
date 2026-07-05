import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { SoundEngine } from './audio.js';

// ---------------------------------------------------------------------------
// Layout — 1 unit = 1 cm. Gravity, sizes and pusher speed are real-world
// values so the motion reads as a genuine machine, not game-float.
// ---------------------------------------------------------------------------
const FIELD_HALF_W = 23;        // play field is 46cm wide
const FIELD_TOP = 20;           // platform top surface height
const FIELD_FRONT = 15;         // front edge — coins fall off here
const PUSHER_TOP = 26;          // top surface of the sliding shelf
const PUSHER_FRONT_MID = -6;    // pusher front face oscillation center
const PUSHER_AMP = 3;           // ±3cm travel
const PUSHER_PERIOD = 3.2;      // seconds per full cycle
const SCRAPER_FRONT = -13;      // fixed wall that scrapes coins off the shelf
const DROP_Z = -10.5;           // coins drop onto the shelf here
const DROP_Y = 41;
const AIM_MAX = 16;             // can't aim over the channels — but drift can
const RING_Y = 33.5;            // lucky ring: thread it and the coin pays ×3
const RING_R = 5;
const RING_Z = DROP_Z;
const RING_AMP = 13;            // ring sweep half-width
const RING_PERIOD = 5.5;        // seconds per sweep cycle
const PLAY_HALF_W = 18;         // walkable felt; beyond it, side channels swallow coins
const TRAY_HALF_W = 24;         // payout tray — wider than the whole field
const DT = 1 / 120;             // physics substep
const GRAVITY = -981;           // cm/s²

const COIN_TYPES = {
  penny: { r: 1.9,  h: 0.5,  value: 1,  color: 0xd9a441, density: 1.0 },
  token: { r: 2.05, h: 0.55, value: 5,  color: 0xb8ddd6, density: 1.1 },
  medal: { r: 2.4,  h: 0.6,  value: 25, color: 0xe0684a, density: 1.25 },
};
const TOKEN_EVERY = 15;   // every Nth dropped coin is a lucky token
const MEDAL_EVERY = 75;   // every Nth is a jackpot medal
const START_BALANCE = 30;
const TIP_AMOUNT = 12;
const TIP_COOLDOWN = 45000;
const VOLLEY_NEED = 30;   // coins won per volley charge
const VOLLEY_MAX = 2;     // charges you can bank
const VOLLEY_SIZE = 5;    // coins per volley
const VOLLEY_SPACING = 4.4;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const sound = new SoundEngine();
let world, eventQueue;
let scene, camera, renderer;
let pusherBody, pusherMesh;
let ringBody, ringMesh;
let neighbors = [];
let coins = [];                  // { body, mesh, type, state, lastVel, wonAt }
let aimX = 0, aimTarget = 0;
let ghost, beam, carriage;
let dropCooldown = 0;
let dropCount = 0;
let pusherPhase = 0, lastPusherDir = 1;
let mouseNX = 0, mouseNY = 0;
let shakeT = 0;
let showerQueue = [];
let burst = { count: 0, last: 0, xs: [] };
let started = false;

const save = loadSave();
let balance = save.balance;
let totalWon = save.totalWon;
let muteState = save.muted;
let lastTip = save.lastTip;
let volleyCharges = save.vc;
let volleyProgress = save.vp;
let volleyCooldown = 0;

// House rules — bendable on the menu. Each maps to a real physical part of the
// machine; toggling one enables/disables its meshes and colliders live.
const SETTINGS = save.settings;
const pegHandles = [];      // brass deflector pins  { mesh, col }
const gutterGlows = [];     // red danger strips (shown only when gutters open)
const gutterCovers = [];    // rails that seal the side channels  { mesh, col }
const ringColliders = [];   // the lucky ring's physics segments

const els = {};
['balance', 'bal-num', 'subline', 'mute', 'help', 'home', 'helpModal', 'helpBody',
 'helpClose', 'hint', 'tipjar', 'volley', 'volleyWrap', 'volleyPips',
 'toasts', 'fx', 'overlay', 'boot', 'enter', 'rules', 'reset', 'stage',
 'credits-btn', 'creditsModal', 'creditsClose'].forEach(id => {
  els[id.replace(/-/g, '_')] = document.getElementById(id);
});

function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem('midway_save') || '{}');
    return {
      balance: Number.isFinite(s.balance) ? s.balance : START_BALANCE,
      totalWon: s.totalWon || 0,
      muted: !!s.muted,
      lastTip: s.lastTip || 0,
      drops: s.drops || 0,
      vc: s.vc || 0,
      vp: s.vp || 0,
      settings: normSettings(s.settings),
    };
  } catch { return { balance: START_BALANCE, totalWon: 0, muted: false, lastTip: 0, drops: 0, vc: 0, vp: 0, settings: normSettings() }; }
}
// House-rule defaults: the machine as designed (full house edge) is the norm.
function normSettings(s) {
  s = s || {};
  return {
    gutters: s.gutters !== false,  // house edge: open side channels that swallow coins
    pins: s.pins !== false,        // house edge: brass deflector pins scatter the pile
    ring: s.ring === true,         // player-favoring extra: the lucky ring pays ×3
    volley: s.volley === true,     // player-favoring extra: multi-coin volley drop
  };
}
let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem('midway_save', JSON.stringify(
        { balance, totalWon, muted: muteState, lastTip, drops: dropCount,
          vc: volleyCharges, vp: volleyProgress, settings: SETTINGS }));
    } catch { /* private mode */ }
  }, 250);
}
dropCount = save.drops;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  await RAPIER.init();
  initPhysicsWorld();
  initThree();
  buildMachine();
  buildCoinAssets();
  prefillField();
  warmup();
  bindUI();
  els.boot.textContent = 'the machine is running';
  els.enter.hidden = false;
  els.reset.hidden = false;
  els.rules.hidden = false;
  requestAnimationFrame(tick);
}

function initPhysicsWorld() {
  world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = DT;
  try { world.numSolverIterations = 8; } catch { /* older API */ }
  eventQueue = new RAPIER.EventQueue(true);
}

// ---------------------------------------------------------------------------
// Rendering setup
// ---------------------------------------------------------------------------
function initThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  els.stage.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  scene.fog = new THREE.Fog(0x05060c, 120, 260);

  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1, 400);
  applyCameraFraming();
  camera.position.set(0, 58, camDist);
  camera.lookAt(0, 23, -4);

  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  } catch { /* env map is a nicety */ }

  // Single hot tungsten spotlight — the whole mood of the machine.
  const spot = new THREE.SpotLight(0xffd9a6, 30000, 0, 0.42, 0.55, 1.6);
  spot.position.set(0, 100, 14);
  spot.target.position.set(0, 20, -2);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.camera.near = 30;
  spot.shadow.camera.far = 160;
  spot.shadow.bias = -0.0001;
  spot.shadow.normalBias = 0.6;
  scene.add(spot, spot.target);

  // Cold fill from the front-left so shadowed sides aren't pure black.
  const fill = new THREE.PointLight(0x44598f, 1500, 0, 1.8);
  fill.position.set(-42, 44, 52);
  scene.add(fill);

  // Warm glow inside the payout tray.
  const trayLight = new THREE.PointLight(0xffb26a, 420, 60, 1.9);
  trayLight.position.set(0, 13, 25);
  scene.add(trayLight);

  scene.add(new THREE.HemisphereLight(0x2a3350, 0x0a0908, 0.28));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    applyCameraFraming();
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ---------------------------------------------------------------------------
// Machine construction — every visible part has a matching static collider.
// ---------------------------------------------------------------------------
function staticBox(hx, hy, hz, x, y, z, material, rotX = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), material);
  mesh.position.set(x, y, z);
  if (rotX) mesh.rotation.x = rotX;
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);

  const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
    .setTranslation(x, y, z)
    .setFriction(0.45)
    .setRestitution(0.05);
  if (rotX) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, 0));
    desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  }
  world.createCollider(desc);
  return mesh;
}

function buildMachine() {
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x2c1219, roughness: 0.75, metalness: 0.1 });
  const feltMat = new THREE.MeshStandardMaterial({ color: 0x142229, roughness: 0.92, metalness: 0.05 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x3c4149, roughness: 0.4, metalness: 0.8, envMapIntensity: 0.5 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2a, roughness: 0.4, metalness: 0.8, envMapIntensity: 0.7 });

  // Brass deflector pegs near the front. Coins piled behind them get shoved
  // by the pusher and *hit* the pegs — dead centre gets scattered into the
  // channels the way real penny-falls do it. This is the whole house edge.
  const pegMat = new THREE.MeshStandardMaterial({
    color: 0xb08a3e, roughness: 0.3, metalness: 0.95,
    emissive: 0x3a2a0e, emissiveIntensity: 0.25 });
  const pegGeo = new THREE.CylinderGeometry(0.7, 0.7, 3, 14);
  const pegXs = [-14, -9, -4, 4, 9, 14];
  const pegZ = 9;
  for (const px of pegXs) {
    const mesh = new THREE.Mesh(pegGeo, pegMat);
    mesh.position.set(px, FIELD_TOP + 1.5, pegZ);
    mesh.castShadow = true;
    scene.add(mesh);
    const col = world.createCollider(
      RAPIER.ColliderDesc.cylinder(1.5, 0.7)
        .setTranslation(px, FIELD_TOP + 1.5, pegZ)
        .setFriction(0.15).setRestitution(0.55));
    pegHandles.push({ mesh, col });
  }

  // Play field platform (felt-covered) — extends back underneath the pusher.
  // Narrower than the cabinet: the strips between the felt edge and the side
  // walls are open channels, the house's cut, like on a real penny falls.
  staticBox(PLAY_HALF_W, 3, 24.5, 0, FIELD_TOP - 3, -9.5, feltMat);
  const railMat = new THREE.MeshStandardMaterial({ color: 0x101c22, roughness: 0.85, metalness: 0.1 });
  for (const sx of [-1, 1]) {
    // Brass lip marking the drop-off.
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 49), trimMat);
    lip.position.set(sx * (PLAY_HALF_W + 0.25), FIELD_TOP - 0.1, -9.5);
    scene.add(lip);
    // Faint red glow deep in the channel — danger reads at a glance.
    const danger = new THREE.Mesh(
      new THREE.PlaneGeometry(2.8, 49),
      new THREE.MeshBasicMaterial({ color: 0x451210, transparent: true, opacity: 0.85 }));
    danger.rotation.x = -Math.PI / 2;
    danger.position.set(sx * 21.5, 12, -9.5);
    scene.add(danger);
    gutterGlows.push(danger);

    // Sealing rail: a low kerb flush with the felt edge that closes the
    // channel when the house lets you play the "no side holes" rule.
    const rMesh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 5, 49), railMat);
    rMesh.position.set(sx * (PLAY_HALF_W + 0.45), FIELD_TOP + 0.5, -9.5);
    rMesh.castShadow = rMesh.receiveShadow = true;
    scene.add(rMesh);
    const rCol = world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.45, 2.5, 24.5)
        .setTranslation(sx * (PLAY_HALF_W + 0.45), FIELD_TOP + 0.5, -9.5)
        .setFriction(0.45).setRestitution(0.05));
    gutterCovers.push({ mesh: rMesh, col: rCol });
  }

  // Side walls.
  staticBox(1.5, 17, 26, -(FIELD_HALF_W + 1.5), 31, -8, cabinetMat);
  staticBox(1.5, 17, 26, FIELD_HALF_W + 1.5, 31, -8, cabinetMat);
  // Gold trim strip along the top of each side wall.
  for (const sx of [-1, 1]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 52), trimMat);
    trim.position.set(sx * (FIELD_HALF_W + 1.5), 48.2, -8);
    scene.add(trim);
  }

  // Back wall.
  staticBox(FIELD_HALF_W + 3, 20, 2, 0, 34, -36, cabinetMat);

  // Scraper: fixed wall just above the pusher's top surface. Coins riding the
  // shelf hit it on the retract stroke and get walked forward — the actual
  // mechanism of a real penny falls.
  staticBox(FIELD_HALF_W, 4, 3.5, 0, PUSHER_TOP + 0.2 + 4, SCRAPER_FRONT - 3.5, steelMat);

  // Marquee panel above the scraper with painted branding.
  const marquee = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 20),
    new THREE.MeshStandardMaterial({ map: makeMarqueeTexture(), roughness: 0.6, metalness: 0.1 }));
  marquee.position.set(0, 40.5, -16.4);
  marquee.rotation.x = -0.06;
  scene.add(marquee);

  // The pusher itself — kinematic body, slides under the scraper.
  const pusherDepth = 13;
  pusherBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, 23, PUSHER_FRONT_MID - pusherDepth));
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(FIELD_HALF_W - 0.3, 3, pusherDepth)
      .setFriction(0.5).setRestitution(0), pusherBody);
  pusherMesh = new THREE.Mesh(
    new THREE.BoxGeometry((FIELD_HALF_W - 0.3) * 2, 6, pusherDepth * 2),
    new THREE.MeshStandardMaterial({ color: 0x2c3641, roughness: 0.3, metalness: 0.8, envMapIntensity: 0.5 }));
  pusherMesh.castShadow = pusherMesh.receiveShadow = true;
  scene.add(pusherMesh);
  // Warm accent stripe on the pusher face.
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry((FIELD_HALF_W - 0.3) * 2, 0.7, 0.3),
    new THREE.MeshStandardMaterial({ color: 0xb8862e, roughness: 0.35, metalness: 0.85, emissive: 0x3a2708, emissiveIntensity: 0.6 }));
  stripe.position.set(0, 2.2, pusherDepth + 0.05);
  pusherMesh.add(stripe);

  // Payout tray: sloped toward the player, only in the center band. The side
  // margins are open gutters — the house keeps what falls there.
  const traySlope = 0.11;
  staticBox(TRAY_HALF_W, 1, 9.2, 0, 5.9, 23.4, steelMat, traySlope);
  staticBox(0.8, 2.5, 9, -(TRAY_HALF_W + 0.8), 8, 23.5, cabinetMat);
  staticBox(0.8, 2.5, 9, TRAY_HALF_W + 0.8, 8, 23.5, cabinetMat);
  staticBox(TRAY_HALF_W + 1.6, 2.2, 0.8, 0, 7.2, 32.8, cabinetMat);
  // Seal the tray's back corners so coins can't slip out under the walls.
  staticBox(1.9, 4, 0.6, -22.9, 10, 14.2, cabinetMat);
  staticBox(1.9, 4, 0.6, 22.9, 10, 14.2, cabinetMat);

  // Glowing slot strip on the tray lip — where your winnings disappear to.
  const slotGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(TRAY_HALF_W * 2 - 2, 1.2),
    new THREE.MeshBasicMaterial({ color: 0xffc97a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  slotGlow.position.set(0, 8.5, 32.5);
  slotGlow.rotation.x = -0.5;
  scene.add(slotGlow);

  // Cabinet front below the tray.
  staticBox(FIELD_HALF_W + 3, 6, 2, 0, 0, 34, cabinetMat);

  // Marquee bulbs — the carnival string lights, a few of them dying.
  buildBulbs();

  // Dropper carriage that follows your aim across the top.
  carriage = new THREE.Group();
  const carBody = new THREE.Mesh(new THREE.BoxGeometry(7, 3.4, 5),
    new THREE.MeshStandardMaterial({ color: 0x1f232b, roughness: 0.4, metalness: 0.7 }));
  const carTrim = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 5.4), trimMat);
  carTrim.position.y = -1.6;
  carriage.add(carBody, carTrim);
  carriage.position.set(0, DROP_Y + 2.6, DROP_Z);
  scene.add(carriage);
  // Rail it slides on.
  const rail = new THREE.Mesh(new THREE.BoxGeometry(FIELD_HALF_W * 2 + 4, 1.2, 1.2), steelMat);
  rail.position.set(0, DROP_Y + 4.6, DROP_Z);
  scene.add(rail);

  // Aim ghost: translucent coin + faint light beam down to the shelf.
  const t = COIN_TYPES.penny;
  ghost = new THREE.Mesh(
    new THREE.CylinderGeometry(t.r, t.r, t.h, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.5, depthWrite: false }));
  ghost.position.set(0, DROP_Y, DROP_Z);
  scene.add(ghost);
  beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.9, DROP_Y - PUSHER_TOP, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffc97a, transparent: true, opacity: 0.10, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.set(0, (DROP_Y + PUSHER_TOP) / 2, DROP_Z);
  scene.add(beam);

  buildRing();
  buildNeighbors();
  applySettings();
}

// Reflect the current house rules onto the live machine — swap meshes and
// enable/disable colliders. Safe to call any time (menu toggle or boot).
function applySettings() {
  for (const { mesh, col } of pegHandles) { mesh.visible = SETTINGS.pins; col.setEnabled(SETTINGS.pins); }
  for (const { mesh, col } of gutterCovers) { mesh.visible = !SETTINGS.gutters; col.setEnabled(!SETTINGS.gutters); }
  for (const g of gutterGlows) g.visible = SETTINGS.gutters;
  for (const col of ringColliders) col.setEnabled(SETTINGS.ring);
  if (ringMesh) ringMesh.visible = SETTINGS.ring;
  if (els.volleyWrap) els.volleyWrap.style.display = SETTINGS.volley ? '' : 'none';
}

// The rest of the arcade: neighbouring machines at the edge of vision.
// Painted on canvas, then blurred — a cheap, convincing depth-of-field.
function buildNeighbors() {
  const paintCabinet = (accent, screen) => {
    const w = 256, h = 384;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#120a0e';
    g.fillRect(58, 40, 140, 320);
    g.fillStyle = '#1c1016';
    g.fillRect(50, 30, 156, 46);
    g.globalAlpha = 0.85;
    g.fillStyle = accent;
    g.fillRect(58, 44, 140, 16);
    g.globalAlpha = 1;
    g.fillStyle = '#05070a';
    g.fillRect(70, 100, 116, 90);
    const sg = g.createRadialGradient(128, 148, 8, 128, 148, 72);
    sg.addColorStop(0, screen);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = sg;
    g.fillRect(70, 100, 116, 90);
    g.fillStyle = '#221420';
    g.fillRect(64, 196, 128, 26);
    g.globalAlpha = 0.7;
    g.fillStyle = accent;
    for (const bx of [100, 126, 152]) {
      g.beginPath(); g.arc(bx, 209, 5, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#0a0608';
    g.fillRect(64, 222, 128, 138);
    const fg = g.createRadialGradient(128, 360, 5, 128, 360, 80);
    fg.addColorStop(0, screen);
    fg.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.35;
    g.fillStyle = fg;
    g.fillRect(28, 316, 200, 68);
    g.globalAlpha = 1;
    // The out-of-focus pass: redraw the whole cabinet through a blur.
    const c2 = document.createElement('canvas');
    c2.width = w; c2.height = h;
    const g2 = c2.getContext('2d');
    g2.filter = 'blur(7px)';
    g2.drawImage(c, 0, 0);
    const tex = new THREE.CanvasTexture(c2);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };

  const defs = [
    { x: -50, z: -14, ry: 0.72, accent: 'rgba(90,220,190,1)', screen: 'rgba(70,190,160,0.9)', light: 0x2a8a74 },
    { x: 51, z: -18, ry: -0.74, accent: 'rgba(230,120,90,1)', screen: 'rgba(210,110,70,0.9)', light: 0x8a3a24 },
  ];
  for (const d of defs) {
    const mat = new THREE.MeshBasicMaterial({
      map: paintCabinet(d.accent, d.screen),
      transparent: true, opacity: 0.9, depthWrite: false, fog: true });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(62, 93), mat);
    plane.position.set(d.x, 40, d.z);
    plane.rotation.y = d.ry;
    scene.add(plane);
    // Their screens tint our cabinet's flanks.
    const glow = new THREE.PointLight(d.light, 700, 100, 1.8);
    glow.position.set(d.x * 0.8, 32, d.z + 18);
    scene.add(glow);
    neighbors.push({ mat, phase: Math.random() * 10 });
  }
}

// The lucky ring: a brass hoop gliding across the drop path. It is a real
// kinematic body — a circle of capsule colliders — so a clipped rim
// ricochets the coin instead of a scripted miss.
function buildRing() {
  ringBody = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased()
    .setTranslation(0, RING_Y, RING_Z));
  const segs = 10;
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const tangent = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const q = new THREE.Quaternion().setFromUnitVectors(up, tangent);
    ringColliders.push(world.createCollider(
      RAPIER.ColliderDesc.capsule(RING_R * Math.sin(Math.PI / segs), 0.45)
        .setTranslation(Math.cos(a) * RING_R, 0, Math.sin(a) * RING_R)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.2)
        .setRestitution(0.35), ringBody));
  }

  ringMesh = new THREE.Group();
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(RING_R, 0.5, 12, 48),
    new THREE.MeshStandardMaterial({
      color: 0xb08a3e, roughness: 0.3, metalness: 0.9,
      emissive: 0x664411, emissiveIntensity: 0.3, envMapIntensity: 0.8 }));
  torus.rotation.x = Math.PI / 2;
  torus.castShadow = true;
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(RING_R - 0.55, 0.09, 6, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffd98a, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.rotation.x = Math.PI / 2;
  ringMesh.add(torus, glow);
  ringMesh.position.set(0, RING_Y, RING_Z);
  scene.add(ringMesh);
}

function makeMarqueeTexture() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 448;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 448);
  grad.addColorStop(0, '#3a1520'); grad.addColorStop(1, '#220c13');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 448);
  g.strokeStyle = '#8a6a2a'; g.lineWidth = 10;
  g.strokeRect(22, 22, 980, 404);
  g.strokeStyle = 'rgba(138,106,42,0.5)'; g.lineWidth = 3;
  g.strokeRect(40, 40, 944, 368);
  g.textAlign = 'center';
  g.fillStyle = '#e8c476';
  g.font = '500 92px Georgia, serif';
  g.fillText('M I D N I G H T', 512, 160);
  g.fillText('M I D W A Y', 512, 262);
  g.fillStyle = '#9b8a6a';
  g.font = '400 36px Georgia, serif';
  g.fillText('★  P E N N Y   F A L L S  ★', 512, 350);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let bulbs = [];
function buildBulbs() {
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const rad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    rad.addColorStop(0, 'rgba(255,225,170,1)');
    rad.addColorStop(0.35, 'rgba(255,190,110,0.45)');
    rad.addColorStop(1, 'rgba(255,170,80,0)');
    g.fillStyle = rad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();

  const bulbGeo = new THREE.SphereGeometry(0.85, 10, 8);
  const positions = [];
  // Across the marquee top.
  for (let i = 0; i <= 9; i++) positions.push([-21 + i * 4.67, 51.4, -16]);
  // Down the side walls' front edges.
  for (let i = 0; i < 4; i++) {
    positions.push([-(FIELD_HALF_W + 1.5), 46 - i * 7.5, 17.5]);
    positions.push([FIELD_HALF_W + 1.5, 46 - i * 7.5, 17.5]);
  }
  positions.forEach(([x, y, z], i) => {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a3418, emissive: 0xffb35a, emissiveIntensity: 1.6, roughness: 0.4 });
    const bulb = new THREE.Mesh(bulbGeo, mat);
    bulb.position.set(x, y, z);
    scene.add(bulb);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffc97a, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false }));
    sprite.scale.set(6, 6, 1);
    sprite.position.copy(bulb.position);
    scene.add(sprite);
    bulbs.push({
      mat, sprite,
      phase: Math.random() * Math.PI * 2,
      dying: i === 3 || i === 14,   // two bulbs flicker erratically
    });
  });
}

function updateBulbs(t) {
  for (const b of bulbs) {
    let k = 0.86 + 0.14 * Math.sin(t * 1.7 + b.phase);
    if (b.dying) {
      const n = Math.sin(t * 13 + b.phase) * Math.sin(t * 2.7 + b.phase * 3);
      if (n > 0.55) k *= 0.12;
    }
    b.mat.emissiveIntensity = 1.6 * k;
    b.sprite.material.opacity = 0.55 * k;
  }
}

// ---------------------------------------------------------------------------
// Coins
// ---------------------------------------------------------------------------
const coinAssets = {};
function makeCoinFaceCanvas(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  // Drawn in grayscale so the material color tints it.
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#c8c8c8'; g.lineWidth = 10;
  g.beginPath(); g.arc(128, 128, 116, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#6a6a6a'; g.lineWidth = 3;
  g.beginPath(); g.arc(128, 128, 100, 0, Math.PI * 2); g.stroke();
  // Rim dots.
  g.fillStyle = '#b5b5b5';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.arc(128 + Math.cos(a) * 108, 128 + Math.sin(a) * 108, 4, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#d2d2d2';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (kind === 'penny') {
    // Five-point star.
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 62 : 26;
      const x = 128 + Math.cos(a) * r, y = 128 + Math.sin(a) * r;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.closePath(); g.fill();
  } else if (kind === 'token') {
    g.save(); g.translate(128, 128); g.rotate(Math.PI / 4);
    g.fillRect(-44, -44, 88, 88);
    g.restore();
    g.fillStyle = '#7a7a7a';
    g.font = 'bold 52px Georgia, serif';
    g.fillText('5', 128, 132);
  } else {
    g.font = 'bold 92px Georgia, serif';
    g.fillText('25', 128, 122);
    g.font = 'bold 30px Georgia, serif';
    g.fillText('★ JACKPOT ★', 128, 196);
  }
  return c;
}

function makeCoinFace(kind) {
  const tex = new THREE.CanvasTexture(makeCoinFaceCanvas(kind));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildCoinAssets() {
  for (const [kind, t] of Object.entries(COIN_TYPES)) {
    const geo = new THREE.CylinderGeometry(t.r, t.r, t.h, 28);
    const face = makeCoinFace(kind);
    const capMat = new THREE.MeshStandardMaterial({
      color: t.color, map: face, metalness: 0.85, roughness: 0.32, envMapIntensity: 0.7 });
    const sideMat = new THREE.MeshStandardMaterial({
      color: t.color, metalness: 0.9, roughness: 0.4, envMapIntensity: 0.7 });
    // Gilded variants for coins that threaded the ring — they glow.
    const chargedCap = capMat.clone();
    const chargedSide = sideMat.clone();
    for (const m of [chargedCap, chargedSide]) {
      m.emissive = new THREE.Color(0xd08a2a);
      m.emissiveIntensity = 0.35;
    }
    coinAssets[kind] = {
      geo,
      mats: [sideMat, capMat, capMat],
      chargedMats: [chargedSide, chargedCap, chargedCap],
    };
  }
}

function spawnCoin(kind, x, y, z, opts = {}) {
  const t = COIN_TYPES[kind];
  const yaw = Math.random() * Math.PI * 2;
  const tiltX = opts.flat ? 0 : (Math.random() - 0.5) * 0.5;
  const tiltZ = opts.flat ? 0 : (Math.random() - 0.5) * 0.5;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tiltX, yaw, tiltZ));

  const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    .setLinvel(opts.vx || 0, opts.vy || 0, opts.vz || 0)
    .setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3, z: (Math.random() - 0.5) * 3 })
    .setLinearDamping(0.06)
    .setAngularDamping(0.5)
    .setCcdEnabled(true));
  world.createCollider(RAPIER.ColliderDesc.cylinder(t.h / 2, t.r)
    .setFriction(0.35)
    .setRestitution(0.18)
    .setDensity(t.density), body);

  const a = coinAssets[kind];
  const mesh = new THREE.Mesh(a.geo, a.mats);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.position.set(x, y, z);
  mesh.quaternion.copy(q);
  scene.add(mesh);

  const coin = {
    body, mesh, type: kind, state: 'field', charged: false,
    lastVel: { x: 0, y: 0, z: 0 }, prev: { x, y, z }, wonAt: 0,
  };
  coins.push(coin);
  return coin;
}

function removeCoin(coin) {
  world.removeRigidBody(coin.body);
  scene.remove(coin.mesh);
  const i = coins.indexOf(coin);
  if (i >= 0) coins.splice(i, 1);
}

// Fill the field with a settled bed of coins, a few specials buried in it.
function prefillField() {
  let n = 0;
  for (let layer = 0; layer < 2; layer++) {
    const y = FIELD_TOP + 0.4 + layer * 1.3;
    for (let gx = -15; gx <= 15; gx += 4.2) {
      for (let gz = -5 + layer * 2; gz <= 12; gz += 4.2) {
        const x = gx + (Math.random() - 0.5) * 2.2 + (layer ? 2.1 : 0);
        const z = gz + (Math.random() - 0.5) * 2.2;
        if (Math.abs(x) > 18) continue;
        let kind = 'penny';
        if (n % 17 === 8) kind = 'token';
        if (n === 23) kind = 'medal';
        spawnCoin(kind, x, y, z, { flat: true });
        n++;
      }
    }
  }
  // A few riding the shelf already.
  for (let i = 0; i < 6; i++) {
    spawnCoin('penny', -12 + i * 4.8, PUSHER_TOP + 0.4, -11 + (Math.random() - 0.5) * 2, { flat: true });
  }
}

// Let the bed settle before the curtain lifts, then cull anything that
// slipped over an edge so reloading never hands out free wins.
function warmup() {
  for (let i = 0; i < 240; i++) {
    stepPusher();
    stepRing();
    world.step(eventQueue);
  }
  for (const c of [...coins]) {
    if (c.body.translation().y < 18) removeCoin(c);
  }
  for (const c of coins) syncCoin(c);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function stepPusher() {
  pusherPhase += DT;
  const cyc = (pusherPhase % PUSHER_PERIOD) / PUSHER_PERIOD;
  const front = PUSHER_FRONT_MID + PUSHER_AMP * Math.sin(cyc * Math.PI * 2);
  pusherBody.setNextKinematicTranslation({ x: 0, y: 23, z: front - 13 });
  const dir = Math.cos(cyc * Math.PI * 2) >= 0 ? 1 : -1;
  if (dir !== lastPusherDir) {
    lastPusherDir = dir;
    if (started) sound.pusherClunk();
  }
}

function stepRing() {
  // pusherPhase advances by DT each step — reuse it as the machine clock.
  const x = RING_AMP * Math.sin((pusherPhase * 2 * Math.PI) / RING_PERIOD);
  ringBody.setNextKinematicTranslation({ x, y: RING_Y, z: RING_Z });
}

function syncCoin(c) {
  const p = c.body.translation();
  const q = c.body.rotation();
  c.mesh.position.set(p.x, p.y, p.z);
  c.mesh.quaternion.set(q.x, q.y, q.z, q.w);
}

function updateCoins(nowMs) {
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i];
    const p = c.body.translation();

    // Impact sounds from sharp velocity changes.
    if (started && !c.body.isSleeping()) {
      const v = c.body.linvel();
      const dv = Math.hypot(v.x - c.lastVel.x, v.y - c.lastVel.y, v.z - c.lastVel.z);
      if (dv > 95) {
        sound.clink(Math.min(1, (dv - 95) / 420), p.x / FIELD_HALF_W);
      }
      c.lastVel = { x: v.x, y: v.y, z: v.z };
    }

    // Threading the lucky ring gilds the coin — it will pay triple. The
    // crossing point is interpolated between frames so fast coins can't
    // tunnel past the check.
    if (SETTINGS.ring && c.state === 'field' && !c.charged && c.prev.y > RING_Y && p.y <= RING_Y) {
      const k = (c.prev.y - RING_Y) / (c.prev.y - p.y);
      const cx = c.prev.x + (p.x - c.prev.x) * k;
      const cz = c.prev.z + (p.z - c.prev.z) * k;
      const rp = ringBody.translation();
      if (Math.hypot(cx - rp.x, cz - rp.z) < RING_R - 0.5 - COIN_TYPES[c.type].r - 0.1) {
        chargeCoin(c, cx, cz);
      }
    }

    if (c.state === 'field') {
      // Fell into the payout tray → this coin pays out.
      if (p.y < 11 && p.z > 14.5 && p.z < 33.5 && Math.abs(p.x) <= TRAY_HALF_W + 0.5) {
        if (!started) { removeCoin(c); continue; }
        c.state = 'won';
        c.wonAt = nowMs;
        onCoinWon(c, p);
      } else if (p.y < 0) {
        // Fell past the tray sides — the house keeps it.
        c.state = 'gutter';
        sound.thunk(p.x / FIELD_HALF_W);
      }
    } else if (c.state === 'won') {
      // Let it clatter in the tray for a beat, then swallow it into the slot.
      const age = nowMs - c.wonAt;
      if (age > 900) {
        const k = Math.max(0, 1 - (age - 900) / 250);
        c.mesh.scale.setScalar(k);
        if (k <= 0) { removeCoin(c); continue; }
      }
    }

    if (p.y < -40) { removeCoin(c); continue; }
    syncCoin(c);
    c.prev = { x: p.x, y: p.y, z: p.z };
  }
}

function chargeCoin(c, x, z) {
  c.charged = true;
  c.mesh.material = coinAssets[c.type].chargedMats;
  popup('×3', worldToScreen(x, RING_Y, RING_Z), 'charged');
  sound.thread();
}

function onCoinWon(c, p) {
  const t = COIN_TYPES[c.type];
  const now = performance.now();

  // Burst tracking for cascade bonuses.
  if (now - burst.last > 2500) { burst.count = 0; burst.xs = []; }
  burst.count++;
  burst.xs.push(p.x);
  burst.last = now;

  const val = t.value * (c.charged ? 3 : 1);
  balance += val;
  totalWon += val;

  // Winnings fill the volley meter.
  if (volleyCharges < VOLLEY_MAX) {
    volleyProgress += val;
    while (volleyProgress >= VOLLEY_NEED && volleyCharges < VOLLEY_MAX) {
      volleyProgress -= VOLLEY_NEED;
      volleyCharges++;
      toast('VOLLEY READY — PRESS V');
      sound.special();
    }
    if (volleyCharges >= VOLLEY_MAX) volleyProgress = 0;
    refreshVolley();
  }

  const screen = worldToScreen(p.x, p.y, p.z);
  if (c.type === 'penny') {
    popup(`+${val}`, screen, c.charged ? 'charged' : '');
    if (c.charged) sound.gilded(p.x / FIELD_HALF_W);
    else sound.collect(p.x / FIELD_HALF_W, burst.count - 1);
  } else if (c.type === 'token') {
    popup(`+${val}`, screen, c.charged ? 'charged' : 'silver');
    toast(c.charged ? `GILDED TOKEN +${val}` : 'LUCKY TOKEN +5');
    sound.special();
  } else {
    popup(`+${val}`, screen, c.charged ? 'charged' : 'red');
    toast('★ JACKPOT ★', true);
    sound.jackpot();
    shakeT = 0.6;
    scheduleShower();
  }
  bumpBalance();
  refreshHud();
  persist();
}

// Jackpot rains bonus coins onto the field.
function scheduleShower() {
  const t0 = performance.now();
  for (let i = 0; i < 12; i++) {
    showerQueue.push({
      at: t0 + 250 + i * 120,
      x: -14 + Math.random() * 28,
      z: 0 + Math.random() * 11,
    });
  }
}

function processShower(now) {
  while (showerQueue.length && showerQueue[0].at <= now) {
    const s = showerQueue.shift();
    spawnCoin('penny', s.x, 52, s.z);
    sound.clink(0.4, s.x / FIELD_HALF_W);
  }
}

function endBurstCheck(now) {
  if (burst.count > 0 && now - burst.last > 2500) {
    // Cascade rewards *spread*, not spam: coins have to have landed across
    // the tray, not all in one column. Center-spam clusters — this refuses
    // to pay it. Spread = (max x − min x).
    if (burst.count >= 4) {
      const spread = Math.max(...burst.xs) - Math.min(...burst.xs);
      if (spread >= 12) {
        const bonus = Math.min(burst.count - 2, 8);
        balance += bonus;
        toast(`CASCADE ×${burst.count}  +${bonus}`);
        sound.special();
        bumpBalance();
        refreshHud();
        persist();
      }
    }
    burst.count = 0; burst.xs = [];
  }
}

// ---------------------------------------------------------------------------
// Field guide (help modal) — icons drawn with the same art as the game.
// ---------------------------------------------------------------------------
function buildHelp() {
  const icon = draw => {
    const c = document.createElement('canvas');
    c.width = c.height = 112;
    draw(c.getContext('2d'), 112);
    return c.toDataURL();
  };
  const cssColor = k => '#' + COIN_TYPES[k].color.toString(16).padStart(6, '0');

  const coinIcon = kind => icon((g, S) => {
    g.drawImage(makeCoinFaceCanvas(kind), 8, 8, S - 16, S - 16);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = cssColor(kind);
    g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'destination-in';
    g.beginPath(); g.arc(S / 2, S / 2, (S - 16) / 2, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'source-over';
    const hl = g.createRadialGradient(S * 0.36, S * 0.3, 4, S * 0.36, S * 0.3, S * 0.55);
    hl.addColorStop(0, 'rgba(255,255,255,0.4)');
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl;
    g.beginPath(); g.arc(S / 2, S / 2, (S - 16) / 2, 0, Math.PI * 2); g.fill();
  });

  const ringIcon = icon((g, S) => {
    g.strokeStyle = '#d8b25c'; g.lineWidth = 8;
    g.shadowColor = 'rgba(232,180,90,0.8)'; g.shadowBlur = 14;
    g.beginPath(); g.ellipse(S / 2, S * 0.64, S * 0.36, S * 0.15, 0, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 6; g.fillStyle = '#d9a441';
    g.beginPath(); g.ellipse(S / 2, S * 0.24, 13, 6, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(217,164,65,0.5)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(S / 2, S * 0.32); g.lineTo(S / 2, S * 0.5); g.stroke();
  });

  const volleyIcon = icon((g, S) => {
    g.fillStyle = '#d9a441';
    g.shadowColor = 'rgba(232,180,90,0.7)'; g.shadowBlur = 8;
    for (let i = 0; i < 5; i++) {
      const x = S * 0.14 + i * S * 0.18, y = S * 0.3 + (i % 2) * 9;
      g.beginPath(); g.ellipse(x, y, 8.5, 4.2, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(217,164,65,0.45)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x, y + 9); g.lineTo(x, y + 30); g.stroke();
    }
  });

  const trayIcon = icon((g, S) => {
    // Field with its side channels, full-width tray beneath.
    g.fillStyle = '#3c4149';
    g.fillRect(S * 0.06, S * 0.14, S * 0.88, S * 0.2);
    g.fillStyle = 'rgba(150,50,50,0.9)';
    g.fillRect(S * 0.06, S * 0.14, S * 0.09, S * 0.2);
    g.fillRect(S * 0.85, S * 0.14, S * 0.09, S * 0.2);
    g.fillStyle = 'rgba(216,178,92,0.95)';
    g.fillRect(S * 0.06, S * 0.52, S * 0.88, S * 0.3);
    g.fillStyle = '#171310'; g.font = 'bold 22px Georgia, serif'; g.textAlign = 'center';
    g.fillText('✓', S * 0.5, S * 0.74);
    g.fillStyle = 'rgba(255,170,150,0.95)'; g.font = 'bold 15px Georgia, serif';
    g.fillText('×', S * 0.105, S * 0.28);
    g.fillText('×', S * 0.895, S * 0.28);
  });

  const cascadeIcon = icon((g, S) => {
    g.fillStyle = '#d9a441';
    g.shadowColor = 'rgba(232,180,90,0.7)'; g.shadowBlur = 8;
    for (const [px, py] of [[0.3, 0.22], [0.55, 0.38], [0.4, 0.56], [0.65, 0.72]]) {
      g.beginPath(); g.ellipse(S * px, S * py, 10, 4.8, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = '#e8c476'; g.font = 'bold 26px Georgia, serif';
    g.fillText('+', S * 0.72, S * 0.3);
  });

  const tipIcon = icon((g, S) => {
    g.strokeStyle = '#9b8a6a'; g.lineWidth = 4;
    g.beginPath();
    g.moveTo(S * 0.3, S * 0.26); g.lineTo(S * 0.26, S * 0.78);
    g.quadraticCurveTo(S * 0.5, S * 0.88, S * 0.74, S * 0.78);
    g.lineTo(S * 0.7, S * 0.26); g.stroke();
    g.strokeStyle = '#c8b078';
    g.beginPath(); g.moveTo(S * 0.24, S * 0.26); g.lineTo(S * 0.76, S * 0.26); g.stroke();
    g.fillStyle = '#d9a441';
    for (const [px, py] of [[0.42, 0.68], [0.56, 0.72], [0.48, 0.6]]) {
      g.beginPath(); g.ellipse(S * px, S * py, 8, 3.8, 0, 0, Math.PI * 2); g.fill();
    }
  });

  const entries = [
    [coinIcon('penny'), 'Penny',
     'Pays 1 when it falls into the tray. The bread and butter of the midway.'],
    [coinIcon('token'), 'Lucky Token',
     `Pays ${COIN_TYPES.token.value}. Every ${TOKEN_EVERY}th coin you drop is a token.`],
    [coinIcon('medal'), 'Jackpot Medal',
     `Pays ${COIN_TYPES.medal.value} and rains a dozen bonus coins onto the field. Every ${MEDAL_EVERY}th drop.`],
    [ringIcon, 'The Lucky Ring',
     'Thread a falling coin through the drifting brass ring and it turns gilded — it pays ×3 when it lands. Clip the rim and it ricochets.'],
    [volleyIcon, 'Volley',
     `Every ${VOLLEY_NEED} coins won earns a volley charge (you can bank ${VOLLEY_MAX}). Press V or tap the button to drop ${VOLLEY_SIZE} coins in a row at once.`],
    [trayIcon, 'Tray & Channels',
     'The full-width front tray pays you back — anything over the edge is yours. But the narrow red channels along each side of the felt feed the house. Watch your edges.'],
    [cascadeIcon, 'Cascade',
     'Four or more coins falling within a breath of each other pays a bonus on top.'],
    [tipIcon, 'The Tip Jar',
     `Flat broke? The house takes pity with +${TIP_AMOUNT}, once every ${TIP_COOLDOWN / 1000} seconds.`],
  ];

  els.helpBody.innerHTML = '';
  for (const [src, title, text] of entries) {
    const row = document.createElement('div');
    row.className = 'h-row';
    const img = new Image();
    img.src = src; img.alt = title;
    const div = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    div.append(b, p);
    row.append(img, div);
    els.helpBody.appendChild(row);
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
// Animated vignettes for each house-rule card. Each painter is called every
// frame with a time parameter (seconds) — the coin actually moves so the card
// previews the mechanic. Same canvas idiom as the help modal so the menu and
// the field guide share a visual language.
const rulePainters = {
  gutters: (g, S, t) => {
    // Sliver of felt with red gutters — a coin walks right and tumbles in.
    g.fillStyle = '#142229';
    g.fillRect(S * 0.16, S * 0.22, S * 0.68, S * 0.56);
    g.fillStyle = '#5a1a18';
    g.fillRect(S * 0.06, S * 0.22, S * 0.10, S * 0.56);
    g.fillRect(S * 0.84, S * 0.22, S * 0.10, S * 0.56);
    // pulsing danger glow in the gutter
    const pulse = 0.55 + 0.35 * Math.sin(t * 3.5);
    g.fillStyle = `rgba(200,60,50,${pulse * 0.5})`;
    g.fillRect(S * 0.06, S * 0.22, S * 0.10, S * 0.56);
    g.fillRect(S * 0.84, S * 0.22, S * 0.10, S * 0.56);
    g.strokeStyle = '#b08a3e'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(S * 0.16, S * 0.22); g.lineTo(S * 0.16, S * 0.78);
    g.moveTo(S * 0.84, S * 0.22); g.lineTo(S * 0.84, S * 0.78); g.stroke();
    // Coin travels left → right on a 2.4s loop, shrinks as it falls in.
    const cyc = (t % 2.4) / 2.4;
    const x = S * (0.22 + cyc * 0.72);
    const inGutter = x > S * 0.84;
    const fall = inGutter ? Math.min(1, (x - S * 0.84) / (S * 0.08)) : 0;
    const rx = 7 * (1 - fall * 0.6), ry = 3.4 * (1 - fall * 0.8);
    g.fillStyle = '#d9a441';
    g.shadowColor = 'rgba(232,180,90,0.7)'; g.shadowBlur = 8;
    g.beginPath(); g.ellipse(x, S * 0.5 + fall * 3, rx, ry, 0, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  },
  pins: (g, S, t) => {
    // Overhead view — a coin drops from top and ricochets off a pin.
    g.fillStyle = '#142229';
    g.fillRect(S * 0.08, S * 0.22, S * 0.84, S * 0.56);
    g.fillStyle = '#b08a3e';
    g.shadowColor = 'rgba(232,180,90,0.6)'; g.shadowBlur = 6;
    for (let i = 0; i < 5; i++) {
      const x = S * (0.18 + i * 0.16);
      g.beginPath(); g.arc(x, S * 0.5, 5.5, 0, Math.PI * 2); g.fill();
    }
    g.shadowBlur = 0;
    // Coin path: descends to y≈0.5 (pin row), then peels off to the side.
    const cyc = (t % 2.2) / 2.2;
    const pinIdx = Math.floor((t / 2.2) % 5);
    const pinX = S * (0.18 + pinIdx * 0.16);
    let cx, cy;
    if (cyc < 0.45) {
      cx = pinX; cy = S * (0.24 + cyc / 0.45 * 0.24);
    } else {
      const k = (cyc - 0.45) / 0.55;
      const dir = (pinIdx % 2 === 0) ? 1 : -1;
      cx = pinX + dir * S * 0.16 * k;
      cy = S * (0.48 + 0.28 * k);
    }
    g.fillStyle = '#d9a441';
    g.shadowColor = 'rgba(232,180,90,0.7)'; g.shadowBlur = 8;
    g.beginPath(); g.ellipse(cx, cy, 5.5, 2.6, 0, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  },
  ring: (g, S, t) => {
    // Brass ring swings side-to-side, a coin drops through the middle.
    const swing = Math.sin(t * 1.8);
    const rx = S / 2 + swing * S * 0.14;
    g.strokeStyle = '#d8b25c'; g.lineWidth = 7;
    g.shadowColor = 'rgba(232,180,90,0.8)'; g.shadowBlur = 14;
    g.beginPath(); g.ellipse(rx, S * 0.6, S * 0.28, S * 0.12, 0, 0, Math.PI * 2); g.stroke();
    g.shadowBlur = 0;
    // Coin drop cycle 2.6s, threads the ring at t≈0.55 of cycle.
    const cyc = (t % 2.6) / 2.6;
    const cx = rx;                                   // dropper follows the ring
    const cy = S * (0.14 + cyc * 0.72);
    const threading = cyc > 0.48 && cyc < 0.68;
    g.fillStyle = threading ? '#f2e5c4' : '#d9a441';
    g.shadowColor = threading ? 'rgba(255,240,180,0.9)' : 'rgba(232,180,90,0.7)';
    g.shadowBlur = threading ? 14 : 8;
    g.beginPath(); g.ellipse(cx, cy, 6.5, 3, 0, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = threading ? '#e8c476' : '#9b8a6a';
    g.font = 'bold 15px Georgia, serif'; g.textAlign = 'center';
    g.fillText('×3', S * 0.82, S * 0.24);
  },
  volley: (g, S, t) => {
    // Five coins launch downward with staggered timing.
    const period = 1.8;
    const cyc = (t % period) / period;
    for (let i = 0; i < 5; i++) {
      const local = (cyc - i * 0.06 + 1) % 1;
      const x = S * (0.18 + i * 0.16);
      const y = S * (0.18 + local * 0.68);
      g.fillStyle = '#d9a441';
      g.shadowColor = 'rgba(232,180,90,0.7)'; g.shadowBlur = 8;
      g.beginPath(); g.ellipse(x, y, 7, 3.4, 0, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
      // trail behind the coin
      const trail = g.createLinearGradient(x, y - 22, x, y - 4);
      trail.addColorStop(0, 'rgba(217,164,65,0)');
      trail.addColorStop(1, 'rgba(217,164,65,0.55)');
      g.strokeStyle = trail; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(x, y - 22); g.lineTo(x, y - 4); g.stroke();
    }
  },
};

let ruleAnimRunning = false;
function startRuleAnimations() {
  if (ruleAnimRunning) return;
  ruleAnimRunning = true;
  const canvases = [...els.rules.querySelectorAll('.r-art')].map(cv => ({
    g: cv.getContext('2d'), S: cv.width, key: cv.dataset.art,
  }));
  const t0 = performance.now();
  const frame = () => {
    // Stop looping once the player steps up to the machine — menu is invisible.
    if (els.overlay.classList.contains('gone') || els.overlay.hidden) {
      ruleAnimRunning = false;
      return;
    }
    const t = (performance.now() - t0) / 1000;
    for (const { g, S, key } of canvases) {
      g.clearRect(0, 0, S, S);
      rulePainters[key](g, S, t);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function bindUI() {
  if ('ontouchstart' in window) {
    els.hint.textContent = 'slide to aim · tap to drop';
  }
  const canvas = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  function aimFromEvent(e) {
    ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
    ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
    mouseNX = ndc.x; mouseNY = ndc.y;
    ray.setFromCamera(ndc, camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    if (Math.abs(d.y) > 1e-4) {
      const t = (DROP_Y - o.y) / d.y;
      if (t > 0) aimTarget = THREE.MathUtils.clamp(o.x + d.x * t, -AIM_MAX, AIM_MAX);
    }
  }

  canvas.addEventListener('pointermove', aimFromEvent);
  canvas.addEventListener('pointerdown', (e) => {
    aimFromEvent(e);
    tryDrop();
  });

  window.addEventListener('keydown', (e) => {
    if (!els.helpModal.hidden) {
      if (e.code === 'Escape') closeHelp();
      return;
    }
    if (!els.creditsModal.hidden) {
      if (e.code === 'Escape') els.creditsModal.hidden = true;
      return;
    }
    if (e.code === 'ArrowLeft') { aimTarget = Math.max(-AIM_MAX, aimTarget - 1.6); e.preventDefault(); }
    else if (e.code === 'ArrowRight') { aimTarget = Math.min(AIM_MAX, aimTarget + 1.6); e.preventDefault(); }
    else if (e.code === 'Space') { tryDrop(); e.preventDefault(); }
    else if (e.code === 'KeyV') { dropVolley(); }
  });

  buildHelp();
  const openHelp = () => { els.helpModal.hidden = false; };
  els.help.addEventListener('click', openHelp);
  els.helpClose.addEventListener('click', closeHelp);
  els.helpModal.addEventListener('click', (e) => {
    if (e.target === els.helpModal) closeHelp();
  });

  const openCredits = () => { els.creditsModal.hidden = false; };
  const closeCredits = () => { els.creditsModal.hidden = true; };
  els.credits_btn.addEventListener('click', openCredits);
  els.creditsClose.addEventListener('click', closeCredits);
  els.creditsModal.addEventListener('click', (e) => {
    if (e.target === els.creditsModal) closeCredits();
  });

  els.volleyWrap.addEventListener('click', dropVolley);
  refreshVolley();

  // House-rule cards on the menu. Selected = the part is installed on the
  // machine; deselected = the machine runs without it. Toggling reshapes the
  // live simulation and repaints the card's on/off state.
  startRuleAnimations();
  const stateLabels = {
    gutters: ['open', 'sealed'],
    pins: ['installed', 'pulled'],
    ring: ['swinging', 'stowed'],
    volley: ['armed', 'disarmed'],
  };
  // "Wipe the ledger" — clears saved balance, drop count, house rules, mute.
  // Two-step: first click arms it (turns red, "tap again"), second click wipes.
  // A 3-second timeout defuses so an accidental first click doesn't linger.
  let resetTimer = 0;
  const defuseReset = () => {
    clearTimeout(resetTimer);
    els.reset.classList.remove('arm');
    els.reset.textContent = 'wipe the ledger — reset progress';
  };
  els.reset.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!els.reset.classList.contains('arm')) {
      els.reset.classList.add('arm');
      els.reset.textContent = 'tap again to erase everything';
      resetTimer = setTimeout(defuseReset, 3000);
      return;
    }
    clearTimeout(resetTimer);
    try { localStorage.removeItem('midway_save'); } catch { /* private mode */ }
    location.reload();
  });

  els.rules.querySelectorAll('.r-card').forEach(card => {
    const key = card.dataset.rule;
    const stateEl = card.querySelector('.r-state');
    const paintState = () => {
      const [on, off] = stateLabels[key];
      card.setAttribute('aria-checked', String(!!SETTINGS[key]));
      stateEl.textContent = SETTINGS[key] ? on : off;
    };
    paintState();
    const flip = () => {
      SETTINGS[key] = !SETTINGS[key];
      paintState();
      applySettings();
      sound.clink(0.35, 0);
      persist();
    };
    card.addEventListener('click', flip);
    card.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); flip(); }
    });
  });

  els.enter.addEventListener('click', () => {
    const firstTime = !started;
    sound.unlock();
    sound.setMuted(muteState);
    els.overlay.classList.add('gone');
    els.home.hidden = false;
    started = true;
    refreshHud();
    if (firstTime && SETTINGS.ring) setTimeout(() => toast('THREAD THE RING — PAYS ×3'), 4000);
  });

  els.home.addEventListener('click', () => {
    if (!started) return;
    els.overlay.classList.remove('gone');
    els.home.hidden = true;
    els.enter.textContent = 'return to the machine';
    closeHelp();
    startRuleAnimations();
  });

  els.mute.addEventListener('click', () => {
    muteState = !muteState;
    sound.setMuted(muteState);
    els.mute.innerHTML = muteState ? '&#215;' : '&#9835;';
    els.mute.title = muteState ? 'unmute' : 'mute';
    persist();
  });
  if (muteState) els.mute.innerHTML = '&#215;';

  els.tipjar.addEventListener('click', () => {
    if (Date.now() - lastTip < TIP_COOLDOWN) return;
    lastTip = Date.now();
    balance += TIP_AMOUNT;
    sound.pour();
    toast(`THE HOUSE TAKES PITY  +${TIP_AMOUNT}`);
    bumpBalance();
    refreshHud();
    persist();
  });

  document.addEventListener('visibilitychange', () => {
    document.hidden ? sound.suspend() : sound.resume();
  });

  refreshHud();
}

function closeHelp() { els.helpModal.hidden = true; }

function tryDrop() {
  if (!started || dropCooldown > 0) return;
  if (balance <= 0) {
    els.balance.classList.remove('shake');
    void els.balance.offsetWidth;
    els.balance.classList.add('shake');
    sound.denied();
    return;
  }
  balance--;
  dropCount++;
  dropCooldown = 0.3;

  let kind = 'penny';
  if (dropCount % MEDAL_EVERY === 0) kind = 'medal';
  else if (dropCount % TOKEN_EVERY === 0) kind = 'token';

  spawnCoin(kind, aimX, DROP_Y, DROP_Z, { vy: -30, vz: 4 });
  sound.insert();
  if (dropCount >= 3) els.hint.classList.add('gone');
  refreshHud();
  persist();
}

// A whole handful at once — the skill you earn by winning.
function dropVolley() {
  if (!started || !SETTINGS.volley || !els.helpModal.hidden) return;
  if (volleyCharges <= 0 || volleyCooldown > 0) {
    if (volleyCharges <= 0) sound.denied();
    return;
  }
  volleyCharges--;
  volleyCooldown = 0.6;
  const half = ((VOLLEY_SIZE - 1) / 2) * VOLLEY_SPACING;
  const cx = THREE.MathUtils.clamp(aimX, -AIM_MAX + half, AIM_MAX - half);
  for (let i = 0; i < VOLLEY_SIZE; i++) {
    spawnCoin('penny',
      cx + (i - (VOLLEY_SIZE - 1) / 2) * VOLLEY_SPACING + (Math.random() - 0.5) * 0.6,
      DROP_Y, DROP_Z, { vy: -30, vz: 4 });
  }
  sound.pour();
  refreshVolley();
  persist();
}

function refreshVolley() {
  const pct = volleyCharges >= VOLLEY_MAX
    ? 100 : Math.min(100, Math.round((volleyProgress / VOLLEY_NEED) * 100));
  els.volleyWrap.style.background =
    `conic-gradient(rgba(216,226,238,0.9) ${pct}%, rgba(200,215,230,0.16) ${pct}%)`;
  els.volley.classList.toggle('ready', volleyCharges > 0);
  els.volleyPips.textContent = '● '.repeat(volleyCharges).trim();
}

// ---------------------------------------------------------------------------
// HUD helpers
// ---------------------------------------------------------------------------
function refreshHud() {
  els.bal_num.textContent = balance;
  const nextToken = TOKEN_EVERY - (dropCount % TOKEN_EVERY);
  els.subline.textContent = `◇ lucky drop in ${nextToken} · won ${totalWon}`;

  const broke = balance <= 2;
  const cd = TIP_COOLDOWN - (Date.now() - lastTip);
  if (broke) {
    els.tipjar.hidden = false;
    if (cd > 0) {
      els.tipjar.disabled = true;
      els.tipjar.innerHTML = `change in ${Math.ceil(cd / 1000)}s`;
    } else {
      els.tipjar.disabled = false;
      els.tipjar.innerHTML = `need change? <b>+${TIP_AMOUNT}</b>`;
    }
  } else {
    els.tipjar.hidden = true;
  }
}

function bumpBalance() {
  els.balance.classList.remove('bump');
  void els.balance.offsetWidth;
  els.balance.classList.add('bump');
}

const v3 = new THREE.Vector3();
function worldToScreen(x, y, z) {
  v3.set(x, y, z).project(camera);
  return {
    x: (v3.x * 0.5 + 0.5) * window.innerWidth,
    y: (-v3.y * 0.5 + 0.5) * window.innerHeight,
  };
}

function popup(text, screen, cls) {
  const el = document.createElement('div');
  el.className = `pop ${cls}`;
  el.textContent = text;
  el.style.left = `${screen.x}px`;
  el.style.top = `${screen.y}px`;
  els.fx.appendChild(el);
  setTimeout(() => el.remove(), 1050);
}

function toast(text, big = false) {
  while (els.toasts.children.length >= 3) els.toasts.firstChild.remove();
  const el = document.createElement('div');
  el.className = big ? 'toast big' : 'toast';
  el.textContent = text;
  els.toasts.appendChild(el);
  setTimeout(() => el.remove(), 2450);
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
// Narrow (portrait) screens get a wider lens and a step back so the whole
// cabinet stays in frame.
let camDist = 78;
function applyCameraFraming() {
  const a = camera.aspect;
  camera.fov = a >= 1.3 ? 40 : THREE.MathUtils.clamp(40 + (1.3 - a) * 28, 40, 66);
  camDist = a >= 1.3 ? 78 : 78 + (1.3 - a) * 26;
  camera.updateProjectionMatrix();
}

let lastT = 0, acc = 0, hudTimer = 0;

// Everything that advances game state lives here so it can also be driven
// headlessly (see __game.advance); tick() adds only presentation on top.
function simulate(dt) {
  acc += dt;
  while (acc >= DT) {
    stepPusher();
    stepRing();
    world.step(eventQueue);
    acc -= DT;
  }

  const now = performance.now();
  updateCoins(now);
  processShower(now);
  endBurstCheck(now);

  if (dropCooldown > 0) dropCooldown -= dt;
  if (volleyCooldown > 0) volleyCooldown -= dt;
}

function tick(tMs) {
  requestAnimationFrame(tick);
  const t = tMs / 1000;
  const dt = Math.min(t - lastT || 0.016, 0.05);
  lastT = t;

  simulate(dt);

  // Smooth the aim carriage toward the pointer.
  aimX += (aimTarget - aimX) * Math.min(1, dt * 14);
  ghost.position.x = aimX;
  beam.position.x = aimX;
  carriage.position.x = aimX;
  ghost.rotation.y += dt * 1.2;
  const cool = dropCooldown > 0 ? 0.18 : 0.5;
  ghost.material.opacity += (cool - ghost.material.opacity) * Math.min(1, dt * 10);

  // Pusher and ring meshes follow their physics bodies.
  const pp = pusherBody.translation();
  pusherMesh.position.set(pp.x, pp.y, pp.z);
  const rp = ringBody.translation();
  ringMesh.position.set(rp.x, rp.y, rp.z);

  // Gilded coins breathe.
  const glowE = 0.32 + 0.18 * Math.sin(t * 5);
  for (const kind in coinAssets) {
    const cm = coinAssets[kind].chargedMats;
    cm[0].emissiveIntensity = glowE;
    cm[1].emissiveIntensity = glowE;
  }

  // Subtle head parallax + jackpot shake.
  let sx = 0, sy = 0;
  if (shakeT > 0) {
    shakeT -= dt;
    const k = shakeT * 2.2;
    sx = (Math.random() - 0.5) * k;
    sy = (Math.random() - 0.5) * k;
  }
  camera.position.x += ((mouseNX * 3 + sx) - camera.position.x) * Math.min(1, dt * 4);
  camera.position.y += ((58 + mouseNY * 2 + sy) - camera.position.y) * Math.min(1, dt * 4);
  camera.position.z += (camDist - camera.position.z) * Math.min(1, dt * 4);
  camera.lookAt(0, 23, -4);

  updateBulbs(t);

  // Neighbour screens shimmer, one occasionally stutters.
  for (const n of neighbors) {
    n.mat.opacity = 0.82 + 0.1 * Math.sin(t * 2.3 + n.phase)
      + (Math.sin(t * 17 + n.phase * 3) > 0.93 ? -0.18 : 0);
  }

  // Tip jar countdown needs a periodic refresh.
  hudTimer += dt;
  if (hudTimer > 0.5) { hudTimer = 0; if (started) refreshHud(); }

  renderer.render(scene, camera);
}

// Debug handle for automated testing.
window.__game = {
  get coins() { return coins; },
  get balance() { return balance; },
  set balance(v) { balance = v; refreshHud(); },
  get dropCount() { return dropCount; },
  drop(x = 0) { aimTarget = aimX = x; dropCooldown = 0; tryDrop(); },
  get ringX() { return ringBody.translation().x; },
  get volley() { return { charges: volleyCharges, progress: volleyProgress }; },
  grantVolley() { volleyCharges = Math.min(VOLLEY_MAX, volleyCharges + 1); refreshVolley(); },
  fireVolley() { volleyCooldown = 0; dropVolley(); },
  advance(seconds = 1) {
    for (let s = 0; s < seconds; s += 1 / 60) simulate(1 / 60);
    for (const c of coins) syncCoin(c);
  },
  get world() { return world; },
};

boot().catch((e) => {
  els.boot.textContent = 'the machine is broken: ' + e.message;
  console.error(e);
});
