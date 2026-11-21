import assert from 'node:assert/strict';
import { createRace } from '../src/jeep/simulation.js';
import { track } from '../src/jeep/track.js';

const dt = 1 / 120;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const arrayFor = (race, type) => race.events.filter((event) => event.type === type);

function readyRace(options) {
  const race = createRace({ playerCount: 2, ...options });
  assert.deepEqual(race.cars.map(({ id }) => id), ['player', 'player-2', 'bot-1', 'bot-2']);
  assert.deepEqual(new Set(race.cars.map(({ grid }) => grid)), new Set([0, 1, 2, 3]));
  assert.deepEqual(race.players, [race.player, race.player2]);
  const startPositions = race.players.map(({ s }) => s);
  const startEvents = [];
  while (race.phase === 'countdown') {
    race.step(dt, { throttle: 1 }, { throttle: 1 });
    startEvents.push(...arrayFor(race, 'raceStart'));
    assert.deepEqual(race.players.map(({ s }) => s), startPositions);
  }
  assert.equal(startEvents.length, 1);
  return race;
}

{
  const solo = createRace();
  assert.deepEqual(solo.players, [solo.player]);
  assert.equal(solo.player2, null);
  const trial = createRace({ playerCount: 2, impactTrial: true });
  assert.equal(trial.players.length, 1, 'Impact trial retains the single-player rolling grid');
}

{
  const race = readyRace();
  const [first, second] = race.players;
  race.step(dt / 2, { throttle: 1 }, { throttle: 1, boost: true });
  assert.equal(second.boostTime, 0);
  race.step(dt / 2, { throttle: 1 }, { throttle: 1 });
  assert.ok(second.boostTime > 0, 'P2 tap survives frames with no simulation tick');
  assert.equal(first.boostTime, 0);
  race.step(dt, { throttle: 1, steer: -1, boost: true }, { brake: 1, steer: 1 });
  assert.ok(first.steer < 0 && second.steer > 0);
  assert.ok(first.boostTime > 0);
  assert.equal(second.boostTime, 0);
  assert.ok(second.recharge > 7.9 && first.recharge === 0);
}

for (const collisionMode of ['arcade', 'breakaway']) {
  const race = readyRace({ collisionMode });
  const [first, second, ...bots] = race.cars;
  const station = track.turns.find(({ name }) => name === 'Kemmel Straight').s + 30;
  const gate = track.checkpoints.findIndex((s) => s > station) + 1;
  Object.assign(first, { s: station, offset: 0, speed: 26, nextGate: gate });
  Object.assign(second, { s: station + 12, offset: 0, speed: 15, nextGate: gate });

  race.step(dt, { throttle: 1 }, {});
  assert.equal(first.towRivalId, second.id);
  assert.equal(second.towRivalId, null);

  for (const bot of bots) bot.s = 45 - 20 * bot.grid;
  second.s = first.s + 3.5;
  race.step(dt, { throttle: 1 }, {});
  const hit = arrayFor(race, 'impact').find(({ aId, bId }) => aId === first.id && bId === second.id);
  assert.equal(hit?.severity, 'heavy');
  assert.ok(second.s - first.s >= 3.75);
  assert.equal(first.detachedParts.includes('frontBumper'), collisionMode === 'breakaway');
  assert.equal(second.detachedParts.includes('rearBumper'), collisionMode === 'breakaway');

  const secondPosition = second.s;
  race.step(dt, { recover: true }, { throttle: 1 });
  assert.ok(first.recovering && !second.recovering);
  assert.ok(second.s > secondPosition);
  const activeTime = race.elapsed;
  race.step(0);
  assert.equal(race.elapsed, activeTime);
  for (let i = 0; i < 180; i += 1) race.step(dt);
  assert.equal(first.recovering, false);
  assert.equal(first.nextGate, gate);
  assert.deepEqual(first.detachedParts, []);
}

function driver(car, side) {
  const here = track.sample(car.s);
  let target = 24;
  for (let look = 0; look < 55; look += 3) {
    const curvature = Math.abs(track.sample(car.s + look).curvature);
    target = Math.min(target, Math.sqrt(Math.max(100, 13 / curvature) + 12 * look));
  }
  const desiredOffset = car.s < 18 ? car.offset : side * 1.32;
  const heading = clamp((desiredOffset - car.offset) * 0.18 - 0.21 * car.heading, -0.35, 0.35);
  const steer = clamp(((heading - car.heading) * 4.3 + car.speed * here.curvature * 0.78 + car.heading * 1.7) / 1.9, -1, 1);
  const error = target - car.speed;
  return { steer, throttle: clamp(0.48 + error * 0.22, 0, 1), brake: clamp((-error - 0.7) * 0.3, 0, 1) };
}

for (const collisionMode of ['arcade', 'breakaway']) {
  const race = readyRace({ seed: 1288, collisionMode });
  const [first, second] = race.players;
  const finishes = [];
  while (race.phase === 'racing' && race.elapsed < 180) {
    const earlySecondDriver = race.elapsed < 1.5 ? {} : driver(second, 1);
    race.step(1 / 45, driver(first, -1), earlySecondDriver);
    finishes.push(...arrayFor(race, 'playerFinish'));
    if (finishes.length === 1) {
      assert.equal(race.phase, 'racing', 'The remaining player keeps driving');
    }
  }
  assert.equal(race.phase, 'finished');
  assert.deepEqual(finishes.map(({ playerId }) => playerId), [first.id, second.id]);
  assert.deepEqual(race.players.map(({ completedLaps }) => completedLaps), [2, 2]);
  assert.ok(race.players.every(({ bestLap }) => bestLap > 50 && bestLap < 90));
  assert.deepEqual(finishes.map(({ position }) => position), race.players.map(({ finishPosition }) => finishPosition));
  assert.ok(race.standings().indexOf(first) < race.standings().indexOf(second));
  const finishTime = race.elapsed;
  race.step(1 / 30, { throttle: 1 }, { throttle: 1, recover: true });
  assert.equal(race.elapsed, finishTime);
  assert.deepEqual(arrayFor(race, 'playerFinish'), []);
  console.log(collisionMode, 'P1', first.finishTime.toFixed(3), 'P2', second.finishTime.toFixed(3));
}

{
  const race = readyRace();
  const finishGate = 2 * (track.checkpoints.length + 1);
  const finishLine = track.length * 2;
  race.elapsed = 130;
  for (const [i, player] of race.players.entries()) {
    Object.assign(player, {
      s: finishLine - (i === 0 ? 0.10 : 0.05),
      offset: i === 0 ? -2 : 2,
      speed: 20,
      lap: 2,
      completedLaps: 1,
      nextGate: finishGate,
      lapStart: 65,
    });
  }
  race.step(dt, { throttle: 1 }, { throttle: 1 });
  assert.equal(race.phase, 'finished');
  assert.deepEqual(arrayFor(race, 'playerFinish').map(({ playerId, position }) => [playerId, position]),
    [['player-2', 1], ['player', 2]], 'Interpolate closely spaced finishes within the same tick');
}

console.log('Local two-player simulation checks passed.');
