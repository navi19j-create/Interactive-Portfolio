// Read-only race telemetry supplies discrete keyboard commands for browser QA.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function makeDriver(track, flatOutDescent = false) {
  const hairpinExit = track.turns.find(turn => turn.name === 'La Source').s + 12;
  const kemmel = track.turns.find((turn) => turn.name === 'Kemmel Straight').s;
  const lesCombes = track.turns.find((turn) => turn.name === 'Les Combes').s;
  const brakeInputAt = lesCombes - 43;
  const board = track.brakingBoards.find(({ corner, label }) => corner === 'Les Combes' && label === 50);
  const clearance = 4.2;
  const events = [];
  const error = { steer: 0, throttle: 0, brake: 0 };
  let rival = null;
  let peak = null;
  let activation = null;
  let crossing = null;
  let cleared = false;
  let observedBoard = false;
  let previous;

  function interpolate(before, after, fraction) {
    const result = { ...after };
    for (const field of ['at', 'progress', 'gap', 'lateral', 'speed']) {
      result[field] = before[field] + fraction * (after[field] - before[field]);
    }
    return result;
  }

  function pulse(name, value, dt, min = 0) {
    const interval = Math.max(.008, dt);
    error[name] += value * interval;
    const command = clamp(Math.round(error[name] / interval), min, 1);
    error[name] -= command * interval;
    return command;
  }

  function sample(race, rivalCar) {
    const { player, elapsed } = race;
    return {
      at: elapsed, progress: player.s, rival: rivalCar.id,
      gap: rivalCar.s - player.s, lateral: player.offset - rivalCar.offset,
      wake: player.wake, towRivalId: player.towRivalId,
      sourceGap: player.towGap, speed: player.speed, closingSpeed: player.towClosingSpeed,
    };
  }

  return {
    events,
    input(race, dt) {
      const { player, cars } = race;
      if (race.phase === 'countdown') return { throttle: 1 };
      const s = player.s;
      let targetSpeed = 24;
      for (let ahead = 0; ahead < 55; ahead += 3) {
        const curvature = Math.abs(track.sample(s + ahead).curvature);
        targetSpeed = Math.min(targetSpeed, Math.sqrt(Math.max(95, 13 / curvature) + 12 * ahead));
      }
      const nearest = cars.filter(other => other !== player && other.s > s && other.s - s < 36)
        .sort((a, b) => a.s - b.s)[0];
      const source = cars.find(car => car.id === player.towRivalId);
      let desiredOffset = s < 18 ? player.offset : 0;
      let boost = false;
      if (s > kemmel - 23 && s < brakeInputAt) {
        if (s < kemmel + 48 && (source || nearest)) desiredOffset = (source || nearest).offset;
        if (s >= kemmel + 46 && !rival && source && player.wake > .18) rival = source;
        if (!rival && s >= kemmel + 62) rival = source || nearest;
        if (rival && !activation && source === rival && (!peak || player.wake > peak.wake)) {
          peak = sample(race, rival);
        }
        if (rival) desiredOffset = s < kemmel + 73 ? rival.offset : 3.65;
        if (rival && peak && !activation && s >= kemmel + 80 && player.offset - rival.offset > 2.20 &&
            rival.s > s && player.recharge === 0) {
          events.push({ type: 'draft', ...peak });
          activation = sample(race, rival);
          events.push({ type: 'activation', ...activation });
          boost = true;
        }
        if (activation && !crossing && s >= rival.s) {
          crossing = sample(race, rival);
          events.push({ type: 'alongside', ...crossing });
        }
      }
      if (activation && !observedBoard) {
        const current = sample(race, rival);
        if (previous && crossing && !cleared && current.gap <= -clearance) {
          const clear = interpolate(previous, current, (-clearance - previous.gap) / (current.gap - previous.gap));
          if (clear.progress <= board.s) {
            cleared = true;
            events.push({ type: 'clear', ...clear, beforeBoard: board.s - clear.progress });
          }
        }
        if (previous && s >= board.s) {
          observedBoard = true;
          const atBoard = interpolate(previous, current, (board.s - previous.progress) / (s - previous.progress));
          events.push({ type: '50 board', ...atBoard, board, fullyClear: atBoard.gap < -clearance });
        }
        previous = current;
      }
      const onKemmel = s > kemmel - 18 && s < brakeInputAt;
      const desiredHeading = (desiredOffset - player.offset) * .18 - .23 * player.heading;
      const curvature = track.sample(s).curvature;
      const steering = clamp((4.3 * (desiredHeading - player.heading) + 1.7 * player.heading + player.speed * curvature * .78) / 1.9, -1, 1);
      const steer = pulse('steer', steering, dt, -1);
      if (flatOutDescent && s >= hairpinExit && s <= brakeInputAt) {
        return { steer, throttle: 1, brake: 0, boost: false };
      }
      const brake = onKemmel ? 0 : pulse('brake', clamp((player.speed - targetSpeed - .7) * .3, 0, 1), dt);
      const throttle = onKemmel ? 1 : pulse('throttle', clamp(.48 + (targetSpeed - player.speed) * .22, 0, 1), dt);
      return { steer, throttle: brake ? 0 : throttle, brake, boost };
    }
  };
}
