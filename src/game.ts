import * as THREE from 'three';
import './style.css';

type Phase = 'onboarding' | 'permission' | 'scanning' | 'countdown' | 'running' | 'complete' | 'defeated';
type Kind = 'crawler' | 'skitter';
const LEG_COUNT = 6;
interface Enemy {
  id: number; root: THREE.Group;
  health: number; speed: number; dead: boolean; attacking: boolean;
  breach: number; sequence: number; kind: Kind;
}

const ROUND_SECONDS = 120;
const MAGAZINE_SIZE = 6;
const RAPID_FIRE_KILLS = 3;
const RAPID_FIRE_INTERVAL = 115;
const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
};
const ui = {
  camera: $('#camera-feed') as HTMLVideoElement, simulation: $('#simulated-room'), scene: $('#scene'),
  onboarding: $('#onboarding'), permission: $('#permission-panel'), breachPanel: $('#breach-panel'), result: $('#result-panel'),
  deploy: $('#deploy-button') as HTMLButtonElement, cameraButton: $('#camera-button') as HTMLButtonElement,
  simulationButton: $('#simulation-button') as HTMLButtonElement, markBreach: $('#mark-breach-button') as HTMLButtonElement,
  breachStep: $('#breach-step'), breachTitle: $('#breach-title'), breachCopy: $('#breach-copy'),
  breachDots: [...document.querySelectorAll<HTMLElement>('.breach-dots i')], countdown: $('#countdown'),
  countdownValue: $('#countdown-value'), hud: $('#hud'), time: $('#time-value'), score: $('#score-value'),
  ammo: $('#ammo-value'), health: $('#health-value'), healthBar: $('#health-bar'), status: $('#game-status'),
  fire: $('#fire-button') as HTMLButtonElement, restart: $('#restart-button') as HTMLButtonElement,
  leftCue: $('#left-cue'), rightCue: $('#right-cue'), threatAlert: $('#threat-alert'), threatCount: $('#threat-count'),
  upgradeNotice: $('#upgrade-notice'),
  hitMarker: $('#hit-marker'), bloodImpact: $('#blood-impact'), damageFlash: $('#damage-flash'), muzzleFlash: $('#muzzle-flash'),
  compassMarks: [...document.querySelectorAll<HTMLElement>('[data-breach]')], resultEyebrow: $('#result-eyebrow'),
  resultTitle: $('#result-title'), resultCopy: $('#result-copy'), finalScore: $('#final-score'),
  finalKills: $('#final-kills'), finalTime: $('#final-time'),
};

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 60);
camera.position.set(0, 1.65, 0); camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65)); renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap; ui.scene.appendChild(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xa9c3ca, 0x22160f, 1.7));
const keyLight = new THREE.DirectionalLight(0xe9f4e8, 2.8); keyLight.position.set(-4, 7, 3); keyLight.castShadow = true; scene.add(keyLight);
const rimLight = new THREE.PointLight(0xff5a38, 13, 12, 2); rimLight.position.set(3, 2, -4); scene.add(rimLight);

const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
const moveVector = new THREE.Vector3();
const viewVector = new THREE.Vector3();
const deviceEuler = new THREE.Euler();
const deviceQuaternion = new THREE.Quaternion();
const targetCameraQuaternion = new THREE.Quaternion();
const baselineDeviceQuaternion = new THREE.Quaternion();
const screenQuaternion = new THREE.Quaternion();
const verticalAxis = new THREE.Vector3(0, 1, 0);
const screenAxis = new THREE.Vector3(0, 0, 1);
const deviceCameraCorrection = new THREE.Quaternion(-Math.sqrt(.5), 0, 0, Math.sqrt(.5));
let phase: Phase = 'onboarding';
let enemies: Enemy[] = [];
const template = createGlassbackParasite();
let nextEnemyId = 1;
let breaches: number[] = [];
let simulated = false;
let score = 0, kills = 0, ammo = MAGAZINE_SIZE, health = 100;
let reloading = false, gameStart = 0, lastFrame = performance.now();
let rapidFireUnlocked = false, fireHeld = false, rapidFireTimer: number | null = null;
let fallbackHeading = 0, targetFallbackHeading = 0;
let orientationActive = false, orientationListening = false, orientationBaselineReady = false;
let dragging = false, dragX = 0, spawnCursor = 0, runToken = 0;
let audioContext: AudioContext | null = null;

function setPanel(panel: HTMLElement | null) {
  [ui.onboarding, ui.permission, ui.result].forEach((item) => item.classList.toggle('panel--active', item === panel));
}
function setPhase(next: Phase) {
  phase = next;
  const combat = next === 'running', scanning = next === 'scanning', counting = next === 'countdown';
  ui.hud.classList.toggle('hud--active', combat); ui.hud.setAttribute('aria-hidden', String(!combat));
  ui.breachPanel.classList.toggle('breach-panel--active', scanning); ui.breachPanel.setAttribute('aria-hidden', String(!scanning));
  ui.countdown.classList.toggle('countdown--active', counting); ui.countdown.setAttribute('aria-hidden', String(!counting));
}

function organicSphere(seed = 0) {
  const geometry = new THREE.SphereGeometry(1, 18, 12), position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
    const distortion = 1 + Math.sin(x * 7.1 + seed) * Math.sin(y * 8.7 - seed) * Math.sin(z * 6.3 + seed * .5) * .045;
    position.setXYZ(index, x * distortion, y * distortion, z * distortion);
  }
  geometry.computeVertexNormals(); return geometry;
}

function tissueTexture(seed: number, light: [number, number, number], dark: [number, number, number]) {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96;
  const context = canvas.getContext('2d')!, image = context.createImageData(96, 96);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
    const index = (y * 96 + x) * 4;
    const grain = Math.abs(Math.sin(x * 12.9898 + y * 78.233 + seed * 31.7) * 43758.5453) % 1;
    const vessel = Math.abs(Math.sin(x * .085 + Math.sin(y * .11 + seed) * 2.3 + seed)) < .075;
    const mix = vessel ? .08 : .55 + grain * .45;
    image.data[index] = dark[0] + (light[0] - dark[0]) * mix;
    image.data[index + 1] = dark[1] + (light[1] - dark[1]) * mix;
    image.data[index + 2] = dark[2] + (light[2] - dark[2]) * mix;
    image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1.6, 1.15); texture.anisotropy = 4; return texture;
}

function createGlassbackParasite(): THREE.Group {
  const creature = new THREE.Group(); creature.name = 'glassback-parasite';
  const fleshMap = tissueTexture(2.4, [166,102,91], [48,15,20]), bruiseMap = tissueTexture(8.7, [89,48,51], [20,7,12]);
  const flesh = new THREE.MeshPhysicalMaterial({ color: 0x8e5b54, map: fleshMap, roughness: .34, metalness: 0, clearcoat: .58, clearcoatRoughness: .23, sheen: .35, sheenColor: new THREE.Color(0x4c171b), sheenRoughness: .7 });
  const bruisedFlesh = new THREE.MeshPhysicalMaterial({ color: 0x513039, map: bruiseMap, roughness: .42, clearcoat: .46, clearcoatRoughness: .27, sheen: .24, sheenColor: new THREE.Color(0x7a3036) });
  const organ = new THREE.MeshPhysicalMaterial({ color: 0x9f3438, emissive: 0x3b080b, emissiveIntensity: .65, roughness: .18, clearcoat: .9, clearcoatRoughness: .12, transparent: true, opacity: .88 });
  const vein = new THREE.MeshStandardMaterial({ color: 0x571015, emissive: 0x230204, emissiveIntensity: .35, roughness: .36 });
  const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: 0x16080a, emissive: 0x26090b, emissiveIntensity: .16, roughness: .08, clearcoat: 1, clearcoatRoughness: .05 });
  const tooth = new THREE.MeshStandardMaterial({ color: 0x59433d, roughness: .88 });

  const abdomen = new THREE.Mesh(organicSphere(.7), flesh);
  abdomen.name = 'abdomen'; abdomen.userData.surface = 'flesh'; abdomen.position.set(.035, .36, -.2); abdomen.rotation.set(-.04, .06, .08); abdomen.scale.set(.5, .29, .69); creature.add(abdomen);
  const organCore = new THREE.Mesh(organicSphere(2.1), organ);
  organCore.name = 'pulse-core'; organCore.position.set(.02, .405, -.23); organCore.scale.set(.31, .19, .46); creature.add(organCore);
  const thorax = new THREE.Mesh(organicSphere(1.3), bruisedFlesh);
  thorax.name = 'thorax'; thorax.userData.surface = 'bruise'; thorax.position.set(-.025, .31, .27); thorax.rotation.z = -.08; thorax.scale.set(.4, .27, .5); creature.add(thorax);
  const head = new THREE.Mesh(organicSphere(3.4), flesh);
  head.name = 'head'; head.userData.surface = 'flesh'; head.position.set(.045, .29, .61); head.rotation.z = .12; head.scale.set(.31, .2, .28); creature.add(head);

  const veinPaths = [
    [[-.22,.48,-.55],[-.11,.58,-.34],[-.05,.56,-.03]],
    [[.27,.39,-.5],[.2,.52,-.29],[.13,.51,.02]],
    [[-.18,.29,-.61],[-.03,.3,-.72],[.18,.34,-.55]],
  ];
  veinPaths.forEach((points, index) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x,y,z]) => new THREE.Vector3(x,y,z)));
    const vessel = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, index === 2 ? .018 : .013, 5, false), vein);
    vessel.name = `vein-${index}`; creature.add(vessel);
  });
  [[-.19,.52,-.29,.13],[.16,.55,-.12,.095],[-.07,.57,-.52,.085]].forEach(([x,y,z,size], index) => {
    const blister = new THREE.Mesh(organicSphere(5 + index), organ); blister.name = `blister-${index}`;
    blister.position.set(x,y,z); blister.scale.set(size, size * .48, size * 1.25); creature.add(blister);
  });

  const legAngles = [-1.12, -.48, .24, Math.PI - .18, Math.PI + .5, Math.PI + 1.14];
  const legLengths = [1.06, .88, .98, .91, 1.08, .84];
  legAngles.forEach((angle, index) => {
    const length = legLengths[index];
    const hip = new THREE.Group(); hip.name = `leg-${index}`; hip.userData.baseAngle = angle; hip.userData.stride = .82 + (index % 3) * .11; hip.position.set(index % 2 ? -.015 : .025, .29, index < 3 ? .05 : -.04); hip.rotation.y = angle;
    const socket = new THREE.Mesh(organicSphere(7 + index), bruisedFlesh); socket.position.x = .15; socket.scale.set(.15,.1,.12); hip.add(socket);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .4 * length, 5, 8), flesh);
    upper.userData.surface = 'flesh'; upper.position.x = .23 * length; upper.scale.z = .82; upper.rotation.z = -Math.PI / 2; hip.add(upper);
    const knee = new THREE.Mesh(organicSphere(12 + index), bruisedFlesh); knee.position.x = .47 * length; knee.scale.set(.09,.075,.085); hip.add(knee);
    const shin = new THREE.Group(); shin.name = `shin-${index}`; shin.userData.rest = -.58 + (index % 2) * .09; shin.position.x = .46 * length; shin.rotation.z = shin.userData.rest; hip.add(shin);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(.038, .48 * length, 4, 7), bruisedFlesh);
    lower.position.set(.27 * length, -.17, 0); lower.rotation.z = -Math.PI / 2 - .52; shin.add(lower);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(.026, .115, 5), tooth);
    claw.position.set(.52 * length, -.325, 0); claw.rotation.z = -1.9; shin.add(claw); creature.add(hip);
  });

  [[-.09,.325,.865,.022],[.025,.345,.88,.028],[.112,.302,.845,.018]].forEach(([x,y,z,size], index) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(size, 10, 7), eyeMaterial); eye.name = `eye-${index}`; eye.position.set(x,y,z); creature.add(eye);
  });
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(.105, 18), new THREE.MeshBasicMaterial({ color: 0x0d0204 }));
  mouth.name = 'mouth'; mouth.position.set(.04,.245,.889); mouth.scale.set(1,.42,1); creature.add(mouth);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(.098,.017,6,18), vein);
  lip.position.copy(mouth.position); lip.position.z += .004; lip.scale.y = .43; creature.add(lip);
  [-1, 1].forEach((side) => {
    const mouthHook = new THREE.Mesh(new THREE.ConeGeometry(.015,.072,5), tooth);
    mouthHook.position.set(.04 + side * .045,.245,.905); mouthHook.rotation.z = side * .62; creature.add(mouthHook);
  });
  [-1, 1].forEach((side) => {
    const tendril = new THREE.Group(); tendril.name = `tendril-${side}`; tendril.position.set(side * .1, .245, .79);
    const jaw = new THREE.Mesh(new THREE.CapsuleGeometry(.028, side > 0 ? .23 : .28, 4, 7), bruisedFlesh); jaw.position.z = .14; jaw.rotation.x = Math.PI / 2; jaw.rotation.z = side * .3; tendril.add(jaw);
    const barb = new THREE.Mesh(new THREE.ConeGeometry(.023, .11, 5), tooth); barb.position.set(side * .035, -.03, .285); barb.rotation.x = Math.PI / 2.3; tendril.add(barb); creature.add(tendril);
  });
  const growth = new THREE.Mesh(organicSphere(9.2), flesh); growth.userData.surface = 'flesh'; growth.position.set(-.34,.41,.12); growth.scale.set(.18,.23,.16); creature.add(growth);
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(1.75, .9, 1.7), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hitbox.name = 'parasite-hitbox'; hitbox.position.y = .35; creature.add(hitbox);
  const slime = new THREE.Mesh(new THREE.CircleGeometry(.82, 28), new THREE.MeshBasicMaterial({ color: 0x25090b, transparent: true, opacity: .38, depthWrite: false }));
  slime.name = 'slime-shadow'; slime.rotation.x = -Math.PI / 2; slime.scale.set(1.15,.72,1); slime.position.y = .009; creature.add(slime);
  creature.traverse((part) => { if (part instanceof THREE.Mesh) { part.castShadow = part.name !== 'parasite-hitbox' && part.name !== 'slime-shadow'; part.receiveShadow = part.name !== 'parasite-hitbox'; } });
  return creature;
}

function animateParasite(enemy: Enemy, now: number) {
  const tempo = enemy.kind === 'skitter' ? .014 : .0095;
  const gait = now * tempo + enemy.id * 1.73;
  for (let index = 0; index < LEG_COUNT; index++) {
    const leg = enemy.root.getObjectByName(`leg-${index}`);
    const shin = enemy.root.getObjectByName(`shin-${index}`);
    if (!leg || !shin) continue;
    const pairedPhase = index < 3 ? index * 2.08 : (index - 3) * 2.08 + Math.PI;
    const step = Math.sin(gait * leg.userData.stride + pairedPhase), twitch = Math.sin(gait * .37 + index * 4.2) * .035;
    leg.rotation.y = leg.userData.baseAngle + step * .21 + twitch;
    leg.rotation.z = Math.max(0, step) * .13 - .035;
    shin.rotation.z = shin.userData.rest + Math.cos(gait * leg.userData.stride + pairedPhase) * .24;
  }
  const pulseBeat = Math.pow(Math.max(0, Math.sin(now * .0047 + enemy.id)), 3), breath = 1 + pulseBeat * .085;
  enemy.root.getObjectByName('abdomen')?.scale.set(.5 * breath, .29 / breath, .69 * breath);
  const core = enemy.root.getObjectByName('pulse-core') as THREE.Mesh | undefined;
  core?.scale.set(.31 * breath, .19 * breath, .46 * breath);
  if (core?.material instanceof THREE.MeshPhysicalMaterial) core.material.emissiveIntensity = .48 + pulseBeat * 1.05;
  [-1, 1].forEach((side) => { const tendril = enemy.root.getObjectByName(`tendril-${side}`); if (tendril) tendril.rotation.y = side * (.18 + Math.sin(now * .007 + enemy.id + side) * .16); });
  if (!enemy.dead) enemy.root.rotation.z = Math.sin(now * .0031 + enemy.id * 2.4) * .024;
  const emergence = THREE.MathUtils.smootherstep(Math.min(1, (now - enemy.root.userData.spawnedAt) / 460), 0, 1);
  enemy.root.scale.setScalar(enemy.root.userData.targetScale * emergence);
}
function createEnemy(breach: number) {
  const root = template.clone(true), id = nextEnemyId++;
  const elapsed = gameStart ? (performance.now() - gameStart) / 1000 : 0;
  const kind: Kind = Math.random() < Math.min(.28 + elapsed / 420, .5) ? 'skitter' : 'crawler';
  const enemy: Enemy = { id, root, health: kind === 'skitter' ? 80 : 100,
    speed: kind === 'skitter' ? .82 : .43, dead: false, attacking: false, breach, sequence: 1, kind };
  root.userData.spawnedAt = performance.now(); root.userData.targetScale = (kind === 'skitter' ? .68 : .78) * (.93 + Math.random() * .14); root.scale.setScalar(.04);
  root.traverse((part) => {
    part.userData.enemyId = id;
    if (part instanceof THREE.Mesh) {
      part.castShadow = part.name !== 'parasite-hitbox' && part.name !== 'slime-shadow';
      if (part.material instanceof THREE.MeshPhysicalMaterial || part.material instanceof THREE.MeshStandardMaterial) {
        part.material = part.material.clone();
        if (part.userData.surface === 'flesh') part.material.color.offsetHSL((id % 3 - 1) * .012, (id % 2) * .025, (id % 4 - 1.5) * .018);
      }
    }
  });
  const bearing = breaches[breach] + (Math.random() - .5) * .18, distance = 5.1 + Math.random() * 1.8;
  root.position.set(Math.sin(bearing) * distance, 0, -Math.cos(bearing) * distance);
  root.rotation.y = Math.atan2(-root.position.x, -root.position.z);
  scene.add(root); enemies.push(enemy); return enemy;
}
function removeEnemy(enemy: Enemy) { scene.remove(enemy.root); enemies = enemies.filter((item) => item !== enemy); }
function clearEnemies() { enemies.forEach((enemy) => scene.remove(enemy.root)); enemies = []; }
function desiredEnemyCount() { return (performance.now() - gameStart) / 1000 >= 30 ? 3 : 2; }
function spawnReplacement(delay = 0) {
  const token = runToken;
  window.setTimeout(() => {
    if (phase !== 'running' || token !== runToken) return;
    while (enemies.filter((enemy) => !enemy.dead).length < desiredEnemyCount()) createEnemy(spawnCursor++ % breaches.length);
  }, delay);
}
function normalize(angle: number) { return Math.atan2(Math.sin(angle), Math.cos(angle)); }

function updateHud() {
  ui.score.textContent = score.toString().padStart(6, '0'); ui.ammo.textContent = ammo.toString().padStart(2, '0');
  ui.health.textContent = Math.max(0, Math.ceil(health)).toString(); ui.healthBar.style.width = `${Math.max(0, health)}%`;
  ui.healthBar.classList.toggle('health-track--critical', health <= 30);
}
function tone(frequency: number, duration: number, type: OscillatorType = 'square', volume = .05, slide = 0) {
  try {
    audioContext ??= new AudioContext(); if (audioContext.state === 'suspended') void audioContext.resume();
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime); oscillator.frequency.linearRampToValueAtTime(Math.max(30, frequency + slide), audioContext.currentTime + duration);
    gain.gain.setValueAtTime(volume, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.0001, audioContext.currentTime + duration);
    oscillator.connect(gain).connect(audioContext.destination); oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch { /* Every sound cue also has a visual equivalent. */ }
}
function updateControlHint() {
  if (phase !== 'running' || reloading) return;
  if (rapidFireUnlocked) { ui.status.textContent = 'Rapid fire ready • hold discharge'; return; }
  ui.status.textContent = orientationActive ? 'Turn your body • center movement' : 'Drag to turn • center movement';
}

async function requestOrientation() {
  if (orientationListening) return true;
  const OrientationEvent = window.DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
  if (!OrientationEvent) return false;
  try {
    if (OrientationEvent.requestPermission && await OrientationEvent.requestPermission() !== 'granted') return false;
    window.addEventListener('deviceorientation', onOrientation, true); orientationListening = true; return true;
  } catch { return false; }
}
function onOrientation(event: DeviceOrientationEvent) {
  if (event.alpha === null || event.beta === null || event.gamma === null) return;
  const screenAngle = screen.orientation?.angle ?? (window.orientation as number | undefined) ?? 0;
  deviceEuler.set(
    THREE.MathUtils.degToRad(event.beta),
    THREE.MathUtils.degToRad(event.alpha),
    -THREE.MathUtils.degToRad(event.gamma),
    'YXZ',
  );
  deviceQuaternion.setFromEuler(deviceEuler);
  deviceQuaternion.multiply(deviceCameraCorrection);
  screenQuaternion.setFromAxisAngle(screenAxis, -THREE.MathUtils.degToRad(screenAngle));
  deviceQuaternion.multiply(screenQuaternion);
  if (!orientationBaselineReady) {
    baselineDeviceQuaternion.copy(deviceQuaternion);
    orientationBaselineReady = true;
  }
  targetCameraQuaternion.copy(baselineDeviceQuaternion).invert().multiply(deviceQuaternion).normalize();
  orientationActive = true;
}
async function enableCamera() {
  ui.cameraButton.disabled = true; ui.cameraButton.querySelector('span')!.textContent = 'Requesting access…';
  try {
    const orientationRequest = requestOrientation();
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    ui.camera.srcObject = stream; await ui.camera.play(); ui.camera.classList.add('camera-feed--active'); ui.simulation.classList.remove('simulated-room--active');
    await orientationRequest; startScan(false);
  } catch {
    ui.cameraButton.disabled = false; ui.cameraButton.querySelector('span')!.textContent = 'Try camera again';
    const copy = ui.permission.querySelector('.permission-copy');
    if (copy) { copy.classList.add('permission-error'); copy.textContent = 'Camera access is blocked. Change the browser permission, or open the simulated room.'; }
  }
}
async function startSimulation() { await requestOrientation(); ui.camera.classList.remove('camera-feed--active'); ui.simulation.classList.add('simulated-room--active'); startScan(true); }

function refreshScan(message?: string) {
  const count = breaches.length; ui.breachDots.forEach((dot, index) => dot.classList.toggle('is-locked', index < count));
  if (count < 3) {
    ui.breachStep.textContent = `Breach ${count + 1} of 3`;
    ui.breachTitle.textContent = count === 0 ? 'Aim at an entrance.' : count === 1 ? 'Choose another side.' : 'Mark the last opening.';
    ui.breachCopy.textContent = message ?? (simulated ? 'Drag left or right to face a different part of the room, then lock it.' : 'Face a doorway, hallway, or dark corner. Keep your feet planted and turn with your phone.');
    ui.markBreach.querySelector('span')!.textContent = 'Lock this breach'; ui.markBreach.querySelector('b')!.textContent = '＋';
  } else {
    ui.breachStep.textContent = 'Three paths exposed'; ui.breachTitle.textContent = 'Your room is unsealed.';
    ui.breachCopy.textContent = 'Stay in this spot. The brood will surface from the directions you marked.';
    ui.markBreach.querySelector('span')!.textContent = 'Arm this room'; ui.markBreach.querySelector('b')!.textContent = '→';
  }
}
function startScan(useSimulation: boolean) {
  runToken++; clearEnemies(); breaches = []; simulated = useSimulation;
  orientationActive = false; orientationBaselineReady = false; targetCameraQuaternion.identity(); camera.quaternion.identity();
  fallbackHeading = 0; targetFallbackHeading = 0; spawnCursor = 0; setPanel(null); setPhase('scanning'); refreshScan(); tone(170, .1, 'triangle', .025, 80);
}
function markBreach() {
  if (phase !== 'scanning') return;
  if (breaches.length === 3) { void beginCountdown(); return; }
  camera.getWorldDirection(viewVector); viewVector.y = 0;
  if (viewVector.lengthSq() < .001) { refreshScan('Hold the phone upright, then aim at the opening again.'); return; }
  viewVector.normalize(); const bearing = normalize(Math.atan2(viewVector.x, -viewVector.z));
  if (breaches.some((saved) => Math.abs(normalize(saved - bearing)) < .52)) {
    refreshScan('Turn farther—give the brood a different way into the room.'); navigator.vibrate?.([20, 35, 20]); tone(95, .12, 'square', .03, -25); return;
  }
  breaches.push(bearing); refreshScan(); navigator.vibrate?.(22); tone(290 + breaches.length * 45, .1, 'triangle', .03, 50);
}
async function beginCountdown() {
  const token = ++runToken; setPhase('countdown');
  for (const number of [3, 2, 1]) {
    if (token !== runToken) return; ui.countdownValue.textContent = String(number); tone(180 + number * 30, .08, 'square', .025, 20);
    await new Promise((resolve) => window.setTimeout(resolve, 720));
  }
  if (token === runToken) startGame();
}
function startGame() {
  runToken++; clearEnemies(); setPanel(null); setPhase('running'); score = 0; kills = 0; ammo = MAGAZINE_SIZE; health = 100;
  stopRapidFire(); rapidFireUnlocked = false; ui.upgradeNotice.classList.remove('upgrade-notice--active'); ui.upgradeNotice.setAttribute('aria-hidden', 'true');
  reloading = false; gameStart = performance.now(); spawnCursor = 0; ui.fire.disabled = false; updateHud(); updateControlHint(); spawnReplacement();
  tone(170, .12, 'sawtooth', .035, 100);
}
function pulse(element: HTMLElement, className: string) { element.classList.remove(className); void element.offsetWidth; element.classList.add(className); }
function fire() {
  if (phase !== 'running' || reloading) return; if (ammo <= 0) { reload(); return; }
  ammo--; updateHud(); pulse(ui.fire, 'fire-button--fired'); pulse(ui.muzzleFlash, 'flash--active'); navigator.vibrate?.(18); tone(94, .09, 'square', .065, -42);
  raycaster.setFromCamera(screenCenter, camera);
  const targetRoots = enemies.filter((enemy) => !enemy.dead).map((enemy) => enemy.root);
  const object = raycaster.intersectObjects(targetRoots, true)[0]?.object;
  const enemy = enemies.find((candidate) => candidate.id === object?.userData.enemyId && !candidate.dead);
  if (enemy) {
    enemy.health -= 40; score += 15; pulse(ui.hitMarker, 'hit-marker--active'); pulse(ui.bloodImpact, 'blood-impact--active');
    enemy.root.rotation.z += (Math.random() - .5) * .16; tone(58, .08, 'sawtooth', .035, -15); if (enemy.health <= 0) eliminate(enemy);
  } else { ui.status.textContent = 'No impact • re-center'; window.setTimeout(updateControlHint, 650); }
  if (ammo === 0) window.setTimeout(reload, 220);
}
function reload() {
  if (reloading || phase !== 'running') return; const token = runToken; reloading = true; ui.fire.disabled = true;
  ui.status.textContent = 'Recharging weapon'; ui.fire.classList.add('fire-button--reloading'); tone(210, .07, 'triangle', .025, -25);
  window.setTimeout(() => {
    if (phase !== 'running' || token !== runToken) return; ammo = MAGAZINE_SIZE; reloading = false; ui.fire.disabled = false;
    ui.fire.classList.remove('fire-button--reloading'); updateControlHint(); updateHud(); tone(250, .08, 'triangle', .025, 35);
  }, 920);
}
function unlockRapidFire() {
  if (rapidFireUnlocked) return;
  rapidFireUnlocked = true; ui.upgradeNotice.setAttribute('aria-hidden', 'false'); pulse(ui.upgradeNotice, 'upgrade-notice--active');
  ui.status.textContent = 'Rapid fire unlocked • hold discharge'; navigator.vibrate?.([28, 35, 28]);
  tone(260, .09, 'square', .035, 120); window.setTimeout(() => tone(420, .14, 'triangle', .04, 160), 95);
  window.setTimeout(() => { ui.upgradeNotice.classList.remove('upgrade-notice--active'); ui.upgradeNotice.setAttribute('aria-hidden', 'true'); }, 2400);
  if (fireHeld) startRapidFire();
}
function startRapidFire() {
  if (!rapidFireUnlocked || rapidFireTimer !== null) return;
  const repeat = () => {
    if (!fireHeld || phase !== 'running' || !rapidFireUnlocked) { rapidFireTimer = null; return; }
    fire(); rapidFireTimer = window.setTimeout(repeat, RAPID_FIRE_INTERVAL);
  };
  rapidFireTimer = window.setTimeout(repeat, RAPID_FIRE_INTERVAL);
}
function stopRapidFire() {
  fireHeld = false;
  if (rapidFireTimer !== null) window.clearTimeout(rapidFireTimer);
  rapidFireTimer = null;
}
function eliminate(enemy: Enemy) {
  enemy.dead = true; enemy.sequence++; kills++; score += enemy.kind === 'skitter' ? 125 : 100; updateHud();
  if (kills === RAPID_FIRE_KILLS) unlockRapidFire();
  ui.status.textContent = enemy.kind === 'skitter' ? 'Skitter neutralized' : 'Parasite neutralized'; tone(420, .16, 'triangle', .04, 180);
  const token = runToken; window.setTimeout(() => { if (token !== runToken) return; removeEnemy(enemy); spawnReplacement(280); }, 680);
}
function damage(amount: number) {
  health = Math.max(0, health - amount); updateHud(); pulse(ui.damageFlash, 'flash--active'); navigator.vibrate?.([35, 35, 70]); tone(78, .23, 'sawtooth', .06, -38);
  if (health <= 0) endGame(false);
}
function endGame(survived: boolean) {
  if (phase !== 'running') return; runToken++; setPhase(survived ? 'complete' : 'defeated'); clearEnemies();
  const held = survived ? ROUND_SECONDS : Math.min(ROUND_SECONDS, Math.floor((performance.now() - gameStart) / 1000));
  ui.resultEyebrow.textContent = survived ? 'Containment report' : 'Containment failed'; ui.resultTitle.textContent = survived ? 'Seal held.' : 'Room lost.';
  ui.resultCopy.textContent = survived ? 'Two minutes. Three breaches. You kept every one of them contained.' : 'The room was overrun. Remap the breaches and try a different defense.';
  ui.finalScore.textContent = score.toString().padStart(6, '0'); ui.finalKills.textContent = String(kills);
  ui.finalTime.textContent = `${Math.floor(held / 60).toString().padStart(2, '0')}:${(held % 60).toString().padStart(2, '0')}`;
  setPanel(ui.result); tone(survived ? 360 : 120, .65, survived ? 'triangle' : 'sawtooth', .045, survived ? 150 : -85);
}

function updateDirections() {
  camera.getWorldDirection(viewVector); viewVector.y = 0;
  if (viewVector.lengthSq() < .001) viewVector.set(0, 0, -1); else viewVector.normalize();
  const viewBearing = Math.atan2(viewVector.x, -viewVector.z);
  ui.compassMarks.forEach((marker, index) => {
    const relative = normalize((breaches[index] ?? 0) - viewBearing);
    marker.style.transform = `translate(-50%, -50%) rotate(${relative}rad) translateY(-46px)`;
  });
  const living = enemies.filter((enemy) => !enemy.dead);
  if (!living.length) { ui.leftCue.classList.remove('direction-cue--active'); ui.rightCue.classList.remove('direction-cue--active'); ui.threatAlert.classList.remove('threat-alert--active'); return; }
  const angles = living.map((enemy) => normalize(Math.atan2(enemy.root.position.x, -enemy.root.position.z) - viewBearing));
  const nearest = angles.reduce((best, angle) => Math.abs(angle) < Math.abs(best) ? angle : best), threshold = .46;
  ui.leftCue.classList.toggle('direction-cue--active', nearest < -threshold); ui.rightCue.classList.toggle('direction-cue--active', nearest > threshold);
  const ahead = angles.filter((angle) => Math.abs(angle) <= threshold).length;
  ui.threatAlert.classList.toggle('threat-alert--active', ahead > 0); ui.threatCount.textContent = ahead > 1 ? `${ahead} contacts` : 'Contact';
}
function animate(now: number) {
  requestAnimationFrame(animate); const delta = Math.min((now - lastFrame) / 1000, .05); lastFrame = now;
  if (orientationActive) camera.quaternion.slerp(targetCameraQuaternion, .24);
  else {
    fallbackHeading += normalize(targetFallbackHeading - fallbackHeading) * .14;
    camera.quaternion.setFromAxisAngle(verticalAxis, fallbackHeading);
  }
  enemies.forEach((enemy) => animateParasite(enemy, now));
  if (phase === 'running') {
    const elapsed = (now - gameStart) / 1000, remaining = Math.max(0, Math.ceil(ROUND_SECONDS - elapsed));
    ui.time.textContent = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
    if (remaining <= 0) endGame(true);
    if (elapsed >= 30 && enemies.filter((enemy) => !enemy.dead).length < 3) spawnReplacement();
    enemies.forEach((enemy) => {
      if (enemy.dead) { enemy.root.rotation.z = THREE.MathUtils.lerp(enemy.root.rotation.z, -1.42, .1); enemy.root.position.y -= delta * .48; return; }
      moveVector.set(-enemy.root.position.x, 0, -enemy.root.position.z); const distance = moveVector.length();
      if (!enemy.attacking) {
        moveVector.normalize();
        enemy.root.position.addScaledVector(moveVector, enemy.speed * delta);
        enemy.root.position.x += -moveVector.z * Math.sin(now * .008 + enemy.id * 2.1) * .12 * delta;
        enemy.root.position.z += moveVector.x * Math.sin(now * .008 + enemy.id * 2.1) * .12 * delta;
      }
      enemy.root.rotation.y = Math.atan2(-enemy.root.position.x, -enemy.root.position.z);
      enemy.root.position.y = enemy.attacking ? .09 + Math.abs(Math.sin(now * .015)) * .14 : Math.sin(now * .007 + enemy.id) * .018;
      if (distance < 1.3 && !enemy.attacking) {
        enemy.attacking = true; enemy.sequence++; const sequence = enemy.sequence, token = runToken;
        window.setTimeout(() => {
          if (phase !== 'running' || token !== runToken || enemy.dead || enemy.sequence !== sequence) return;
          damage(enemy.kind === 'skitter' ? 21 : 17); removeEnemy(enemy); spawnReplacement(420);
        }, 610);
      }
    });
    updateDirections();
  }
  renderer.render(scene, camera);
}

ui.deploy.addEventListener('click', () => { setPhase('permission'); setPanel(ui.permission); tone(180, .08, 'triangle', .03, 80); });
ui.cameraButton.addEventListener('click', enableCamera); ui.simulationButton.addEventListener('click', startSimulation);
ui.markBreach.addEventListener('click', markBreach);
ui.fire.addEventListener('pointerdown', (event) => { event.preventDefault(); fireHeld = true; fire(); startRapidFire(); });
window.addEventListener('pointerup', stopRapidFire); window.addEventListener('pointercancel', stopRapidFire);
ui.restart.addEventListener('click', () => startScan(simulated));
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (phase !== 'scanning' && phase !== 'running') return; dragging = true; dragX = event.clientX; renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!dragging || orientationActive) return; const movement = event.clientX - dragX; dragX = event.clientX; targetFallbackHeading -= movement * .006;
});
renderer.domElement.addEventListener('pointerup', (event) => {
  dragging = false; if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
});
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space') { event.preventDefault(); fire(); }
  if (event.key === 'Enter' && phase === 'scanning') markBreach();
  if (event.key === 'ArrowLeft') targetFallbackHeading += .25; if (event.key === 'ArrowRight') targetFallbackHeading -= .25;
});
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
});
document.addEventListener('visibilitychange', () => { if (document.hidden && audioContext?.state === 'running') void audioContext.suspend(); });
setPhase('onboarding'); setPanel(ui.onboarding); updateHud(); requestAnimationFrame(animate);

