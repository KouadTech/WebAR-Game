import * as THREE from 'three';
import './style.css';

type Phase = 'onboarding' | 'permission' | 'scanning' | 'countdown' | 'running' | 'complete' | 'defeated';
type Kind = 'crawler' | 'skitter';
interface Enemy {
  id: number; root: THREE.Group;
  health: number; speed: number; dead: boolean; attacking: boolean;
  breach: number; sequence: number; kind: Kind;
}

const ROUND_SECONDS = 120;
const MAGAZINE_SIZE = 6;
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

function createGlassbackParasite(): THREE.Group {
  const creature = new THREE.Group(); creature.name = 'glassback-parasite';
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xb8b8a9, roughness: .58, metalness: .08, clearcoat: .34, clearcoatRoughness: .42 });
  const joint = new THREE.MeshStandardMaterial({ color: 0x302d34, roughness: .8, metalness: .12 });
  const membrane = new THREE.MeshPhysicalMaterial({ color: 0x57445e, emissive: 0x21162d, emissiveIntensity: 1.2, roughness: .28, transparent: true, opacity: .82, clearcoat: .7 });
  const coreMaterial = new THREE.MeshBasicMaterial({ color: 0xd2a6db, transparent: true, opacity: .72 });
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0xe8c97a });
  const tooth = new THREE.MeshStandardMaterial({ color: 0xc9c6b3, roughness: .76 });

  const abdomen = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), membrane);
  abdomen.name = 'abdomen'; abdomen.position.set(0, .34, -.22); abdomen.scale.set(.48, .27, .64); creature.add(abdomen);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), coreMaterial);
  core.name = 'pulse-core'; core.position.copy(abdomen.position); core.scale.set(.29, .16, .4); creature.add(core);
  const thorax = new THREE.Mesh(new THREE.IcosahedronGeometry(.39, 1), shell);
  thorax.position.set(0, .31, .22); thorax.scale.set(1, .62, 1.08); creature.add(thorax);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(.27, 1), joint);
  head.position.set(0, .3, .51); head.scale.set(1.12, .7, .92); creature.add(head);

  const legAngles = [0, Math.PI * .25, Math.PI * .5, Math.PI * .75, Math.PI, Math.PI * 1.25, Math.PI * 1.5, Math.PI * 1.75];
  legAngles.forEach((angle, index) => {
    const hip = new THREE.Group(); hip.name = `leg-${index}`; hip.userData.baseAngle = angle; hip.position.y = .28; hip.rotation.y = angle;
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(.045, .43, 4, 7), shell);
    upper.position.x = .245; upper.rotation.z = -Math.PI / 2; hip.add(upper);
    const knee = new THREE.Mesh(new THREE.IcosahedronGeometry(.075, 1), joint); knee.position.x = .5; hip.add(knee);
    const shin = new THREE.Group(); shin.name = `shin-${index}`; shin.position.x = .49; shin.rotation.z = -.48; hip.add(shin);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(.035, .54, 4, 7), joint);
    lower.position.set(.29, -.15, 0); lower.rotation.z = -Math.PI / 2 - .48; shin.add(lower);
    const claw = new THREE.Mesh(new THREE.ConeGeometry(.045, .18, 5), tooth);
    claw.position.set(.56, -.31, 0); claw.rotation.z = -1.85; shin.add(claw);
    creature.add(hip);
  });

  const eyeLayout = [[-.13, .34], [0, .37], [.13, .34], [-.07, .26], [.07, .26]];
  eyeLayout.forEach(([x, y], index) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(index === 1 ? .038 : .028, 8, 6), eyeMaterial);
    eye.position.set(x, y, .735); creature.add(eye);
  });
  [-1, 1].forEach((side) => {
    const mandible = new THREE.Mesh(new THREE.CapsuleGeometry(.025, .21, 3, 6), tooth);
    mandible.position.set(side * .105, .22, .71); mandible.rotation.set(Math.PI / 2.7, 0, side * -.42); creature.add(mandible);
  });
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(1.65, .85, 1.65), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  hitbox.name = 'parasite-hitbox'; hitbox.position.y = .34; creature.add(hitbox);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.9, 32), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = .012; creature.add(shadow);
  creature.traverse((part) => { if (part instanceof THREE.Mesh) { part.castShadow = part.name !== 'parasite-hitbox'; part.receiveShadow = part.name !== 'parasite-hitbox'; } });
  return creature;
}

function animateParasite(enemy: Enemy, now: number) {
  const tempo = enemy.kind === 'skitter' ? .014 : .0095;
  for (let index = 0; index < 8; index++) {
    const leg = enemy.root.getObjectByName(`leg-${index}`);
    const shin = enemy.root.getObjectByName(`shin-${index}`);
    if (!leg || !shin) continue;
    const step = Math.sin(now * tempo + index * 2.17 + enemy.id);
    leg.rotation.y = leg.userData.baseAngle + step * .16;
    leg.rotation.z = step * .09;
    shin.rotation.z = -.48 + Math.cos(now * tempo + index * 2.17 + enemy.id) * .2;
  }
  const breath = 1 + Math.sin(now * .004 + enemy.id) * .055;
  enemy.root.getObjectByName('abdomen')?.scale.set(.48 * breath, .27 / breath, .64 * breath);
  enemy.root.getObjectByName('pulse-core')?.scale.set(.29 * breath, .16 * breath, .4 * breath);
}
function createEnemy(breach: number) {
  const root = template.clone(true), id = nextEnemyId++;
  const elapsed = gameStart ? (performance.now() - gameStart) / 1000 : 0;
  const kind: Kind = Math.random() < Math.min(.28 + elapsed / 420, .5) ? 'skitter' : 'crawler';
  const enemy: Enemy = { id, root, health: kind === 'skitter' ? 80 : 100,
    speed: kind === 'skitter' ? .82 : .43, dead: false, attacking: false, breach, sequence: 1, kind };
  root.traverse((part) => { part.userData.enemyId = id; if (part instanceof THREE.Mesh) part.castShadow = part.name !== 'parasite-hitbox'; });
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
function updateControlHint() { if (phase === 'running' && !reloading) ui.status.textContent = orientationActive ? 'Turn your body • center movement' : 'Drag to turn • center movement'; }

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
function eliminate(enemy: Enemy) {
  enemy.dead = true; enemy.sequence++; kills++; score += enemy.kind === 'skitter' ? 125 : 100; updateHud();
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
ui.markBreach.addEventListener('click', markBreach); ui.fire.addEventListener('pointerdown', (event) => { event.preventDefault(); fire(); });
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

