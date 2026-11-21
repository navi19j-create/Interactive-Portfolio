import assert from 'node:assert/strict';
import { track } from '../src/jeep/track.js';
import { createRace as createSimulation, racingLine } from '../src/jeep/simulation.js';
const kemmelStart = track.turns.find(({ name }) => name === 'Kemmel Straight').s;
const collisionMode = process.argv.includes('--arcade') ? 'arcade' : 'breakaway';
const createRace = (options) => createSimulation({ collisionMode, ...options });
const boostIsReady = ({ boostTime, recharge, boostHeld, passing }) =>
  boostTime === 0 && recharge === 0 && !boostHeld && passing === null;

const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

function steering(car, desiredOffset, offsetGain = 0.2, headingDamping = 0) {
  const heading = (desiredOffset - car.offset) * offsetGain - headingDamping * car.heading;
  const curvature = track.sample(car.s).curvature;
  return clamp((4.3 * (heading - car.heading) + 1.7 * car.heading + car.speed * curvature * 0.78) / 1.9, -1, 1);
}

function cornerPace(s) {
  let target = 24;
  for (let look = 0; look < 55; look += 3) {
    const curvature = Math.abs(track.sample(s + look).curvature);
    target = Math.min(target, Math.sqrt(Math.max(95, 13 / curvature) + 12 * look));
  }
  return target;
}

function startedRace(options) {
  const race = createRace(options);
  while (race.phase === 'countdown') race.step(1 / 60);
  return race;
}

{
  let centerCurvatureCost = 0;
  let lineCurvatureCost = 0;
  const bodyClearance = 1.03;
  for (let s = 0; s < track.length; s += 1) {
    const here = racingLine.sample(s);
    const next = racingLine.sample(s + 1);
    assert.ok(Math.abs(here.offset) + bodyClearance < track.width / 2);
    assert.ok(Math.abs(here.offset - next.offset) < 0.5, 'Optimized line changes position smoothly');
    centerCurvatureCost += Math.abs(track.sample(s).curvature) ** 1.75;
    lineCurvatureCost += here.curvature ** 1.75;
  }
  assert.deepEqual(racingLine.sample(0), racingLine.sample(track.length));
  assert.ok(lineCurvatureCost < centerCurvatureCost * 0.9, 'Open up tight curves along the optimized line');
}

{
  const race = createRace();
  const startingPosition = race.player.s;
  const lights = new Set([race.startLights]);
  const startEvents = [];
  while (race.phase === 'countdown') {
    const last = race.startLights;
    race.step(0, { throttle: 1, boost: true });
    assert.equal(race.startLights, last);
    race.step(1 / 120, { throttle: 1, boost: true });
    startEvents.push(...race.events);
    if (race.phase === 'countdown') {
      lights.add(race.startLights);
      assert.equal(race.player.s, startingPosition);
      assert.equal(race.player.boostTime, 0);
      assert.ok(race.cars.slice(1).every(boostIsReady));
      assert.equal(race.elapsed, 0);
    }
  }
  assert.deepEqual([...lights], [1, 2, 3, 4, 5]);
  assert.equal(race.startLights, 0);
  assert.deepEqual(startEvents, [{ type: 'raceStart', time: 0 }]);
  race.step(1 / 60, { throttle: 1 });
  assert.deepEqual(race.events, []);
  assert.ok(race.player.speed > 0);
  assert.equal(createRace().startLights, 1);
}

const results = [];
for (let i = 0; i < 10; i += 1) {
  const race = startedRace({ seed: i * 98421 + 1, playerGrid: i % 4 });
  let closeSamples = 0;
  let samples = 0;
  let lapTwoEntry = null;
  let lapTwoMidpoint = null;
  let nearest = Infinity;
  const finishEvents = [];
  const botBoostLaps = new Set();
  const lastBoost = new Map();
  while (race.phase !== 'finished' && race.elapsed < 200) {
    const car = race.player;
    nearest = Math.min(...race.cars.slice(1).map((rival) => Math.abs(rival.s - car.s)));
    closeSamples += Number(nearest <= 25);
    samples += 1;
    if (car.completedLaps === 1) {
      lapTwoEntry ??= nearest;
      if (car.s >= track.length * 1.5) lapTwoMidpoint ??= nearest;
    }
    const target = cornerPace(car.s);
    const error = target - car.speed;
    race.step(1 / 45, {
      steer: steering(car, car.s < 18 ? car.offset : 0),
      throttle: clamp(0.48 + error * 0.22, 0, 1),
      brake: clamp((-error - 0.7) * 0.3, 0, 1),
      boost: Math.abs(track.sample(car.s).curvature) < 0.003 && target > 22 && car.speed > 19 && car.recharge === 0,
    });
    assert.ok(race.cars.slice(1).every((bot) => bot.finishTime !== null ||
      (Math.abs(bot.offset) + 1.03 < track.width / 2 && !bot.recovering && !bot.wallTime)));
    for (const bot of race.cars.slice(1)) {
      if (bot.boostTime === 0) continue;
      botBoostLaps.add(bot.lap);
      const last = lastBoost.get(bot.id);
      if (last && bot.boostTime > last.remaining) {
        assert.ok(race.elapsed - last.time >= 8 - 1 / 45, 'Bot waits through the shared recharge');
      }
      lastBoost.set(bot.id, { time: race.elapsed, remaining: bot.boostTime });
    }
    finishEvents.push(...race.events.filter(({ type }) => type === 'playerFinish'));
  }
  assert.equal(race.player.completedLaps, 2);
  assert.deepEqual(botBoostLaps, new Set([1, 2]), 'Bots deploy boost on both laps from varied grids');
  assert.ok(race.player.bestLap >= 45 && race.player.bestLap <= 90);
  assert.ok(race.player.lastLap >= 45 && race.player.lastLap <= 90);
  assert.ok(race.cars.every((car) => car.bestLap >= 45 && car.bestLap <= 90));
  assert.equal(race.standings()[race.player.finishPosition - 1], race.player);
  assert.deepEqual(finishEvents, [{ type: 'playerFinish', time: race.player.finishTime, position: race.player.finishPosition }]);
  race.step(1 / 45);
  assert.deepEqual(race.events, []);
  assert.ok(race.cars.every((car) => car.s > track.length * 1.8 && !car.recovering));
  results.push({
    grid: i % 4 + 1,
    finish: race.player.finishPosition,
    seconds: race.elapsed.toFixed(2),
    bestLap: race.player.bestLap.toFixed(2),
    nearestWithin25m: (100 * closeSamples / samples).toFixed(1) + '%',
    lapTwoGapMetres: [lapTwoEntry, lapTwoMidpoint, nearest].map((gap) => gap.toFixed(1)).join(' / '),
  });
}

// At least 7 m between centers leaves 3.25 m beyond the nominal bumpers.
const brakingBoard = track.brakingBoards.find(({ corner, label }) => corner === 'Les Combes' && label === 50);
const clearCenterGap = 7;
const nominalCarLength = 3.75;

function centerGapAtBoard(playerBefore, rivalBefore, player, rival) {
  const fraction = (brakingBoard.s - playerBefore) / (player.s - playerBefore);
  return rivalBefore + fraction * (rival.s - rivalBefore) - brakingBoard.s;
}

function kemmel(mode, side = 1) {
  const race = startedRace();
  const { player } = race;
  const [lead, far1, far2] = race.cars.slice(1);
  race.elapsed = 10;
  const passEvents = [];
  const pullFrame = mode === 'late' ? 140 : 95;
  const boostFrame = mode === 'late' ? 215 : 125;
  const attemptsPass = mode === 'boost' || mode === 'late';
  Object.assign(player, { s: kemmelStart, offset: 0, speed: 26, nextGate: 3 });
  Object.assign(lead, { s: kemmelStart + 8 + (mode === 'clear' ? 400 : 0), offset: 0, speed: 21 });
  far1.s = 40;
  far2.s = 10;
  let bestWake = 0;
  let split = 0;
  let clearAt = null;
  let acquiredSource = null;
  let leadCenterGapAtBoard = null;
  let rivalBoosted = false;
  for (let i = 0; player.s < brakingBoard.s && i < 550; i += 1) {
    const target = mode === 'clear' ? 0 : attemptsPass && i >= pullFrame ? side * 3.45 : lead.offset;
    const playerBefore = player.s;
    const leadBefore = lead.s;
    race.step(1 / 60, {
      throttle: 1,
      steer: steering(player, target, 0.18, 0.25),
      boost: attemptsPass && i === boostFrame,
    });
    passEvents.push(...race.events.filter(({ type }) => type === 'pass'));
    rivalBoosted ||= lead.boostTime > 0;
    if (i === 94) split = player.s;
    if (player.wake > 0.6) {
      assert.equal(player.towRivalId, lead.id);
      acquiredSource = player.towRivalId;
    }
    bestWake = Math.max(bestWake, player.wake);
    if (acquiredSource && player.s >= lead.s + clearCenterGap && Math.abs(player.offset - lead.offset) >= 2.24) {
      clearAt ??= player.s;
      assert.equal(player.towRivalId, null);
    }
    if (mode !== 'clear' && player.s >= brakingBoard.s) {
      leadCenterGapAtBoard = centerGapAtBoard(playerBefore, leadBefore, player, lead);
    }
  }
  assert.ok(player.s >= brakingBoard.s);
  const speedAtCue = player.speed;
  race.step(1 / 60, { brake: 1 });
  assert.ok(player.speed < speedAtCue, 'Brake at the Les Combes approach');
  return {
    split,
    bestWake,
    leadCenterGapAtBoard,
    bumperClearanceAtBoard: leadCenterGapAtBoard < 0 ? -leadCenterGapAtBoard - nominalCarLength : null,
    clearAtCourseMetres: clearAt,
    finalWake: player.wake,
    acquiredSource, rivalBoosted, passEvents,
  };
}

const clear = kemmel('clear');
const draft = kemmel('draft');
const inside = kemmel('boost');
const outside = kemmel('boost', -1);
const late = kemmel('late');
const lateOutside = kemmel('late', -1);
assert.equal(clear.bestWake, 0);
assert.ok(draft.bestWake > 0.6);
assert.ok(draft.split > clear.split + 1);
assert.ok(draft.leadCenterGapAtBoard > 0, 'Draft alone leaves the player behind the same rival');
for (const pass of [inside, outside]) {
  assert.equal(pass.acquiredSource, 'bot-1');
  assert.ok(pass.rivalBoosted, 'The passed rival uses its own available boost');
  assert.ok(pass.clearAtCourseMetres && pass.clearAtCourseMetres < brakingBoard.s,
    'Clear the drafted rival on the straight before the actual 50 board');
  assert.ok(pass.leadCenterGapAtBoard <= -clearCenterGap, 'Reach the 50 board fully clear of the same rival');
  assert.ok(pass.finalWake < 0.03);
  assert.equal(pass.passEvents.length, 1);
  assert.equal(pass.passEvents[0].passerId, 'player');
  assert.equal(pass.passEvents[0].passedId, 'bot-1');
}
for (const pass of [late, lateOutside]) {
  assert.equal(pass.acquiredSource, 'bot-1');
  assert.equal(pass.clearAtCourseMetres, null, 'Delayed power leaves too little straight to clear');
  assert.equal(pass.passEvents.length, 0);
}
console.table({ clear, draft, inside, outside, late, lateOutside });

{
  const race = startedRace();
  const [player, rival, distant1, distant2] = race.cars;
  distant1.s = 65;
  distant2.s = 30;
  function sampleOrder(s, rivalLead, clearance) {
    Object.assign(player, { s, offset: 0, speed: 22 });
    Object.assign(rival, { s: s + rivalLead, offset: clearance, speed: 22 });
    race.step(1 / 120, { throttle: 0.25 });
    return race.events.filter(({ type }) => type === 'pass');
  }
  // Identical crossing samples at launch and at race speed.
  assert.deepEqual([8, 0, -8].flatMap((gap) => sampleOrder(25, gap, 3)), []);
  race.elapsed = 10;
  assert.deepEqual([8, 0, -8].flatMap((gap) => sampleOrder(330, gap, 0.4)), []);
  assert.deepEqual([8, 0, -8].flatMap((gap) => sampleOrder(330, gap, 3)).map(({ passerId, passedId }) =>
    [passerId, passedId]), [['player', rival.id]]);
  assert.deepEqual([0, 8].flatMap((gap) => sampleOrder(330, gap, 3)), []);
  race.elapsed += 2.5;
  const lapSeam = track.length;
  assert.deepEqual(sampleOrder(lapSeam - 4, 8, 3), [], 'A lap seam does not reorder car distance');
  assert.deepEqual(sampleOrder(lapSeam + 4, 8, 3), []);

  Object.assign(player, { s: 360, offset: 0, speed: 22, nextGate: 3 });
  rival.s = 352;
  assert.deepEqual(sampleOrder(360, -8, 3), []);
  race.step(1 / 120, { recover: true });
  for (let i = 0; i < 130; i += 1) {
    race.step(1 / 120);
    assert.deepEqual(race.events.filter(({ type }) => type === 'pass'), [], 'Recovery cannot count as a pass');
  }
}

{
  const race = startedRace();
  const [player, first, second, outer] = race.cars;
  Object.assign(player, { s: kemmelStart + 24, offset: 0, speed: 24 });
  Object.assign(first, { s: kemmelStart + 40, offset: 0.4, speed: 22 });
  Object.assign(second, { s: kemmelStart + 36, offset: 0.48, speed: 23 });
  Object.assign(outer, { s: kemmelStart + 34, offset: -3, speed: 24 });
  race.step(1 / 120, { throttle: 1 });
  assert.equal(player.towRivalId, first.id);
  assert.ok(Math.abs(player.towGap - 16) < 0.02);
  assert.ok(Math.abs(player.towClosingSpeed - 2) < 0.05);
  assert.ok(Math.abs(player.towOffset - 0.4) < 0.02);
  second.offset = 0.35;
  race.step(1 / 120, { throttle: 1 });
  assert.equal(player.towRivalId, first.id, 'An almost equal wake should retain its supplier');
  second.offset = 0;
  race.step(1 / 120, { throttle: 1 });
  assert.equal(player.towRivalId, second.id, 'A materially stronger wake should take over');
  first.offset = 3;
  second.s = player.s;
  race.step(1 / 120, { throttle: 1 });
  assert.deepEqual([player.towRivalId, player.towGap, player.towClosingSpeed, player.towOffset],
    [null, null, null, null], 'A car alongside or out of the wake must not supply tow');
}

{
  const race = startedRace();
  const [lead, passer, leftTraffic, rightTraffic] = race.cars;
  Object.assign(lead, { s: kemmelStart + 34, offset: 0, speed: 20 });
  Object.assign(passer, { s: kemmelStart + 26, offset: 0, speed: 24 });
  Object.assign(leftTraffic, { s: kemmelStart + 32, offset: -2.6, speed: 20 });
  Object.assign(rightTraffic, { s: kemmelStart + 32, offset: 2.6, speed: 20 });
  race.step(1 / 120);
  assert.equal(passer.passing, null, 'Two occupied lanes prevent an overtake');
  assert.ok(boostIsReady(passer), 'Blocked bot saves its charge');
  assert.ok(passer.speed < 24, 'Blocked bot lifts behind slower traffic');
  leftTraffic.s = 30;
  race.step(1 / 120);
  assert.deepEqual(passer.passing, { rivalId: lead.id, lane: -2.35 });
  let cleared = false;
  for (let step = 0; step < 550; step += 1) {
    const gap = lead.s - passer.s;
    if (gap < -7) {
      cleared = true;
      break;
    }
    assert.deepEqual(passer.passing, { rivalId: lead.id, lane: -2.35 });
    const error = 20 - lead.speed;
    race.step(1 / 60, {
      throttle: clamp(0.23 + error * 0.45, 0, 1),
      steer: steering(lead, 0),
    });
  }
  assert.ok(cleared, 'Bot maintains its chosen lane until fully clear');
  race.step(1 / 120);
  assert.notEqual(passer.passing?.rivalId, lead.id);
}

function adjacentBotAttack({ recharge = 0, s = kemmelStart + 24, lap = 1, passing = null } = {}) {
  const race = startedRace();
  const [lead, bot, distant1, distant2] = race.cars;
  const lapDistance = (lap - 1) * track.length;
  const nextGateAt = (distance) => (lap - 1) * (1 + track.checkpoints.length) +
    1 + track.checkpoints.findIndex((gate) => gate > distance);
  race.elapsed = lap === 1 ? 10 : 70;
  Object.assign(lead, { s: s + 9 + lapDistance, speed: 24, offset: 2.35, lap, completedLaps: lap - 1,
    nextGate: nextGateAt(s + 9) });
  Object.assign(bot, { s: s + lapDistance, speed: 25, offset: -2.35, recharge, passing, lap, completedLaps: lap - 1,
    nextGate: nextGateAt(s) });
  distant1.s = 50;
  distant2.s = 20;
  return { race, lead, bot };
}

for (const options of [{ lap: 1 }, { lap: 2 }, { recharge: 8 }]) {
  const { race, lead, bot } = adjacentBotAttack(options);
  let activeTicks = 0;
  let cleanPasses = 0;
  for (let i = 0; i < 360; i += 1) {
    race.step(1 / 120, {
      throttle: clamp(0.26 + (24 - lead.speed) * 0.45, 0, 1),
      steer: steering(lead, 2.35, 0.22, 0.25),
    });
    if (i === 0 && !options.recharge) {
      assert.equal(bot.boostTime, 2, 'Bot starts the shared burst with a clear adjacent lane');
      assert.deepEqual(bot.passing, { rivalId: lead.id, lane: -2.35 });
      assert.ok(createRace().cars.slice(1).every(boostIsReady), 'A new race starts with fresh bot charge');
    }
    activeTicks += Number(bot.boostTime > 0);
    for (const event of race.events) {
      assert.ok(event.type !== 'impact' || ![event.aId, event.bId].includes(bot.id));
      if (event.type === 'pass' && event.passerId === bot.id && event.passedId === lead.id) cleanPasses += 1;
    }
  }
  if (!options.recharge) {
    assert.equal(cleanPasses, 1);
    assert.ok(bot.s - lead.s >= clearCenterGap);
    assert.ok(activeTicks === 240 || activeTicks === 241);
  } else {
    assert.equal(activeTicks, 0);
    assert.equal(cleanPasses, 0);
    assert.ok(bot.s < lead.s, 'The same attack without charge cannot clear the rival');
  }
}

{
  const { race, bot } = adjacentBotAttack({
    s: brakingBoard.s + 1,
    passing: { rivalId: 'player', lane: -2.35 },
  });
  race.step(1 / 120, { throttle: 0.26 });
  assert.equal(bot.boostTime, 0, 'Bot preserves the charge as it approaches the braking zone');
  assert.equal(bot.recharge, 0);
}

{
  const race = startedRace();
  const [lead, passer, intruder, distant] = race.cars;
  Object.assign(lead, { s: kemmelStart + 34, offset: 0, speed: 19 });
  Object.assign(passer, { s: kemmelStart + 26, offset: 0, speed: 24 });
  intruder.s = 30;
  distant.s = 10;
  race.step(1 / 120);
  const decision = { rivalId: lead.id, lane: 2.35 };
  assert.deepEqual(passer.passing, decision);
  Object.assign(intruder, { s: kemmelStart + 37, offset: 2.35, speed: 20 });
  for (let i = 0; i < 24; i += 1) race.step(1 / 120, { throttle: 0.18 });
  assert.deepEqual(passer.passing, decision, 'An occupied target lane does not trigger an abrupt switch');
  assert.ok(passer.speed < 24 && Math.abs(passer.offset) < 0.4, 'Lift instead of moving into the occupied lane');
}

{
  const race = startedRace();
  const [follower, lead, third, fourth] = race.cars;
  Object.assign(follower, { s: kemmelStart + 29, offset: 0.1, speed: 24 });
  Object.assign(lead, { s: kemmelStart + 32, offset: 0, speed: 16 });
  third.s = 30;
  fourth.s = 12;
  race.step(1 / 120, { throttle: 1 });
  assert.ok(follower.speed < 24 && follower.speed > 0);
  assert.ok(lead.s - follower.s >= 3.75, 'Separate the overlapping bumpers');
  assert.equal(follower.towRivalId, null, 'Physical contact is outside the wake window');
}

{
  const race = startedRace();
  const { player } = race;
  Object.assign(player, { s: kemmelStart + 24, speed: 23, offset: 0 });
  race.step(1 / 60, { throttle: 1, boost: true });
  assert.ok(player.boostTime > 1.9 && player.wake < 0.01);
  const prior = race.elapsed;
  race.step(0, { throttle: 1 });
  assert.equal(race.elapsed, prior);
  race.step(1 / 60, { brake: 1 });
  assert.equal(player.boostTime, 0);
  assert.ok(player.recharge > 7.9);
  race.step(1 / 60, { throttle: 1, boost: true });
  assert.equal(player.boostTime, 0);
}

{
  const race = startedRace();
  const { player } = race;
  Object.assign(player, { s: 0.3, speed: 0, nextGate: 1, offset: 0 });
  for (let i = 0; i < 90; i += 1) race.step(1 / 60, { brake: 1 });
  assert.ok(player.s < 0);
  assert.equal(player.completedLaps, 0, 'Reverse across the line must not count as a lap');
  Object.assign(player, { s: track.length - 0.3, speed: 12, nextGate: 4, offset: 0 });
  for (let i = 0; i < 30; i += 1) race.step(1 / 60, { throttle: 1 });
  assert.ok(player.s > track.length);
  assert.equal(player.completedLaps, 0, 'Missing ordered gates must prevent a lap');
  race.step(1 / 60, { recover: true });
  assert.ok(player.recovering);
  for (let i = 0; i < 90; i += 1) race.step(1 / 60);
  assert.equal(player.s, track.checkpoints[2]);
  assert.equal(player.nextGate, 4);
  assert.equal(player.completedLaps, 0);
}

{
  const race = startedRace();
  const [player, center, left, right] = race.cars;
  const lastGate = track.checkpoints[0];
  Object.assign(player, { s: lastGate + 45, speed: 16, nextGate: 2 });
  for (const [rival, lane] of [[center, 0], [left, -2.35], [right, 2.35]]) {
    Object.assign(rival, { s: lastGate, offset: lane, speed: 0, finishTime: 1 });
  }
  const startTime = race.elapsed;
  race.step(1 / 120, { recover: true });
  for (let i = 0; i < 120; i += 1) race.step(1 / 120);
  assert.ok(player.recovering && player.s > lastGate, 'All lanes blocked, wait for a safe rejoin');
  for (const rival of race.cars.slice(1)) rival.s += 35;
  race.step(1 / 120);
  assert.ok(!player.recovering);
  assert.equal(player.s, lastGate);
  assert.equal(player.nextGate, 2);
  assert.ok(race.elapsed - startTime >= 1);
}

console.table(results);
console.log('Race simulation checks passed.');






