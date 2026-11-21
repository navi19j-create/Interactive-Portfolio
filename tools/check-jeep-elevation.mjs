import assert from 'node:assert/strict';
import { track } from '../src/jeep/track.js';
import { createRace } from '../src/jeep/simulation.js';

const turn = name => track.turns.find(marker => marker.name === name).s;
const laSource = turn('La Source');
const eauRouge = turn('Eau Rouge');
const kemmel = turn('Kemmel Straight');
const height = s => track.sample(s).y;
const grade = s => (height(s + 0.85) - height(s - 0.85)) / 1.7;
const pitch = s => Math.atan(grade(s)) * 180 / Math.PI;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const drop = height(laSource) - height(eauRouge);
assert.ok(drop >= 20 && drop <= 24, `Expected a 20–24 m descent, measured ${drop.toFixed(2)} m`);

let peakPitchRate = 0;
let peakClimbGrade = 0;
for (let s = laSource + 2; s <= kemmel; s += 0.25) {
  const pitchChange = pitch(s + 0.85) - pitch(s - 0.85);
  peakPitchRate = Math.max(peakPitchRate, Math.abs(pitchChange) * 26.57 / 1.7);
  if (s >= eauRouge - 47 && s < eauRouge) {
    assert.ok(pitchChange >= -0.01, `Second dive in the Eau Rouge compression at ${s.toFixed(2)} m`);
  }
  if (s >= eauRouge) peakClimbGrade = Math.max(peakClimbGrade, grade(s));
}
assert.ok(peakPitchRate < 18, `Abrupt pitch change of ${peakPitchRate.toFixed(2)}°/s`);
assert.ok(peakClimbGrade >= 0.15 && peakClimbGrade <= 0.19, 'Keep the Raidillon grade near 18%');
assert.ok(grade(kemmel) < 0.10, 'Ease the climb onto Kemmel');

const race = createRace({ playerGrid: 0 });
const dt = 1 / 120;
while (race.phase === 'countdown') race.step(dt);
const { player } = race;
for (const [i, rival] of race.cars.slice(1).entries()) {
  Object.assign(rival, { s: track.length * 0.55 + i * 20, offset: 0, finishTime: 0, finishPosition: i + 2 });
}
Object.assign(player, { s: laSource + 20, speed: 16, offset: 0 });

let minClearance = Infinity;
let minValleySpeed = Infinity;
let maxSteer = 0;
for (let i = 0; i < 2400 && player.s < kemmel + 20; i += 1) {
  const { curvature } = track.sample(player.s + player.speed * 0.125);
  const targetHeading = clamp(-0.2 * player.offset - 0.22 * player.heading, -0.48, 0.48);
  const turnRate = (targetHeading - player.heading) * 4.3 + player.heading * 1.7;
  const steer = clamp((turnRate + player.speed * curvature * 0.78) / 1.9, -1, 1);
  maxSteer = Math.max(maxSteer, Math.abs(steer));
  race.step(dt, { steer, throttle: 1, brake: 0, boost: false });
  minClearance = Math.min(minClearance, track.width / 2 - 1.03 - Math.abs(player.offset));
  if (player.s >= eauRouge) minValleySpeed = Math.min(minValleySpeed, player.speed);
  assert.equal(player.wallTime, 0);
  assert.equal(player.wake, 0);
  assert.equal(player.recovering, false);
}
assert.ok(player.s >= kemmel + 20 && minValleySpeed >= 26.5, 'Reach Kemmel at full speed');
assert.ok(minClearance > 2, 'Keep the Jeep body clear of the road edge');
assert.ok(maxSteer < 0.85, 'Leave steering range for player corrections');

console.log(`Eau Rouge drop ${drop.toFixed(2)} m, peak Raidillon grade ${(100 * peakClimbGrade).toFixed(1)}%, peak pitch rate ${peakPitchRate.toFixed(1)}°/s.`);
console.log(`Full throttle to Kemmel at ${minValleySpeed.toFixed(2)} m/s with ${minClearance.toFixed(2)} m body clearance and ${(maxSteer * 100).toFixed(0)}% peak steering.`);
