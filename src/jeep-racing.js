import { createRace } from './jeep/simulation.js';
import { track } from './jeep/track.js';
import { liveries } from './jeep/liveries.js';
import { createRaceAudio } from './jeep/audio.js';

const get = (id) => document.getElementById(id);
const project = get('project');
const arena = get('arena');
let canvas = get('race-canvas');
const hud = get('hud');
const screen = get('screen');
const primary = get('primary');
const back = get('back');
const launch = get('launch');
const boostButton = get('boost');
const touch = matchMedia('(pointer: coarse)');
const sideBySide = matchMedia('(min-width: 900px), (min-width: 620px) and (max-height: 550px) and (orientation: landscape)');
const keys = new Set();
const fingers = new Map();
const heldButtons = ['left', 'right', 'brake'].map(get);
const soloDriveKeys = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space', 'KeyR',
]);
const driverBindings = [
  { left: 'KeyA', right: 'KeyD', gas: 'KeyW', brake: 'KeyS', boost: 'KeyQ', recover: 'KeyE' },
  { left: 'ArrowLeft', right: 'ArrowRight', gas: 'ArrowUp', brake: 'ArrowDown', boost: 'Enter', recover: 'Slash' },
];
const driverKeys = new Map(driverBindings.flatMap((binding, index) =>
  Object.values(binding).map(code => [code, index])));
const boostRequested = [false, false];
const recoverRequested = [false, false];
const svgNS = 'http://www.w3.org/2000/svg';
const placeLabels = ['1st place', '2nd place', '3rd place', '4th place'];
const cameraNames = { chase: 'Chase', isometric: 'Isometric', miniature: 'Miniature' };
let touchMode = touch.matches;
let game = null;
let world = null;
let pendingWorld = null;
let frameId = 0;
let lastTime = null;
let state = 'project';
let requestId = 0;
let runs = 0;
let trial = false;
let split = false;
let gridOptions;
let impactUntil = 0;
const impactReadout = get('impact-readout');

function readSetting(name) {
  try { return localStorage.getItem(name); } catch { return null; }
}

function writeSetting(name, value) {
  try { localStorage.setItem(name, value); } catch { /* Controls work without storage. */ }
}

const savedTrialMode = readSetting('jeep-trial-collision-mode') ?? readSetting('jeep-collision-mode');
let trialCollisionMode = savedTrialMode === 'arcade' ? 'arcade' : 'breakaway';
const savedCamera = readSetting('jeep-camera');
let cameraMode = Object.hasOwn(cameraNames, savedCamera) ? savedCamera : 'chase';
const collisionPanels = [...document.querySelectorAll('[data-collision-controls]')];
for (const panel of collisionPanels) {
  panel.append(get('collision-tools').content.cloneNode(true));
}
for (const panel of document.querySelectorAll('[data-camera-setting]')) {
  panel.append(get('camera-picker').content.cloneNode(true));
}
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const cameraPickers = [...document.querySelectorAll('[data-camera]')];

function updateModeButtons() {
  for (const button of modeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === trialCollisionMode));
  }
}

function updateCameraPickers() {
  for (const picker of cameraPickers) picker.value = cameraMode;
  canvas.setAttribute('aria-label', `${cameraNames[cameraMode]} ${split ? 'split-screen views' : 'view'} of the circuit`);
}

for (const button of modeButtons) {
  button.addEventListener('click', event => {
    if (!trial || !['racing', 'paused', 'results'].includes(state)) return;
    if (trialCollisionMode === button.dataset.mode) return;
    trialCollisionMode = button.dataset.mode;
    game.setCollisionMode(trialCollisionMode);
    writeSetting('jeep-trial-collision-mode', trialCollisionMode);
    updateModeButtons();
    showImpact('Restart to compare the same hit.', Infinity);
    if (state === 'racing' && event.detail) arena.focus({ preventScroll: true });
  });
}
updateModeButtons();
for (const picker of cameraPickers) {
  let pointerChoice = false;
  picker.addEventListener('pointerdown', () => { pointerChoice = true; });
  picker.addEventListener('keydown', () => { pointerChoice = false; });
  picker.addEventListener('change', () => {
    cameraMode = picker.value;
    writeSetting('jeep-camera', cameraMode);
    updateCameraPickers();
    if (state === 'paused' || state === 'results') redraw();
    if (state === 'racing' && pointerChoice) arena.focus({ preventScroll: true });
    pointerChoice = false;
  });
}
updateCameraPickers();
for (const button of document.querySelectorAll('[data-restart]')) {
  button.addEventListener('click', () => {
    if (!['racing', 'paused', 'results'].includes(state)) return;
    sound.unlock();
    startRace(true);
  });
}
let celebrationElapsed = 0;
const sound = createRaceAudio();
const soundButtons = [...document.querySelectorAll('[data-sound]')];

function updateSoundControls() {
  for (const button of soundButtons) {
    button.setAttribute('aria-label', 'Race sound');
    button.setAttribute('aria-pressed', String(!sound.muted));
    button.title = sound.muted ? 'Enable race sound' : 'Mute race sound';
    const label = button.querySelector('[data-sound-label]');
    if (label) label.textContent = sound.muted ? 'Sound off' : 'Sound on';
  }
}
for (const button of soundButtons) {
  button.addEventListener('click', (event) => {
    sound.setMuted(!sound.muted);
    if (!sound.muted && ['racing', 'finishing', 'results'].includes(state)) sound.unlock();
    updateSoundControls();
    if (event.detail > 0 && state === 'racing') arena.focus({ preventScroll: true });
  });
}
updateSoundControls();

get('lineup').append(...liveries.map(({ name, swatch }, index) => {
  const item = document.createElement('li');
  const label = document.createElement('strong');
  label.textContent = name;
  item.style.setProperty('--scheme', swatch);
  item.append(label);
  if (index === 0) {
    const player = document.createElement('small');
    player.textContent = 'You';
    item.append(player);
  }
  return item;
}));

const cover = get('cover');
const useStill = () => {
  cover.removeEventListener('error', useStill);
  cover.src = '../assets/jeep-race/deployed.webp';
  cover.alt = 'Little Box Jeep in its deployed configuration';
};
cover.addEventListener('error', useStill);
if (cover.complete && !cover.naturalWidth) useStill();

get('work-back').addEventListener('click', (event) => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || !document.referrer) return;
  const previous = new URL(document.referrer);
  const work = new URL('../', location.href);
  if (previous.origin === work.origin && [work.pathname, work.pathname + 'index.html'].includes(previous.pathname)) {
    event.preventDefault();
    history.back();
  }
});

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.round(seconds * 1000);
  const min = Math.floor(total / 60000);
  const rest = (total % 60000 / 1000).toFixed(3).padStart(6, '0');
  return min + ':' + rest;
}

function updateAttribute(element, name, value) {
  const text = String(value);
  if (element.getAttribute(name) !== text) element.setAttribute(name, text);
}

function updateText(element, value) {
  const text = String(value);
  if (element.textContent !== text) element.textContent = text;
}

function createMinimap() {
  const map = get('minimap');
  const spine = Array.from({ length: 190 }, (_, i) => track.sample(i * track.length / 190));
  const xs = spine.map((sample) => sample.x);
  const zs = spine.map((sample) => sample.z);
  const left = Math.min(...xs);
  const top = Math.max(...zs);
  const scale = Math.min(108 / (Math.max(...xs) - left), 90 / (top - Math.min(...zs)));
  const point = ({ x, z }) => [(x - left) * scale + 5, (top - z) * scale + 5];
  const d = spine.map((sample, i) =>
    (i === 0 ? 'M' : 'L') + point(sample).map((coord) => coord.toFixed(1)).join(',')).join(' ') + ' Z';
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#c4c9bd');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('stroke-linejoin', 'round');
  map.append(path);

  const target = document.createElementNS(svgNS, 'circle');
  target.setAttribute('r', '5.6');
  target.setAttribute('fill', 'none');
  target.setAttribute('stroke', '#78ead8');
  target.setAttribute('stroke-width', '1.65');
  target.setAttribute('opacity', '0');
  const markers = liveries.map(({ swatch }, index) => {
    const marker = document.createElementNS(svgNS, 'circle');
    marker.setAttribute('fill', index === 0 ? '#ffe168' : swatch);
    marker.setAttribute('r', index === 0 ? '4.2' : '2.8');
    marker.setAttribute('stroke', '#101720');
    marker.setAttribute('stroke-width', '1');
    return marker;
  });
  map.append(...markers.slice(1), target, markers[0]);

  return (cars, rivalIndex) => {
    updateAttribute(target, 'opacity', rivalIndex > 0 ? '1' : '0');
    for (let i = 0; i < cars.length; i += 1) {
      const [x, y] = point(track.sample(cars[i].s));
      updateAttribute(markers[i], 'cx', x.toFixed(1));
      updateAttribute(markers[i], 'cy', y.toFixed(1));
      if (i === rivalIndex) {
        updateAttribute(target, 'cx', x.toFixed(1));
        updateAttribute(target, 'cy', y.toFixed(1));
      }
    }
  };
}

const updateMap = createMinimap();

function setUpWakeTitle(wake) {
  const title = wake.querySelector('.wake-title');
  const label = title.textContent.trim();
  const readable = document.createElement('span');
  readable.className = 'wake-readable';
  readable.textContent = label;
  const word = document.createElement('span');
  word.setAttribute('aria-hidden', 'true');
  for (const [index, char] of [...label].entries()) {
    const letter = document.createElement('span');
    letter.className = 'wake-letter';
    letter.textContent = char;
    letter.style.setProperty('--rise', (Math.sin(index * 0.82) * 3).toFixed(1) + 'px');
    letter.style.setProperty('--delay', (-index * 115) + 'ms');
    word.append(letter);
  }
  title.replaceChildren(readable, word);
}

const soloInstruments = {
  root: hud, position: get('position'), lap: get('lap'), speed: get('speed'),
  wake: get('wake'), wakeSource: get('wake-source'), wakeRival: get('wake-rival'), wakeGap: get('wake-gap'),
  boost: boostButton, boostState: get('boost-state'), lights: get('start-lights'), finish: get('countdown'),
};
setUpWakeTitle(soloInstruments.wake);

const driverInstruments = driverBindings.map((binding, index) => {
  const playerName = `Player ${index + 1}`;
  const root = get('driver-tools').content.firstElementChild.cloneNode(true);
  root.dataset.playerHud = index + 1;
  root.setAttribute('aria-label', `${playerName} instruments`);
  root.style.setProperty('--driver-accent', liveries[index].swatch);
  const field = name => root.querySelector(`[data-driver-${name}]`);
  const keyLabel = code => ({ Enter: 'Enter', Slash: '/' }[code] ?? code.slice(-1));
  field('name').textContent = playerName;
  field('livery').textContent = liveries[index].name;
  field('keys').textContent = index === 0 ? 'WASD' : '↑↓←→';
  field('boost-key').textContent = keyLabel(binding.boost);
  field('recover-key').textContent = keyLabel(binding.recover);
  const boost = field('boost');
  const boostState = field('boost-state');
  const boostStatus = boostState.parentElement;
  boostStatus.id = `driver-${index + 1}-boost-status`;
  boost.setAttribute('aria-label', `${playerName} Overtake`);
  boost.setAttribute('aria-describedby', boostStatus.id);
  boost.setAttribute('aria-keyshortcuts', keyLabel(binding.boost));
  boost.addEventListener('click', event => {
    if (state !== 'racing' || !split) return;
    boostRequested[index] = true;
    if (event.detail > 0) arena.focus({ preventScroll: true });
  });
  setUpWakeTitle(field('wake'));

  const result = get('driver-result').content.firstElementChild.cloneNode(true);
  result.style.setProperty('--driver-accent', liveries[index].swatch);
  result.querySelector('[data-result-name]').textContent = `${playerName} · ${liveries[index].name}`;

  return {
    root, result, position: field('position'), lap: field('lap'), speed: field('speed'),
    wake: field('wake'), wakeSource: field('wake-source'), wakeRival: field('wake-rival'), wakeGap: field('wake-gap'),
    boost, boostState, lights: field('lights'), finish: field('finish'),
    resultPosition: result.querySelector('[data-result-position]'), resultTime: result.querySelector('[data-result-time]'),
    resultBest: result.querySelector('[data-result-best]'),
  };
});

function showImpact(label, until) {
  impactReadout.textContent = label;
  impactReadout.hidden = !label;
  impactUntil = until;
}

function updateImpact() {
  const {player} = game;
  const hit = game.events.find(event => event.type === 'impact' &&
    (event.aId === player.id || event.bId === player.id));
  if (hit) {
    const lostWheel = hit.parts.some(part => part.partId.startsWith('wheel'));
    const label = lostWheel ? 'Wheel off' : hit.parts.length ? 'Bumper off' :
      { light: 'Light contact', medium: 'Bump', heavy: 'Heavy impact' }[hit.severity];
    showImpact(label, trial ? Infinity : game.elapsed + 1.6);
  } else if (!impactReadout.hidden && game.elapsed > impactUntil) {
    showImpact('', 0);
  }
}

function updateInstruments(player, view, standings, cue) {
  updateText(view.position, standings.indexOf(player) + 1);
  updateText(view.lap, player.lap);
  updateText(view.speed, Math.round(Math.abs(player.speed) * 3.6));
  const strength = cue ? (player.wake > 0.72 ? 3 : player.wake > 0.38 ? 2 : 1) : 0;
  const rivalIndex = cue?.rivalIndex ?? -1;
  updateAttribute(view.wake, 'data-strength', strength);
  updateAttribute(view.wake, 'data-visible', Boolean(cue));
  updateAttribute(view.wake, 'aria-hidden', !cue);
  if (cue) {
    view.wake.style.setProperty('--wake-x', cue.x.toFixed(1) + 'px');
    view.wake.style.setProperty('--wake-y', cue.y.toFixed(1) + 'px');
    view.wake.style.setProperty('--wake-width', cue.width.toFixed(1) + 'px');
    const { name, swatch } = liveries[rivalIndex];
    view.wakeSource.style.setProperty('--rival', swatch);
    updateText(view.wakeRival, name);
    updateText(view.wakeGap, Number.isFinite(player.towGap) ? Math.round(player.towGap) + ' m' : '');
  } else {
    updateText(view.wakeRival, '');
    updateText(view.wakeGap, '');
  }
  const boostState = player.boostTime > 0 ? 'active' : player.recharge > 0 ? 'charging' : 'ready';
  updateAttribute(view.boost, 'data-state', boostState);
  updateAttribute(view.root, 'data-boost', boostState === 'active');
  const charge = boostState === 'active' ? player.boostTime / 2 : 1 - player.recharge / 8;
  view.boost.style.setProperty('--charge', Math.min(1, Math.max(0, charge)));
  updateText(view.boostState, boostState === 'active' ? 'Active' :
    boostState === 'ready' ? 'Ready' : Math.ceil(player.recharge) + ' s');
  const { lights, finish: callout } = view;
  lights.toggleAttribute('hidden', game.phase !== 'countdown');
  updateAttribute(lights, 'data-lit', game.startLights);
  const done = split && player.finishPosition !== null;
  const label = done ? placeLabels[player.finishPosition - 1] : game.phase === 'countdown' ? '' :
    player.recovering ? 'Recovering' : game.elapsed < 0.65 ? 'Go!' : '';
  if (callout.textContent !== label) callout.textContent = label;
  callout.classList.toggle('notice', player.recovering);
  if (split) callout.classList.toggle('finish-banner', done);
  return rivalIndex;
}

function updateHUD() {
  const standings = game.standings();
  const cues = game.phase === 'racing' ? world.wakeCues : [];
  if (split) {
    game.players.forEach((player, i) => updateInstruments(player, driverInstruments[i], standings, cues[i]));
    return;
  }
  updateMap(game.cars, updateInstruments(game.player, soloInstruments, standings, cues[0]));
}

function clearInput() {
  keys.clear();
  fingers.clear();
  boostRequested.fill(false);
  recoverRequested.fill(false);
  for (const button of heldButtons) button.dataset.held = 'false';
}

function setTouchMode(enabled) {
  touchMode = enabled && !split;
  arena.classList.toggle('touch', touchMode);
}

function showScreen(title, { copy = '', label = '', results = false, fallback = false } = {}) {
  get('screen-title').textContent = title;
  get('screen-copy').textContent = copy;
  get('screen-copy').hidden = !copy;
  primary.textContent = label;
  primary.hidden = !label;
  screen.dataset.results = String(results);
  get('stats').hidden = !results || split;
  get('split-results').hidden = !results || !split;
  get('film').hidden = !fallback;
  get('dialog-sound').hidden = state !== 'paused' && state !== 'results';
  get('dialog-controls').hidden = get('dialog-sound').hidden;
  hud.inert = true;
  screen.hidden = false;
  (primary.hidden ? back : primary).focus();
}

function hideScreen() {
  screen.hidden = true;
  hud.inert = false;
  arena.focus();
}

function readInput(index = 0) {
  const binding = driverBindings[index];
  const held = (name) => [...fingers.values()].includes(name);
  const left = keys.has(binding.left) || (!split && (keys.has('ArrowLeft') || held('left')));
  const right = keys.has(binding.right) || (!split && (keys.has('ArrowRight') || held('right')));
  const acceleration = keys.has(binding.gas) || (!split && (touchMode || keys.has('ArrowUp')));
  const brake = keys.has(binding.brake) || (!split && (keys.has('ArrowDown') || held('brake')));
  const command = {
    steer: Number(right) - Number(left),
    throttle: Number(acceleration),
    brake: Number(brake),
    boost: boostRequested[index],
    recover: recoverRequested[index],
  };
  boostRequested[index] = false;
  recoverRequested[index] = false;
  return command;
}

function updateLayout() {
  arena.dataset.layout = sideBySide.matches ? 'side-by-side' : 'stacked';
}

function renderRace(dt) {
  world.render(game, dt, 'race', { cameraMode, layout: arena.dataset.layout });
}

function redraw() {
  if (!world || !game) return;
  try { renderRace(0); } catch { onUnavailable(); }
}

function fillResults() {
  if (split) {
    game.players.forEach((player, index) => {
      const view = driverInstruments[index];
      view.resultPosition.textContent = player.finishPosition + ' / ' + game.cars.length;
      view.resultTime.textContent = formatTime(player.finishTime);
      view.resultBest.textContent = formatTime(player.bestLap);
    });
    return;
  }
  const { player } = game;
  get('finish-place').textContent = player.finishPosition + ' / ' + game.cars.length;
  get('finish-time').textContent = formatTime(player.finishTime);
  get('best-lap').textContent = formatTime(player.bestLap);
  get('countdown').classList.add('finish-banner');
  get('countdown').textContent = placeLabels[player.finishPosition - 1];
}

function onFrame(now) {
  frameId = 0;
  if (state !== 'racing' || !world) return;
  const dt = lastTime === null ? 1 / 60 : Math.min((now - lastTime) / 1000, 0.08);
  lastTime = now;
  const controls = readInput();
  const secondControls = split ? readInput(1) : undefined;
  game.step(dt, controls, secondControls);
  sound.sync(game, { ...controls, throttle2: secondControls?.throttle ?? 0 });
  if (!split) updateImpact();
  try {
    world.react(game.events, game);
    renderRace(dt);
  } catch {
    onUnavailable();
    return;
  }
  updateHUD();
  if (game.phase === 'finished') {
    state = 'finishing';
    clearInput();
    arena.classList.add('finishing');
    fillResults();
    celebrationElapsed = 0;
    frameId = requestAnimationFrame(celebrate);
    return;
  }
  frameId = requestAnimationFrame(onFrame);
}

function showResults() {
  state = 'results';
  get('countdown').textContent = '';
  showScreen('Race complete', { label: trial ? 'Test again' : 'Race again', results: true });
}

function celebrate(now) {
  frameId = 0;
  if (!world || (state !== 'finishing' && state !== 'results')) return;
  const dt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  celebrationElapsed += dt;
  try {
    renderRace(Math.min(dt, 0.08));
  } catch {
    onUnavailable();
    return;
  }
  if (state === 'finishing' && celebrationElapsed >= 1.4) showResults();
  if (celebrationElapsed < 3.5) frameId = requestAnimationFrame(celebrate);
  else sound.pause();
}

function startRace(restart = false) {
  cancelAnimationFrame(frameId);
  arena.classList.remove('finishing');
  get('countdown').classList.remove('finish-banner');
  if (!restart) {
    gridOptions = trial ? { playerGrid: 2, seed: 1288 } :
      { playerGrid: (runs + 2) % 4, seed: 1288 + runs * 68437 };
    if (!trial) runs += 1;
  }
  game = createRace({
    ...gridOptions, collisionMode: trial ? trialCollisionMode : 'breakaway',
    impactTrial: trial, playerCount: split ? 2 : 1,
  });
  showImpact(trial ? 'Stay straight to test the hit.' : '', trial ? Infinity : 0);
  state = 'racing';
  sound.start();
  clearInput();
  hud.hidden = false;
  get('split-hud').hidden = !split;
  hideScreen();
  updateHUD();
  lastTime = null;
  frameId = requestAnimationFrame(onFrame);
}

function pauseRace() {
  if (state !== 'racing') return;
  state = 'paused';
  sound.pause();
  cancelAnimationFrame(frameId);
  clearInput();
  lastTime = null;
  showScreen('Paused', { label: 'Resume race' });
}

function resumeRace() {
  if (state !== 'paused') return;
  state = 'racing';
  sound.unlock();
  sound.resume();
  hideScreen();
  frameId = requestAnimationFrame(onFrame);
}

function releaseWorld() {
  sound.stop();
  cancelAnimationFrame(frameId);
  frameId = 0;
  lastTime = null;
  clearInput();
  const active = world;
  const pending = pendingWorld;
  world = null;
  pendingWorld = null;
  game = null;
  active?.dispose();
  pending?.dispose();
}

function onUnavailable() {
  state = 'unavailable';
  releaseWorld();
  hud.hidden = true;
  showScreen('3D unavailable', {
    copy: 'The race could not start on this device. You can still watch the Little Box Jeep showcase.',
    label: 'Try again',
    fallback: true,
  });
}

async function enter(kind = 'solo') {
  if (state !== 'project' && state !== 'unavailable') return;
  trial = kind === 'trial';
  split = kind === 'split';
  arena.dataset.race = kind;
  if (split) {
    get('split-hud').append(...driverInstruments.map(view => view.root));
    get('split-results').append(...driverInstruments.map(view => view.result));
  }
  for (const panel of collisionPanels) panel.hidden = !trial;
  sound.unlock();
  const token = ++requestId;
  const surface = canvas.cloneNode();
  canvas.replaceWith(surface);
  canvas = surface;
  updateLayout();
  updateCameraPickers();
  surface.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    if (surface === canvas && world) onUnavailable();
  });
  setTouchMode(touch.matches);
  state = 'loading';
  project.inert = true;
  arena.hidden = false;
  document.body.classList.add('playing');
  showScreen('Loading Spa');
  let candidate;
  try {
    const { createWorld } = await import('./jeep/world.js');
    if (token !== requestId) return;
    candidate = createWorld(surface);
    pendingWorld = candidate;
    await candidate.ready;
    if (token !== requestId) {
      candidate.dispose();
      return;
    }
    pendingWorld = null;
    world = candidate;
    world.resize();
    startRace();
    if (document.hidden) pauseRace();
  } catch {
    if (token === requestId) onUnavailable();
    else candidate?.dispose();
  }
}

function exit() {
  requestId += 1;
  state = 'project';
  releaseWorld();
  arena.hidden = true;
  screen.hidden = true;
  hud.hidden = true;
  get('split-hud').replaceChildren();
  get('split-results').replaceChildren();
  document.body.classList.remove('playing');
  project.inert = false;
  (trial ? get('launch-trial') : split ? get('launch-split') : launch).focus({ preventScroll: true });
}

launch.addEventListener('click', () => enter());
get('launch-split').addEventListener('click', () => enter('split'));
get('launch-trial').addEventListener('click', () => enter('trial'));
back.addEventListener('click', exit);
primary.addEventListener('click', () => {
  if (state === 'paused') resumeRace();
  else if (state === 'results') {
    sound.unlock();
    startRace();
  }
  else if (state === 'unavailable') enter(arena.dataset.race);
});
get('pause').addEventListener('click', pauseRace);
get('recover').addEventListener('click', () => { if (!split) recoverRequested[0] = true; });
boostButton.addEventListener('click', (event) => {
  if (!split && event.pointerType !== 'touch') boostRequested[0] = true;
});
arena.addEventListener('pointerdown', (event) => {
  if (!split && event.pointerType === 'touch' && !touchMode) setTouchMode(true);
});
touch.addEventListener('change', () => { clearInput(); setTouchMode(touch.matches); });

for (const button of heldButtons) {
  button.addEventListener('pointerdown', (event) => {
    if (state !== 'racing' || split) return;
    fingers.set(event.pointerId, button.id);
    button.dataset.held = 'true';
    button.setPointerCapture(event.pointerId);
  });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(eventName, (event) => {
      fingers.delete(event.pointerId);
      button.dataset.held = String([...fingers.values()].includes(button.id));
    });
  }
}
boostButton.addEventListener('pointerdown', (event) => {
  if (!split && event.pointerType === 'touch') {
    event.preventDefault();
    boostRequested[0] = true;
  }
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Escape') {
    if (state === 'racing') pauseRace();
    else if (state === 'paused') resumeRace();
    else if (state === 'finishing') showResults();
    else if (['results', 'unavailable', 'loading'].includes(state)) exit();
    return;
  }
  if (event.key === 'Tab' && !screen.hidden) {
    const focusables = [...screen.querySelectorAll('button, a, select')].filter(element => !element.closest('[hidden]'));
    const next = event.shiftKey ? focusables[0] : focusables.at(-1);
    if (document.activeElement === next) {
      event.preventDefault();
      (event.shiftKey ? focusables.at(-1) : focusables[0]).focus();
    }
    return;
  }
  if (state !== 'racing' || event.ctrlKey || event.metaKey || event.altKey) return;
  const driver = split ? driverKeys.get(event.code) : soloDriveKeys.has(event.code) ? 0 : undefined;
  if (driver === undefined || event.target instanceof HTMLSelectElement) return;
  if (['Space', 'Enter'].includes(event.code) && event.target instanceof HTMLElement &&
      event.target.closest('button, a') && event.target !== boostButton) return;
  event.preventDefault();
  keys.add(event.code);
  if (!event.repeat && event.code === (split ? driverBindings[driver].boost : 'Space')) boostRequested[driver] = true;
  if (!event.repeat && event.code === (split ? driverBindings[driver].recover : 'KeyR')) recoverRequested[driver] = true;
});
window.addEventListener('keyup', (event) => keys.delete(event.code));
function leaveRaceFocus() {
  clearInput();
  if (state === 'racing') pauseRace();
  if (state === 'finishing' || state === 'results') {
    sound.pause();
    cancelAnimationFrame(frameId);
    if (state === 'finishing') showResults();
  }
}
window.addEventListener('blur', leaveRaceFocus);
document.addEventListener('visibilitychange', () => { if (document.hidden) leaveRaceFocus(); });
window.addEventListener('resize', () => {
  updateLayout();
  if (!world) return;
  world.resize();
  if (state === 'paused' || state === 'results') redraw();
});
window.addEventListener('pagehide', () => { if (state !== 'project') exit(); });





