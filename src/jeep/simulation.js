import { track } from './track.js';
import { planRacingLine } from './racing-line.js';

const stepSize = 1 / 120;
const startDuration = 5.65;
const finishProgress = track.length * 2;
const laps = 2;
const carHalfWidth = 1.03;
const collisionLength = 3.75;
const roadEdge = track.width / 2;
const barrier = roadEdge + 2.8;
const carWidth = carHalfWidth * 2;
const impactSpeedFloor = 1.15;
const collisionModes = new Set(['breakaway', 'arcade']);
const shiftLane = 2.35;
const laneClearance = 2.24;
const passClear = 7;
const baseSpeed = 24;
const overtakeSeconds = 2;
const rechargeSeconds = 8;
const gateDistances = [0, ...track.checkpoints];
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const smooth = (from, to, speed, dt) => to + (from - to) * Math.exp(-speed * dt);
const wrap = (distance) => ((distance % track.length) + track.length) % track.length;
const gapTo = (back, front) => wrap(front.s - back.s);
function nearbyGap(car, rival) {
  const gap = gapTo(car, rival);
  return gap > track.length / 2 ? gap - track.length : gap;
}
const gateDistance = (index) =>
  Math.floor(index / gateDistances.length) * track.length +
  gateDistances[index % gateDistances.length];

function startingCar(id, grid, temperament) {
  const s = -5 - grid * 7;
  return {
    id, s, grid, temperament,
    offset: (grid % 2 === 0 ? -1 : 1) * shiftLane,
    heading: 0, speed: 0, steer: 0, lean: 0, distance: 0,
    wake: 0, towRivalId: null, towGap: null, towClosingSpeed: null, towOffset: null,
    boostTime: 0, recharge: 0, boostHeld: false, passing: null,
    brakeHold: 0, wallTime: 0, impactSlide: 0, impactYaw: 0,
    detachedParts: [], wheelRecovery: 0, wallSide: null, wallImpactAt: -Infinity,
    lap: 1, completedLaps: 0, nextGate: 0, lapStart: 0,
    lastLap: null, bestLap: null, finishTime: null, finishPosition: null,
    recovering: false, recoverTime: 0, recoverHeld: false,
  };
}

function clearTow(car) {
  car.towRivalId = null;
  car.towGap = null;
  car.towClosingSpeed = null;
  car.towOffset = null;
}

function updateTow(car, cars) {
  if (car.recovering || car.finishTime !== null || car.speed < 11 ||
    Math.abs(car.heading) > 0.5 || Math.abs(car.offset) > roadEdge) {
    clearTow(car);
    return 0;
  }
  let supplier = null;
  let strongest = 0;
  let current = null;
  let currentStrength = 0;
  for (const rival of cars) {
    if (rival === car || rival.recovering || rival.finishTime !== null || rival.speed < 9 ||
      Math.abs(rival.offset) > roadEdge || Math.abs(rival.heading) > 0.5) continue;
    const ahead = gapTo(car, rival);
    if (ahead <= collisionLength || ahead >= 34) continue;
    const lateral = Math.abs(car.offset - rival.offset);
    const alignment = clamp(1 - lateral / 2, 0, 1);
    const spacing = clamp((ahead - collisionLength) / 4, 0, 1) * clamp((34 - ahead) / 17, 0, 1);
    const strength = alignment * spacing;
    if (strength > strongest) {
      strongest = strength;
      supplier = rival;
    }
    if (rival.id === car.towRivalId && strength > 0) {
      current = rival;
      currentStrength = strength;
    }
  }
  // Hold the current supplier through ties so the gap and marker stay stable.
  if (current && strongest < currentStrength + 0.10) {
    supplier = current;
    strongest = currentStrength;
  }
  car.towRivalId = supplier?.id ?? null;
  car.towGap = supplier ? gapTo(car, supplier) : null;
  car.towClosingSpeed = supplier ? car.speed - supplier.speed : null;
  car.towOffset = supplier ? supplier.offset - car.offset : null;
  return strongest;
}

export const racingLine = planRacingLine(track);
const paceSpacing = 3;
const paceMap = Array.from({ length: Math.ceil(track.length / paceSpacing) }, (_, i) => {
  const s = i * paceSpacing;
  const { curvature, stretch } = racingLine.sample(s);
  return { line: curvature, center: Math.abs(track.sample(s).curvature), stretch };
});

function botInput(bot, cars) {
  const here = track.sample(bot.s);
  const line = racingLine.sample(bot.s);
  const upcomingLine = racingLine.sample(bot.s + 21);
  const onStraight = Math.max(line.curvature, upcomingLine.curvature) < 0.014;
  const boostAvailable = bot.recharge === 0 && bot.boostTime === 0 && !bot.recovering && bot.wheelRecovery === 0;
  // Fixed driving pace. Opponents use the available power on open road and
  // roll back to a braking target on approach, independent of player rank.
  let targetSpeed = 26.35 + bot.temperament * 0.6 + bot.wake * 2.8;
  let desiredOffset = line.offset;
  if (bot.s < 33) desiredOffset = bot.grid % 2 === 0 ? -shiftLane : shiftLane;

  let passRival = bot.passing ? cars.find((rival) => rival.id === bot.passing.rivalId) : null;
  if (passRival) {
    const gap = nearbyGap(bot, passRival);
    if (gap < -passClear || gap > 36 || passRival.recovering || passRival.finishTime !== null) {
      bot.passing = null;
      passRival = null;
    }
  }

  let nearest = null;
  let distance = 25;
  let nearestPriority = Infinity;
  for (const rival of cars) {
    if (rival === bot || rival.recovering || rival.finishTime !== null) continue;
    const separation = Math.abs(rival.offset - bot.offset);
    // A charged car can also attack from the adjacent lane without cutting across.
    if (separation > 2.5 && (!boostAvailable || separation > shiftLane * 2 + 0.5)) continue;
    const gap = gapTo(bot, rival);
    // Give traffic in the bot's current lane priority over a side-by-side attack.
    const priority = gap + (separation > 2.5 ? passClear : 0);
    if (gap < 25 && priority < nearestPriority) {
      distance = gap;
      nearest = rival;
      nearestPriority = priority;
    }
  }

  function laneIsFree(lane, aheadLimit) {
    return !cars.some((rival) => {
      if (rival === bot || rival.recovering) return false;
      const gap = nearbyGap(bot, rival);
      const projectedGap = gap + (rival.speed - bot.speed) * 0.65;
      return Math.max(gap, projectedGap) > -7 && Math.min(gap, projectedGap) < aheadLimit &&
        Math.abs(rival.offset - lane) < laneClearance;
    });
  }

  if (!bot.passing && nearest && bot.s >= 9 && onStraight && distance > 5 &&
    (nearest.speed < targetSpeed + 0.3 || bot.boostTime > 0 || boostAvailable)) {
    const first = nearest.offset > 0 ? -shiftLane : shiftLane;
    for (const lane of [first, -first]) {
      if (laneIsFree(lane, distance + 5)) {
        bot.passing = { rivalId: nearest.id, lane };
        passRival = nearest;
        break;
      }
    }
  }

  let readyToPass = false;
  let passGap = Infinity;
  if (passRival) {
    const { lane } = bot.passing;
    passGap = nearbyGap(bot, passRival);
    const inLane = Math.abs(bot.offset - lane) < 0.95;
    const available = laneIsFree(lane, Math.max(12, passGap + 2));
    // Keep the chosen side through overlap. If a car enters the lane while
    // we are still moving out, lift and wait without switching across traffic.
    desiredOffset = available || inLane || passGap < collisionLength ? lane : bot.offset;
    readyToPass = available && Math.abs(bot.offset - passRival.offset) >= laneClearance;
    if (readyToPass && onStraight) targetSpeed += 5;
  } else if (cars.some((rival) => {
    if (rival === bot || rival.recovering) return false;
    const gap = nearbyGap(bot, rival);
    return gap > -passClear && gap < 6 && Math.abs(rival.offset - bot.offset) > carHalfWidth * 2;
  })) {
    desiredOffset = clamp(bot.offset, -shiftLane, shiftLane);
  }

  if (bot.boostTime > 0 && !(readyToPass && onStraight)) targetSpeed += 6.8;
  let nearestAhead = Infinity;
  for (const rival of cars) {
    if (rival === bot || rival.recovering) continue;
    const gap = nearbyGap(bot, rival);
    const lateral = rival.offset - bot.offset;
    const approach = desiredOffset - bot.offset;
    if (Math.abs(gap) < passClear && lateral * approach > 0 &&
      Math.abs(lateral) - Math.abs(approach) < laneClearance) {
      // Leave overlapping cars a lane even if they arrive after our choice.
      desiredOffset = bot.offset;
      readyToPass = false;
    }
    if (gap > 0) nearestAhead = Math.min(nearestAhead, gap);
    if (gap < 0 || gap > 20) continue;
    const predictedOffset = bot.offset + (desiredOffset - bot.offset) * clamp(gap / 35, 0, 0.75);
    if (Math.abs(rival.offset - predictedOffset) < laneClearance) {
      const followingLimit = Math.max(0, rival.speed) + (gap - 7) * 0.62;
      targetSpeed = Math.min(targetSpeed, Math.max(0, followingLimit));
    }
  }

  const lineBlend = clamp(1 - Math.abs(desiredOffset - line.offset) / 2.3, 0, 1);
  let bendPaceSquared = Infinity;
  let boostPaceSquared = Infinity;
  let distanceAlongLine = 0;
  const boostRunway = Math.min(34, bot.speed * 1.1);
  const braking = 6.8 + bot.temperament * 0.8;
  for (let distanceAhead = 0; distanceAhead <= 66; distanceAhead += paceSpacing) {
    const index = Math.floor(wrap(bot.s + distanceAhead) / paceSpacing);
    const planned = paceMap[index];
    // A car staying in traffic has less room to open the radius.
    const corner = planned.line + (Math.max(planned.center, planned.line) - planned.line) * (1 - lineBlend);
    const cornerSpeedSquared = Math.max(107, (15.15 + bot.temperament * 0.95) / Math.max(0.001, corner));
    bendPaceSquared = Math.min(bendPaceSquared, cornerSpeedSquared + 2 * braking * distanceAlongLine);
    // Reserve room to brake after the initial acceleration of the burst.
    if (boostAvailable && distanceAlongLine >= boostRunway - paceSpacing) {
      boostPaceSquared = Math.min(boostPaceSquared,
        cornerSpeedSquared + 2 * braking * Math.max(0, distanceAlongLine - boostRunway));
    }
    distanceAlongLine += paceSpacing * (1 + (planned.stretch - 1) * lineBlend);
  }
  const bendPace = Math.sqrt(bendPaceSquared);
  targetSpeed = Math.min(targetSpeed, bendPace);

  // Track-relative feedback uses the same steering and grip as the player.
  const targetHeading = clamp(
    line.relativeHeading * lineBlend * 1.12 + (desiredOffset - bot.offset) * 0.20 - bot.heading * 0.22,
    -0.48, 0.48,
  );
  const steer = clamp(
    ((targetHeading - bot.heading) * 4.3 + bot.speed * here.curvature * 0.78 + bot.heading * 1.7) /
    steeringPower(bot.speed), -1, 1,
  );
  const speedError = targetSpeed - bot.speed;
  const reservedForTraffic = nearestAhead <= 65;
  const clearStraight = bendPace > 34.6 && !reservedForTraffic && Math.abs(bot.offset) < 2;
  const passOpportunity = readyToPass && passGap >= -collisionLength &&
    passRival.speed >= 14 && targetSpeed - passRival.speed > 1 && speedError > 1 && targetSpeed >= 27;
  const activate = boostAvailable && bot.speed > 20 && onStraight && boostPaceSquared > 30 ** 2 &&
    Math.abs(bot.heading) < 0.20 && Math.abs(bot.offset) + carHalfWidth < roadEdge &&
    (passOpportunity || clearStraight);
  return {
    steer,
    throttle: clamp(0.47 + speedError * 0.23, 0, 1),
    brake: clamp((-speedError - 0.7) * 0.30, 0, 1),
    boost: activate,
    recover: bot.wallTime > 2.2,
  };
}

function steeringPower(speed) {
  return 0.74 + clamp(Math.abs(speed) / 8, 0, 1) * 1.39 - clamp((Math.abs(speed) - 9) / 25, 0, 1) * 0.55;
}

function drive(car, input, wake, dt, race) {
  const steer = clamp(input.steer || 0, -1, 1);
  const throttle = clamp(input.throttle || 0, 0, 1);
  const brake = clamp(input.brake || 0, 0, 1);
  car.steer = smooth(car.steer, steer, 8, dt);
  car.wake = smooth(car.wake, wake, wake > car.wake ? 5 : 9, dt);

  if (car.boostTime > 0) {
    car.boostTime = brake > 0.08 ? 0 : Math.max(0, car.boostTime - dt);
    if (car.boostTime === 0) car.recharge = rechargeSeconds;
  } else {
    car.recharge = Math.max(0, car.recharge - dt);
  }
  if (input.boost && !car.boostHeld && car.recharge === 0 && car.boostTime === 0 && brake <= 0.08) {
    car.boostTime = overtakeSeconds;
  }
  car.boostHeld = Boolean(input.boost);

  const grass = clamp((Math.abs(car.offset) + carHalfWidth - roadEdge) / 2.5, 0, 1);
  const powered = car.boostTime > 0;
  const towPower = car.towRivalId === null ? 0 : car.wake;
  const limit = baseSpeed + towPower * 2.8 + (powered ? 6.8 : 0) - 11 * grass;
  const power = (throttle * (5.9 + towPower * 1.3) + (powered ? 4.2 : 0)) *
    (car.wheelRecovery > 0 ? 0.28 : 1);
  if (brake > 0.55 && throttle < 0.05 && car.speed < 0.1) car.brakeHold += dt;
  else car.brakeHold = 0;
  if (car.brakeHold > 0.35) {
    car.speed = Math.max(-5, car.speed - 3.4 * dt);
  } else {
    const resistance = 0.55 + 0.037 * Math.max(0, car.speed)
      + grass * 3.0 + 1.7 * Math.max(0, car.speed - limit);
    car.speed = Math.max(0, car.speed + (power * (1 - brake) - resistance - 12.5 * brake) * dt);
  }

  const { curvature } = track.sample(car.s);
  const direction = Math.sign(car.speed);
  const traction = 1 - grass * 0.29;
  const turnRate = car.steer * steeringPower(car.speed) * direction * traction;
  const routeYaw = curvature * car.speed * 0.78;
  const moving = clamp(Math.abs(car.speed) / 3, 0, 1);
  car.heading = clamp(
    car.heading + (moving * (turnRate - routeYaw) - car.heading * 1.7 + car.impactYaw) * dt,
    -0.92, 0.92,
  );
  const contactDamping = race.collisionMode === 'arcade' ? 4 : 6;
  car.impactSlide *= Math.exp(-contactDamping * dt);
  car.impactYaw *= Math.exp(-6 * dt);
  const lateralSpeed = Math.sin(car.heading) * car.speed + car.impactSlide;
  car.offset += lateralSpeed * dt;
  car.lean = smooth(car.lean, car.steer * clamp(car.speed / 24, 0, 1) * 0.13, 7, dt);
  if (Math.abs(car.offset) > barrier) {
    resolveWall(car, lateralSpeed, race);
    car.offset = Math.sign(car.offset) * barrier;
    car.speed *= Math.exp(-1.7 * dt);
    car.heading *= Math.exp(-5 * dt);
    car.wallTime += dt;
  } else {
    car.wallTime = Math.max(0, car.wallTime - dt);
    if (Math.abs(car.offset) < barrier - 0.14) car.wallSide = null;
  }
  const radiusFactor = clamp(1 - curvature * car.offset, 0.36, 1.65);
  car.s += Math.cos(car.heading) * car.speed * dt / radiusFactor;
  car.distance += car.speed * dt;
}

function checkRecovery(car, cars, input, dt) {
  let wheelFailed = false;
  if (car.wheelRecovery > 0) {
    car.wheelRecovery = Math.max(0, car.wheelRecovery - dt);
    wheelFailed = car.wheelRecovery === 0;
  }
  if ((input.recover && !car.recoverHeld) || car.wallTime > 3.5 || wheelFailed) {
    car.recoverTime = 0.85;
    car.recovering = true;
    car.wheelRecovery = 0;
    car.passing = null;
    if (car.boostTime > 0) car.recharge = rechargeSeconds;
    car.boostTime = 0;
    car.wallTime = 0;
  }
  car.recoverHeld = Boolean(input.recover);
  if (!car.recovering) return false;

  car.speed = 0;
  car.wake = 0;
  clearTow(car);
  car.recharge = Math.max(0, car.recharge - dt);
  car.recoverTime -= dt;
  if (car.recoverTime > 0) return true;
  const target = car.nextGate === 0 ? -4 : gateDistance(car.nextGate - 1);
  for (const lane of [0, -shiftLane, shiftLane]) {
    const occupied = cars.some((rival) => {
      if (rival === car || rival.recovering) return false;
      const gap = wrap(rival.s - target);
      return Math.abs(lane - rival.offset) < 2.7 && (gap < 10 || gap > track.length - 19);
    });
    if (occupied) continue;
    // A Jeep that reversed behind a gate must drive back to it.
    const restorePosition = Math.min(target, car.s);
    if (restorePosition < target - 0.5) {
      const stillOccupied = cars.some((rival) => rival !== car && !rival.recovering &&
        Math.abs(rival.offset - lane) < 2.7 &&
        Math.min(wrap(rival.s - restorePosition), wrap(restorePosition - rival.s)) < 17);
      if (stillOccupied) continue;
    }
    car.s = restorePosition;
    car.offset = lane;
    car.heading = 0;
    car.steer = 0;
    car.lean = 0;
    car.impactSlide = 0;
    car.impactYaw = 0;
    car.detachedParts = [];
    car.wallSide = null;
    car.recovering = false;
    break;
  }
  return true;
}

function contactSeverity(normalSpeed) {
  if (normalSpeed >= 6.8) return 'heavy';
  if (normalSpeed >= 3.1) return 'medium';
  return 'light';
}

function damageAt(car, side, along, normalSpeed, parts) {
  let partId;
  if ((side === 'left' || side === 'right') && normalSpeed >= 10.5) {
    partId = 'wheel' + (along < -0.45 ? 'R' : 'F') + (side === 'left' ? 'L' : 'R');
  } else if (normalSpeed >= 6.8 && (side === 'front' || side === 'rear')) {
    partId = side + 'Bumper';
  }
  if (!partId || car.detachedParts.includes(partId)) return;
  car.detachedParts.push(partId);
  parts.push({ carId: car.id, partId });
  if (partId.startsWith('wheel') && car.wheelRecovery === 0 && car.finishTime === null) car.wheelRecovery = 0.55;
}

function emitImpact(race, a, b, aSide, bSide, normalSpeed, contact = {}) {
  const { along = 0, strength = 1, aDamage = 1, bDamage = 1 } = contact;
  const impactSpeed = normalSpeed * strength;
  const parts = [];
  if (race.collisionMode === 'breakaway') {
    damageAt(a, aSide, along, impactSpeed * aDamage, parts);
    if (b) damageAt(b, bSide, -along, impactSpeed * bDamage, parts);
  }
  race.events.push({
    type: 'impact', time: race.elapsed, aId: a.id, bId: b?.id ?? null,
    mode: race.collisionMode, severity: contactSeverity(impactSpeed), normalSpeed, aSide, bSide, parts,
  });
}

function resolveWall(car, lateralSpeed, race) {
  const direction = Math.sign(car.offset);
  const side = direction > 0 ? 'right' : 'left';
  const normalSpeed = Math.max(0, direction * lateralSpeed);
  if (normalSpeed < impactSpeedFloor) return;
  if (car.finishTime === null && side !== car.wallSide && race.elapsed - car.wallImpactAt >= 0.38) {
    emitImpact(race, car, null, side, null, normalSpeed);
    car.wallImpactAt = race.elapsed;
  }
  car.wallSide = side;
  const arcade = race.collisionMode === 'arcade';
  car.speed *= 1 - clamp(normalSpeed * (arcade ? 0.021 : 0.030), 0, 0.42);
  car.impactSlide = clamp(-direction * (normalSpeed * (arcade ? 0.47 : 0.23)), -8, 8);
  car.impactYaw = clamp(car.impactYaw - direction * normalSpeed * (arcade ? 0.30 : 0.15), -4.5, 4.5);
}

function shiftForContact(car, delta) {
  // A separation impulse may put a nose up to the next gate. The driver
  // still has to cross it under their own movement to earn progression.
  const cap = car.finishTime === null ? gateDistance(car.nextGate) : Infinity;
  const before = car.s;
  const position = car.s + delta;
  car.s = delta > 0 ? Math.min(position, Math.max(car.s, cap)) : position;
  return Math.abs(car.s - before);
}

function pushApart(a, b, longitudinal, normal, depth) {
  const correction = (depth + 0.012) / 2;
  if (longitudinal) {
    const ahead = normal > 0 ? b : a;
    const behind = normal > 0 ? a : b;
    const moved = shiftForContact(ahead, correction);
    shiftForContact(behind, -(2 * correction - moved));
  } else {
    const upper = normal > 0 ? b : a;
    const lower = normal > 0 ? a : b;
    const upperRoom = barrier - upper.offset;
    const lowerRoom = lower.offset + barrier;
    upper.offset += Math.min(upperRoom, correction + Math.max(0, correction - lowerRoom));
    lower.offset -= Math.min(lowerRoom, correction + Math.max(0, correction - upperRoom));
  }
}

function resolveContact(a, b, pair, race, separationOnly = false) {
  if (a.recovering || b.recovering || a.finishTime !== null || b.finishTime !== null) {
    pair.touching = false;
    return;
  }
  const ahead = nearbyGap(a, b);
  const across = b.offset - a.offset;
  const depthAlong = collisionLength - Math.abs(ahead);
  const depthAcross = carWidth - Math.abs(across);
  if (depthAlong <= 0 || depthAcross <= 0) {
    if (!separationOnly && (depthAlong < -0.13 || depthAcross < -0.13)) pair.touching = false;
    return;
  }
  const longitudinal = depthAlong < depthAcross;
  const normal = (longitudinal ? Math.sign(ahead) : Math.sign(across)) || 1;
  const av = longitudinal ? Math.cos(a.heading) * a.speed : Math.sin(a.heading) * a.speed + a.impactSlide;
  const bv = longitudinal ? Math.cos(b.heading) * b.speed : Math.sin(b.heading) * b.speed + b.impactSlide;
  const normalSpeed = Math.max(0, (av - bv) * normal);
  pushApart(a, b, longitudinal, normal, longitudinal ? depthAlong : depthAcross);
  if (separationOnly) return;

  const arcade = race.collisionMode === 'arcade';
  const front = normal > 0 ? a : b;
  const rear = normal > 0 ? b : a;
  const strength = longitudinal ? clamp(1 - Math.abs(across) / carWidth, 0.22, 1) : 1;
  if (longitudinal) {
    const absorption = normalSpeed * strength;
    front.speed = Math.max(-5, front.speed - absorption * (arcade ? 0.66 : 0.75));
    rear.speed += absorption * (arcade ? 0.22 : 0.16);
    const side = Math.sign(across) || Math.sign(a.heading - b.heading);
    const glance = clamp(Math.abs(across) / carWidth, 0, 1);
    a.impactSlide -= side * absorption * glance * (arcade ? 0.30 : 0.14);
    b.impactSlide += side * absorption * glance * (arcade ? 0.32 : 0.12);
  } else {
    const shove = normalSpeed * (arcade ? 0.49 : 0.39);
    a.impactSlide = clamp(a.impactSlide - normal * shove, -9, 9);
    b.impactSlide = clamp(b.impactSlide + normal * shove, -9, 9);
    // A lateral brush mainly costs speed to the Jeep moving into it.
    a.speed *= 1 - clamp(Math.max(0, av * normal) * 0.024, 0, arcade ? 0.24 : 0.32);
    b.speed *= 1 - clamp(Math.max(0, -bv * normal) * 0.024, 0, arcade ? 0.24 : 0.32);
  }
  if (normalSpeed * strength >= impactSpeedFloor &&
    (!pair.touching || normalSpeed > pair.impactPeak + 4) && race.elapsed - pair.impactAt >= 0.26) {
    const aSide = longitudinal ? (normal > 0 ? 'front' : 'rear') : (normal > 0 ? 'right' : 'left');
    const bSide = longitudinal ? (normal > 0 ? 'rear' : 'front') : (normal > 0 ? 'left' : 'right');
    emitImpact(race, a, b, aSide, bSide, normalSpeed, {
      along: ahead,
      strength,
      aDamage: !longitudinal && av * normal < 2.5 ? 0.72 : 1,
      bDamage: !longitudinal && -bv * normal < 2.5 ? 0.72 : 1,
    });
    pair.impactAt = race.elapsed;
    pair.impactPeak = normalSpeed;
    const twist = (arcade ? 0.31 : 0.15) * normalSpeed * (longitudinal ? Math.abs(across) / carWidth : 1);
    const yawSign = longitudinal ? Math.sign(across) || 0 : normal * (ahead >= 0 ? 1 : -1);
    a.impactYaw = clamp(a.impactYaw - yawSign * twist, -4.5, 4.5);
    b.impactYaw = clamp(b.impactYaw + yawSign * twist * 0.75, -4.5, 4.5);
    pair.touching = true;
  }
}

function advanceGates(car, prior, time, dt) {
  while (car.finishTime === null) {
    const gate = gateDistance(car.nextGate);
    if (!(prior <= gate && car.s > gate)) return;
    car.nextGate += 1;
    if (gate === 0) {
      // All grid slots start on the same clock.
      continue;
    }
    if (car.nextGate % gateDistances.length === 1) {
      const crossing = time - dt + dt * (gate - prior) / (car.s - prior);
      car.lastLap = crossing - car.lapStart;
      car.bestLap = Math.min(car.bestLap ?? Number.POSITIVE_INFINITY, car.lastLap);
      car.lapStart = crossing;
      car.completedLaps += 1;
      car.lap = Math.min(laps, car.completedLaps + 1);
      if (gate >= finishProgress) car.finishTime = crossing;
    }
  }
}

function reportPass(a, b, pair, elapsed, events, interrupted) {
  const gap = a.s - b.s;
  const separation = Math.abs(gap);
  if (elapsed < 6 || a.s < 45 || b.s < 45 || separation > 60 ||
    a.finishTime !== null || b.finishTime !== null ||
    interrupted || a.speed <= 5 || b.speed <= 5) {
    pair.leader = null;
    pair.overlap = false;
    pair.clean = true;
    return;
  }
  if (separation < collisionLength) {
    pair.overlap = true;
    pair.clean &&= Math.abs(a.offset - b.offset) >= carHalfWidth * 2;
  }
  if (separation < passClear) return;
  const leader = gap > 0 ? a : b;
  const other = leader === a ? b : a;
  if (pair.leader && pair.leader !== leader.id && pair.overlap && pair.clean &&
    elapsed - pair.lastEmit >= 2.4) {
    events.push({ type: 'pass', time: elapsed, passerId: leader.id, passedId: other.id });
    pair.lastEmit = elapsed;
  }
  pair.leader = leader.id;
  pair.overlap = false;
  pair.clean = true;
}

export function createRace({
  playerGrid = 2, playerCount = 1, seed = 1, collisionMode = 'breakaway', impactTrial = false,
} = {}) {
  playerGrid = clamp(Math.round(playerGrid), 0, 3);
  const player = startingCar('player', playerGrid, 0);
  const player2 = playerCount === 2 && !impactTrial ? startingCar('player-2', playerGrid ^ 1, 0) : null;
  const players = player2 ? [player, player2] : [player];
  const gridSlots = [0, 1, 2, 3].filter((slot) => players.every(({ grid }) => grid !== slot));
  let randomState = seed >>> 0;
  const bots = gridSlots.map((grid, i) => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return startingCar('bot-' + (i + 1), grid, randomState / 4294967296);
  });
  const cars = [...players, ...bots];
  if (impactTrial) {
    const entry = track.turns.find(({ name }) => name === 'Kemmel Straight').s + 24;
    const rollingGrid = [
      [entry, -0.8, 30.5],
      [entry + 19, 0.58, 9],
      [entry - 52, -2.3, 16],
      [entry - 66, 2.3, 16],
    ];
    for (let i = 0; i < cars.length; i += 1) {
      const [s, offset, speed] = rollingGrid[i];
      Object.assign(cars[i], { s, offset, speed, nextGate: gateDistances.findIndex((gate) => gate > s) });
    }
  }
  const finishers = [];
  const pairs = [];
  for (let a = 0; a < cars.length; a += 1) {
    for (let b = a + 1; b < cars.length; b += 1) {
      pairs.push({ a, b, leader: null, overlap: false, clean: true, lastEmit: -Infinity,
        touching: false, impactAt: -Infinity, impactPeak: 0 });
    }
  }
  let accumulator = 0;
  const queued = players.map(() => ({ boost: false, recover: false }));
  let startPending = impactTrial;

  const race = {
    cars, player, player2, players, events: [],
    phase: impactTrial ? 'racing' : 'countdown',
    countdown: impactTrial ? 0 : startDuration,
    startLights: impactTrial ? 0 : 1,
    elapsed: 0,
    collisionMode: collisionModes.has(collisionMode) ? collisionMode : 'breakaway',
    setCollisionMode(mode) {
      if (!collisionModes.has(mode) || mode === race.collisionMode) return;
      race.collisionMode = mode;
      for (const car of cars) {
        car.detachedParts = [];
        car.wheelRecovery = 0;
      }
    },
    standings() {
      return [...cars].sort((a, b) => {
        if (a.finishPosition !== null || b.finishPosition !== null) {
          return (a.finishPosition ?? Infinity) - (b.finishPosition ?? Infinity);
        }
        return b.nextGate - a.nextGate || b.s - a.s;
      });
    },
    step(dt, input = {}, input2 = {}) {
      race.events = [];
      if (race.phase === 'finished' || !Number.isFinite(dt) || dt <= 0) return;
      const humanInputs = [input, input2];
      for (const [i, car] of players.entries()) {
        const command = humanInputs[i];
        queued[i].boost ||= Boolean(command.boost && !car.boostHeld);
        queued[i].recover ||= Boolean(command.recover && !car.recoverHeld);
      }
      accumulator += Math.min(dt, 0.12);
      while (accumulator >= stepSize && race.phase !== 'finished') {
        accumulator -= stepSize;
        if (startPending) {
          race.events.push({ type: 'raceStart', time: 0 });
          startPending = false;
        }
        if (race.phase === 'countdown') {
          race.countdown = Math.max(0, race.countdown - stepSize);
          race.startLights = Math.min(5, 1 + Math.floor(startDuration - race.countdown + 0.0001));
          if (race.countdown <= 0.0001) {
            race.countdown = 0;
            race.startLights = 0;
            race.phase = 'racing';
            race.events.push({ type: 'raceStart', time: 0 });
          }
          for (const flags of queued) {
            flags.boost = false;
            flags.recover = false;
          }
          continue;
        }
        race.elapsed += stepSize;
        const wakes = cars.map((car) => updateTow(car, cars));
        const inputs = [
          ...players.map((_, i) => ({
            ...humanInputs[i],
            boost: humanInputs[i].boost || queued[i].boost,
            recover: humanInputs[i].recover || queued[i].recover,
          })),
          ...bots.map((bot) => botInput(bot, cars)),
        ];
        for (const flags of queued) {
          flags.boost = false;
          flags.recover = false;
        }
        let interrupted = 0;
        for (let i = 0; i < cars.length; i += 1) {
          const car = cars[i];
          const command = car.finishTime === null ? inputs[i] : { brake: car.speed > 11 ? 0.65 : 0 };
          if (checkRecovery(car, cars, command, stepSize)) {
            interrupted |= (1 << i);
            continue;
          }
          const prior = car.s;
          drive(car, command, wakes[i], stepSize, race);
          advanceGates(car, prior, race.elapsed, stepSize);
        }
        for (const pair of pairs) {
          const { a, b } = pair;
          reportPass(cars[a], cars[b], pair, race.elapsed, race.events, interrupted & ((1 << a) | (1 << b)));
        }
        for (const pair of pairs) resolveContact(cars[pair.a], cars[pair.b], pair, race);
        // Resolve residual stacking from chained contacts without applying
        // repeated impulses or reporting another hit in the same tick.
        for (let pass = 0; pass < 2; pass += 1) {
          for (const pair of pairs) resolveContact(cars[pair.a], cars[pair.b], pair, race, true);
        }
        const finishedNow = cars
          .filter((car) => car.finishTime !== null && car.finishPosition === null)
          .sort((a, b) => a.finishTime - b.finishTime);
        for (const car of finishedNow) {
          finishers.push(car);
          car.finishPosition = finishers.length;
          if (players.includes(car)) {
            const event = { type: 'playerFinish', time: car.finishTime, position: car.finishPosition };
            if (player2) event.playerId = car.id;
            race.events.push(event);
          }
        }
        if (players.every((car) => car.finishTime !== null)) race.phase = 'finished';
      }
    },
  };
  return race;
}


