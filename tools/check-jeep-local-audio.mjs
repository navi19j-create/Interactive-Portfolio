import assert from 'node:assert/strict';
import { createRaceAudio } from '../src/jeep/audio.js';

class Param {
  value = 0;
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}

function audioNode() {
  return {
    gain: new Param(), frequency: new Param(), Q: new Param(), pan: new Param(),
    threshold: new Param(), knee: new Param(), ratio: new Param(),
    attack: new Param(), release: new Param(),
    setPeriodicWave() {}, connect() {}, disconnect() {}, start() {}, stop() {},
  };
}

const contexts = [];
globalThis.AudioContext = class {
  currentTime = 0;
  sampleRate = 1000;
  destination = audioNode();
  oscillators = [];
  panners = [];
  state = 'suspended';
  constructor() { contexts.push(this); }
  createGain() { return audioNode(); }
  createDynamicsCompressor() { return audioNode(); }
  createBiquadFilter() { return audioNode(); }
  createBufferSource() { return audioNode(); }
  createPeriodicWave() { return {}; }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  createOscillator() { const node = audioNode(); this.oscillators.push(node); return node; }
  createStereoPanner() { const node = audioNode(); this.panners.push(node); return node; }
  async suspend() { this.state = 'suspended'; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; }
};

const sound = createRaceAudio();
const race = {
  phase: 'racing',
  player: { id: 'player', speed: 22, boostTime: 0, wake: 0, s: 30 },
  player2: { id: 'player-2', speed: 22, boostTime: 0, wake: 0, s: 25 },
  events: [],
};
race.players = [race.player, race.player2];
sound.start();
sound.sync(race);
assert.equal(contexts.length, 0, 'Audio waits for the unlock gesture');
sound.unlock();
const ctx = contexts[0];

function sample(events = [], controls = {}, advance = .4) {
  race.events = events;
  ctx.currentTime += advance;
  const before = ctx.oscillators.length;
  sound.sync(race, controls);
  return ctx.oscillators.length - before;
}

sample();
assert.equal(ctx.oscillators.length, 7, 'Two driver channels and one crowd oscillator');
assert.equal(ctx.panners[0].pan.value, -.32);
assert.equal(ctx.panners[2].pan.value, .32);
const firstEngine = ctx.oscillators[0];
const secondEngine = ctx.oscillators[4];
const initialFirst = firstEngine.frequency.value;
const initialSecond = secondEngine.frequency.value;
sample([], { throttle2: true });
assert.equal(firstEngine.frequency.value, initialFirst, 'P2 throttle leaves P1 revs unchanged');
assert.ok(secondEngine.frequency.value > initialSecond);
sample([], { throttle: true });
assert.ok(firstEngine.frequency.value > initialFirst);
assert.equal(secondEngine.frequency.value, initialSecond);

race.player2.boostTime = 1.8;
assert.equal(sample(), 2, 'P2 boost cue is audible');
assert.equal(sample(), 0, 'Sustained P2 boost does not replay the cue');
race.player2.boostTime = 0;
assert.equal(sample([{ type: 'impact', aId: 'bot-1', bId: 'player-2', mode: 'arcade',
  normalSpeed: 5, severity: 'medium', parts: [] }]), 1, 'P2 impact is audible');
assert.equal(sample([{ type: 'pass', passerId: 'player-2', passedId: 'player' }]), 4, 'One cue for a mutual pass');
assert.equal(sample([{ type: 'pass', passerId: 'bot-2', passedId: 'player-2' }], {}, .08), 0, 'Suppress overlapping pass cues');

assert.equal(sample([{ type: 'playerFinish', playerId: 'player', position: 1 }]), 2, 'First finish gets a short cue');
const firstStoppedAt = firstEngine.frequency.value;
const secondContinuesFrom = secondEngine.frequency.value;
race.player2.speed = 24;
sample([], { throttle: true, throttle2: true });
assert.equal(firstEngine.frequency.value, firstStoppedAt);
assert.ok(secondEngine.frequency.value > secondContinuesFrom, 'Second engine responds after P1 finishes');
assert.equal(ctx.panners[2].pan.value, 0, 'Remaining driver returns to center');
assert.equal(sample([{ type: 'playerFinish', playerId: 'player-2', position: 3 }]), 13, 'One shared final fanfare');
sound.sync(race);
assert.equal(sample([{ type: 'playerFinish', playerId: 'player-2', position: 3 }]), 0);

sound.start();
assert.equal(sample([
  { type: 'playerFinish', playerId: 'player', position: 2 },
  { type: 'playerFinish', playerId: 'player-2', position: 1 },
]), 13, 'Same-frame finishes share one fanfare');

sound.start();
delete race.players;
assert.equal(sample([{ type: 'playerFinish', position: 1 }]), 13, 'Legacy solo finish contract is preserved');
sound.pause();
assert.equal(ctx.state, 'suspended');
sound.resume();
assert.equal(ctx.state, 'running');
sound.stop();
assert.equal(ctx.state, 'closed');
console.log('Shared two-player audio, cue de-duplication and legacy solo audio checks passed.');
