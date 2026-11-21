import assert from 'node:assert/strict';
import { createRace } from '../src/jeep/simulation.js';
import { track } from '../src/jeep/track.js';

const dt = 1 / 120;
const kemmel = track.turns.find(({ name }) => name === 'Kemmel Straight').s;
const station = kemmel + 34;
const gateIndex = track.checkpoints.findIndex((checkpoint) => checkpoint > station) + 1;
const wrapGap = (a, b) => Math.abs(a.s - b.s);
const overlap = (a, b) => wrapGap(a, b) < 3.75 - 0.015 && Math.abs(a.offset - b.offset) < 2.06 - 0.015;

function activeFixture(collisionMode) {
  const race = createRace({ collisionMode, impactTrial: true });
  for (const [i, car] of race.cars.entries()) {
    Object.assign(car, { s: station - 63 * i, offset: 0, speed: 0, heading: 0, nextGate: gateIndex });
  }
  return race;
}

function gatherImpact(race, input = {}) {
  const initialBest = race.player.bestLap;
  const initialGates = race.player.nextGate;
  const events = [];
  for (let i = 0; i < 245; i += 1) {
    race.step(dt, input);
    events.push(...race.events);
  }
  const hit = events.find(({ type, aId }) => type === 'impact' && aId === 'player');
  assert.equal(events.filter(({ type }) => type === 'raceStart').length, 1);
  assert.equal(race.player.bestLap, initialBest);
  assert.ok(race.player.nextGate >= initialGates);
  return hit;
}

const trials = [];
const idleSlides = {};
for (const collisionMode of ['breakaway', 'arcade']) {
  for (const throttle of [0, 1]) {
    const race = createRace({ collisionMode, impactTrial: true });
    const hit = gatherImpact(race, { throttle });
    assert.ok(hit.time >= 0.8 && hit.time <= 1.4);
    assert.equal(hit.mode, collisionMode);
    assert.equal(hit.severity, 'heavy');
    assert.equal(hit.aId, 'player');
    assert.equal(hit.bId, 'bot-1');
    assert.equal(hit.aSide, 'front');
    assert.equal(hit.bSide, 'rear');
    assert.equal(hit.parts.length, collisionMode === 'breakaway' ? 2 : 0);
    assert.equal(race.player.detachedParts.includes('frontBumper'), collisionMode === 'breakaway');
    assert.ok(race.cars.every((car) => !car.recovering));
    trials.push({ collisionMode, throttle, seconds: hit.time.toFixed(3), closingSpeed: hit.normalSpeed.toFixed(2), parts: hit.parts.length });
    const before = [race.player.s, race.elapsed, race.player.nextGate, race.player.lap];
    race.setCollisionMode(collisionMode === 'arcade' ? 'breakaway' : 'arcade');
    assert.deepEqual([race.player.s, race.elapsed, race.player.nextGate, race.player.lap], before);
    assert.ok(race.cars.every(({ detachedParts }) => detachedParts.length === 0));
    const restart = createRace({ collisionMode: race.collisionMode, impactTrial: true });
    assert.ok(restart.cars.every(({ detachedParts }) => detachedParts.length === 0));
    assert.ok(restart.player.s < before[0] && restart.elapsed === 0);
  }
}

for (const collisionMode of ['breakaway', 'arcade']) {
  const race = createRace({ collisionMode, impactTrial: true });
  let origin = null;
  const slide = { maxYaw: 0, maxLateral: 0 };
  while (race.elapsed < 2) {
    race.step(dt);
    if (!origin && race.events.some(({ type, aId }) => type === 'impact' && aId === 'player')) {
      origin = { time: race.elapsed, offset: race.player.offset, yaw: race.player.heading };
    }
    if (origin && race.elapsed <= origin.time + 0.8) {
      slide.maxYaw = Math.max(slide.maxYaw, Math.abs(race.player.heading - origin.yaw));
      slide.maxLateral = Math.max(slide.maxLateral, Math.abs(race.player.offset - origin.offset));
    }
  }
  assert.ok(origin);
  idleSlides[collisionMode] = slide;
}
assert.ok(idleSlides.arcade.maxLateral > 1.2 &&
  idleSlides.arcade.maxLateral > 1.8 * idleSlides.breakaway.maxLateral);
assert.ok(idleSlides.arcade.maxYaw > 0.09 && idleSlides.arcade.maxYaw > 1.8 * idleSlides.breakaway.maxYaw);

for (const collisionMode of ['breakaway', 'arcade']) {
  const race = activeFixture(collisionMode);
  const [player, rival] = race.cars;
  Object.assign(player, { s: station, speed: 27, heading: 0.54 });
  Object.assign(rival, { s: station + 1, offset: 1.98, speed: 20 });
  race.step(dt, { throttle: 1 });
  const hit = race.events.find(({ type }) => type === 'impact');
  assert.equal(hit?.severity, 'heavy');
  assert.equal(hit.aSide, 'right');
  assert.equal(hit.bSide, 'left');
  assert.ok(player.speed < 26);
  assert.ok(rival.speed > 19.5, 'The straight-running opponent retains speed');
  assert.ok(Math.abs(player.impactSlide) >= 3);
  assert.ok(Math.abs(player.impactYaw) >= 1);
  assert.ok(!overlap(player, rival));

  if (collisionMode === 'breakaway') {
    assert.deepEqual(player.detachedParts, ['wheelFR']);
    assert.deepEqual(rival.detachedParts, []);
    assert.ok(!player.recovering, 'Leave time for the wheel to visibly detach');
    const priorGate = player.nextGate;
    for (let i = 0; i < 75; i += 1) race.step(dt);
    assert.ok(player.recovering);
    for (let i = 0; i < 260; i += 1) race.step(dt);
    assert.ok(!player.recovering);
    assert.deepEqual(player.detachedParts, []);
    assert.equal(player.nextGate, priorGate);
    assert.equal(player.completedLaps, 0);
  } else {
    assert.deepEqual(player.detachedParts, []);
    for (let i = 0; i < 260; i += 1) race.step(dt, { steer: -0.05, throttle: 0.65 });
    assert.ok(!player.recovering && player.speed > 10);
  }
}

{
  const race = activeFixture('breakaway');
  const [player, rival] = race.cars;
  Object.assign(player, { s: station, speed: 25, heading: 0.065 });
  Object.assign(rival, { s: station + 1, offset: 2.05, speed: 25 });
  race.step(dt, { throttle: 1 });
  const hit = race.events.find(({ type }) => type === 'impact');
  assert.equal(hit?.severity, 'light');
  assert.deepEqual(player.detachedParts, []);
  assert.ok(player.speed > 23);
  let repeat = 0;
  for (let i = 0; i < 24; i += 1) {
    race.step(dt, { throttle: 1 });
    repeat += race.events.filter(({ type }) => type === 'impact').length;
  }
  assert.equal(repeat, 0);
}

{
  const race = activeFixture('breakaway');
  Object.assign(race.player, { offset: track.width / 2 + 2.77, heading: 0.57, speed: 27 });
  race.step(dt, { throttle: 1 });
  const wall = race.events.find(({ type }) => type === 'impact');
  assert.equal(wall?.bId, null);
  assert.equal(wall?.severity, 'heavy');
  assert.equal(wall?.aSide, 'right');
  assert.deepEqual(race.player.detachedParts, ['wheelFR']);
  race.setCollisionMode('arcade');
  for (let i = 0; i < 70; i += 1) race.step(dt, { steer: -0.08 });
  assert.ok(!race.player.recovering, 'Mode switch cancels a pending mechanical recovery');
  assert.deepEqual(race.player.detachedParts, []);
}

{
  const race = activeFixture('arcade');
  const gate = track.checkpoints[gateIndex - 1];
  const [player, rear, third, fourth] = race.cars;
  Object.assign(player, { s: gate - 0.18 });
  Object.assign(rear, { s: gate - 3.5, speed: 23 });
  Object.assign(third, { s: gate - 5.1, speed: 23 });
  Object.assign(fourth, { s: gate - 7.2, speed: 24 });
  race.step(dt);
  assert.equal(player.nextGate, gateIndex);
  assert.ok(player.s <= gate, 'Separation cannot push a Jeep past a checkpoint');
  for (let i = 0; i < 60; i += 1) race.step(dt, { throttle: 1 });
  for (const [index, car] of race.cars.entries()) {
    assert.ok(!race.cars.slice(index + 1).some((rival) => overlap(car, rival)));
    assert.ok(!car.recovering && Number.isFinite(car.speed));
  }
  assert.equal(player.nextGate, gateIndex + 1, 'Moving across the gate advances one checkpoint');
}
console.table(trials);
console.table(idleSlides);
console.log('Collision, trial, mode switch, recovery and pileup checks passed.');

