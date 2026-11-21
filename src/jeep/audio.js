import { track } from './track.js';
import { getCrowdSections } from './crowd-sections.js';

const muteKey = 'little-box-jeep-muted';
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));

function crowdAt(distance) {
  const lap = (distance % track.length + track.length) % track.length;
  let left = 0;
  let right = 0;
  for (const stand of getCrowdSections()) {
    const gap = Math.abs(stand.s - lap);
    const along = Math.max(0, Math.min(gap, track.length - gap) - stand.span * .5);
    const distanceSquared = along * along + (12 + stand.offset) ** 2;
    const level = (stand.rows / 7) / (1 + distanceSquared / 650);
    if (stand.side < 0) left += level;
    else right += level;
  }
  return { level: 1 - Math.exp(-(left + right)), pan: .62 * (right - left) / (left + right + .15) };
}

function storedMute() {
  try {
    return localStorage.getItem(muteKey) === 'true';
  } catch {
    return false;
  }
}

function makeNoise(ctx) {
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 61081;
  let drift = 0;
  for (let i = 0; i < samples.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = (seed / 4294967296) * 2 - 1;
    drift = .82 * drift + .18 * white;
    samples[i] = white * .61 + drift * .39;
  }
  const fade = Math.round(ctx.sampleRate * .008);
  for (let i = 0; i < fade; i += 1) {
    const amount = i / fade;
    samples[i] *= amount;
    samples[samples.length - 1 - i] *= amount;
  }
  return buffer;
}

function gain(ctx, value, output) {
  const node = ctx.createGain();
  node.gain.value = value;
  node.connect(output);
  return node;
}

function filter(ctx, type, frequency, q, output) {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  node.connect(output);
  return node;
}

function makeMix(ctx) {
  const master = gain(ctx, 0, ctx.destination);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 10;
  compressor.ratio.value = 4;
  compressor.attack.value = .003;
  compressor.release.value = .115;
  compressor.connect(master);
  const buffer = makeNoise(ctx);
  const cues = new Set();
  const pitch = ctx.createPeriodicWave(
    new Float32Array(9),
    new Float32Array([0, 1, .43, .19, .14, .075, .07, .035, .026]),
  );

  function bed(output, offset) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(output);
    source.start(0, offset);
  }

  function makeDriver(index) {
    const spatial = ctx.createStereoPanner();
    spatial.connect(compressor);
    const volume = gain(ctx, 1, spatial);
    const engine = gain(ctx, 0, volume);
    const engineFilter = filter(ctx, 'lowpass', 390, .68, engine);
    const shaft = ctx.createOscillator();
    shaft.setPeriodicWave(pitch);
    shaft.frequency.value = 43;
    shaft.connect(engineFilter);
    shaft.start();
    const rotor = ctx.createOscillator();
    rotor.type = 'triangle';
    rotor.frequency.value = 80;
    rotor.connect(gain(ctx, .24, engineFilter));
    rotor.start();
    const pressure = gain(ctx, 0, engineFilter);
    bed(filter(ctx, 'bandpass', 400, .65, pressure), .4 + index * .19);
    const wind = gain(ctx, 0, volume);
    const airFilter = filter(ctx, 'lowpass', 840, .56, wind);
    bed(filter(ctx, 'highpass', 250, .55, airFilter), 1.14 + index * .32);
    const tow = gain(ctx, 0, volume);
    bed(filter(ctx, 'bandpass', 910, .81, tow), 1.764 + index * .29);
    const charge = gain(ctx, 0, volume);
    const turbine = ctx.createOscillator();
    turbine.type = 'sine';
    turbine.frequency.value = 160;
    turbine.connect(charge);
    turbine.start();

    return {
      quiet(time) {
        for (const node of [engine, wind, tow, charge, pressure]) ramp(node.gain, 0, time, .032);
      },
      drive(time, player, throttle, countdown, shared) {
        const speed = Math.abs(player.speed || 0);
        const moving = clamp(speed / 33);
        const loaded = clamp(Number(throttle));
        const boost = player.boostTime > 0;
        // Separate revs and shifts keep either player's throttle audible.
        const gear = speed < 8 ? speed : speed < 17 ? speed - 6 : speed < 26 ? speed - 12 : speed - 17;
        const rpm = 43 + gear * 4.7 + loaded * 9.5 + (boost ? 10 : 0) + index * 7;
        ramp(spatial.pan, shared ? (index === 0 ? -.32 : .32) : 0, time, .09);
        // At center, equal-power mono panning attenuates both channels by 3 dB.
        ramp(volume.gain, shared ? .61 : Math.SQRT2, time, .09);
        ramp(shaft.frequency, rpm, time, .083);
        ramp(rotor.frequency, rpm * 1.986, time, .083);
        ramp(engineFilter.frequency, 255 + moving * 583 + loaded * 260, time, .095);
        ramp(engine.gain, countdown ? .043 : .091 + moving * .048 + loaded * .036, time, .073);
        ramp(pressure.gain, countdown ? 0 : .062 * loaded + moving * .02, time, .073);
        ramp(airFilter.frequency, 740 + 820 * moving, time, .108);
        ramp(wind.gain, moving * moving * .105, time, .091);
        ramp(tow.gain, clamp(player.wake || 0) * (.11 + .16 * moving), time, .075);
        ramp(turbine.frequency, 187 + 230 * moving + index * 24, time, .082);
        ramp(charge.gain, boost ? .086 : 0, time, .062);
      },
    };
  }

  const drivers = [makeDriver(0)];
  const grandstandPan = ctx.createStereoPanner();
  grandstandPan.connect(compressor);
  const crowd = gain(ctx, 0, grandstandPan);
  const crowdLow = filter(ctx, 'bandpass', 525, .9, gain(ctx, .72, crowd));
  const crowdHigh = filter(ctx, 'bandpass', 1360, 1.14, gain(ctx, .26, crowd));
  bed(crowdLow, .864);
  bed(crowdHigh, 1.984);
  const swell = ctx.createOscillator();
  swell.frequency.value = .82;
  const swellDepth = gain(ctx, 82, crowdLow.frequency);
  swell.connect(swellDepth);
  swell.start();

  function ramp(param, value, time, duration = .045) {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, duration);
  }

  function voice(node, end, clean) {
    cues.add(node);
    node.onended = () => {
      cues.delete(node);
      node.disconnect();
      clean();
    };
    node.stop(end);
  }

  function tone(time, frequency, endFrequency, duration, volume, type = 'sine', output = compressor) {
    const node = ctx.createOscillator();
    const envelope = gain(ctx, .0001, output);
    node.type = type;
    node.frequency.setValueAtTime(frequency, time);
    if (frequency !== endFrequency) {
      node.frequency.exponentialRampToValueAtTime(endFrequency, time + duration * .81);
    }
    envelope.gain.setValueAtTime(.0001, time);
    envelope.gain.linearRampToValueAtTime(volume, time + .012);
    envelope.gain.exponentialRampToValueAtTime(.0001, time + duration);
    node.connect(envelope);
    node.start(time);
    voice(node, time + duration + .012, () => envelope.disconnect());
  }

  function breath(time, duration, volume, middle, finish = middle, q = .85, pan = 0) {
    const node = ctx.createBufferSource();
    const spatial = ctx.createStereoPanner();
    spatial.pan.value = pan;
    spatial.connect(compressor);
    const envelope = gain(ctx, .0001, spatial);
    const color = filter(ctx, 'bandpass', middle, q, envelope);
    color.frequency.setValueAtTime(middle, time);
    color.frequency.exponentialRampToValueAtTime(finish, time + duration);
    envelope.gain.setValueAtTime(.0001, time);
    envelope.gain.linearRampToValueAtTime(volume, time + Math.min(.10, duration * .22));
    envelope.gain.exponentialRampToValueAtTime(.0001, time + duration);
    node.buffer = buffer;
    node.connect(color);
    node.start(time, .24 + (middle % 430) / 430);
    voice(node, time + duration + .012, () => {
      spatial.disconnect();
      envelope.disconnect();
      color.disconnect();
    });
  }

  function cheer(time, amount, pitchLift = 1) {
    breath(time, .99, .44 * amount, 640, 465, .76);
    breath(time + .045, .63, .24 * amount, 1150 * pitchLift, 1550, 1.8, -.52);
    breath(time + .10, .79, .22 * amount, 820 * pitchLift, 1320, 1.9, .46);
    breath(time + .16, .60, .17 * amount, 1760, 930, 2.0, .20);
    tone(time + .08, 744 * pitchLift, 1240 * pitchLift, .29, .025 * amount);
    tone(time + .245, 990 * pitchLift, 1360 * pitchLift, .24, .016 * amount);
  }

  function light(time, index) {
    const note = [196, 220, 246.94, 261.63, 293.66][index - 1];
    tone(time, note, note, .21, .25, 'triangle');
    tone(time, note * 2, note * 1.96, .10, .052);
    breath(time, .105, .12, 1120, 520, 1);
  }

  function impact(time, event, mode, pan = 0) {
    const force = clamp(event.normalSpeed / 10, .15, 1);
    tone(time, 165, 50, .08 + force * .16, .12 + force * .19, 'triangle');
    breath(time, .06 + force * .08, .12 + force * .2, 1700, 470, .85, pan);
    if (event.parts?.length) {
      for (const [delay, pitch] of [[.06, 930], [.20, 670], [.31, 740]]) {
        tone(time + delay, pitch, pitch * .66, .075, .065 * force, 'triangle');
      }
    } else if (mode === 'arcade' && event.severity !== 'light') {
      breath(time + .04, .25 + force * .23, .28 * force, 1700, 640, 2.7, pan);
    }
  }

  function signal(time, type, amount) {
    if (type === 'raceStart') {
      tone(time, 128, 67, .27, .23, 'triangle');
      tone(time, 392, 392, .38, .19, 'triangle');
      tone(time + .036, 523.25, 523.25, .32, .13, 'triangle');
      tone(time + .078, 783.99, 783.99, .28, .075);
      breath(time, .39, .22, 1580, 620);
      cheer(time + .12, .86);
    } else if (type === 'boost') {
      tone(time, 112, 327, .40, .12, 'triangle');
      tone(time + .075, 216, 825, .48, .059);
      breath(time, .62, .30, 640, 2680, .66);
    } else if (type === 'pass') {
      const ahead = amount === 'gain';
      const first = ahead ? 493.88 : 392;
      const second = ahead ? 739.99 : 293.66;
      cheer(time + .02, ahead ? .93 : .73, ahead ? 1.08 : .83);
      tone(time, first, first, .16, .105, 'triangle');
      tone(time + .091, second, second, .26, .088, 'triangle');
    } else if (type === 'firstFinish') {
      const note = amount === 1 ? 523.25 : 392;
      tone(time, note, note, .18, .11, 'triangle');
      tone(time + .105, note * 1.5, note * 1.5, .25, .085, 'triangle');
      breath(time, .34, .17, 870, 520, .8);
    } else if (type === 'playerFinish') {
      const first = amount === 1 ? 523.25 : 392;
      const ratios = [1, 1.25, 1.5, 2];
      cheer(time, 1.35, 1.13);
      cheer(time + .34, .93);
      for (let i = 0; i < ratios.length; i += 1) {
        const note = first * ratios[i];
        tone(time + i * .145, note, note, .46 + i * .044, .17, 'triangle');
        tone(time + .055 + i * .145, note * 2, note * 1.997, .24, .036);
      }
      tone(time, first * .25, first * .22, .57, .14, 'triangle');
    }
  }

  function quiet(time = ctx.currentTime) {
    for (const driver of drivers) driver.quiet(time);
    ramp(crowd.gain, 0, time, .032);
  }

  function reset() {
    for (const node of cues) {
      node.stop();
    }
    quiet();
  }

  function drive(time, players, throttles, countdown, finished) {
    if (players.length > drivers.length) drivers.push(makeDriver(1));
    const active = players.filter(({ id }) => !finished.has(id));
    for (const [i, driver] of drivers.entries()) {
      const player = players[i];
      if (player && !finished.has(player.id)) driver.drive(time, player, throttles[i], countdown, active.length > 1);
      else driver.quiet(time);
    }
    if (!active.length) {
      quiet(time);
      return;
    }
    const stands = active.reduce((average, player) => {
      const nearby = crowdAt(player.s);
      average.level += nearby.level / active.length;
      average.pan += nearby.pan / active.length;
      return average;
    }, { level: 0, pan: 0 });
    ramp(crowd.gain, .065 + .22 * stands.level, time, .22);
    ramp(grandstandPan.pan, stands.pan, time, .18);
  }

  return { master, ramp, light, signal, impact, quiet, reset, drive };
}

export function createRaceAudio() {
  let muted = storedMute();
  let ctx;
  let mix;
  let running = false;
  let paused = false;
  let pausedNow = false;
  let activeLights = 0;
  let boostWasActive = [];
  let previousEvents;
  const finished = new Set();
  let bestFinishPosition = Infinity;
  let nextPass = 0;
  let nextDrive = 0;

  function output() {
    if (!ctx) return;
    const audible = !muted && !paused;
    mix.ramp(mix.master.gain, audible ? .64 : 0, ctx.currentTime, .017);
    if (audible) {
      pausedNow = false;
      ctx.resume().catch(() => {});
    } else {
      pausedNow = true;
      ctx.suspend().catch(() => {});
    }
  }

  return {
    get muted() { return muted; },
    setMuted(value) {
      muted = Boolean(value);
      if (muted) mix?.reset();
      try {
        localStorage.setItem(muteKey, String(muted));
      } catch { /* Storage access is optional. */ }
      output();
    },
    unlock() {
      if (muted) return;
      if (!ctx) {
        const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!Audio) return;
        try {
          ctx = new Audio();
          mix = makeMix(ctx);
        } catch {
          this.stop();
          return;
        }
      }
      output();
    },
    start() {
      running = true;
      paused = false;
      activeLights = 0;
      boostWasActive = [];
      finished.clear();
      bestFinishPosition = Infinity;
      nextPass = 0;
      previousEvents = undefined;
      nextDrive = 0;
      mix?.reset();
      output();
    },
    sync(race, { throttle = false, throttle2 = false } = {}) {
      if (!running) return;
      const eligible = ctx && !muted && !pausedNow;
      const time = eligible ? ctx.currentTime : 0;
      const players = race.players ?? [race.player];
      const isLocal = (id) => players.some((car) => car.id === id);
      const shared = players.length > 1;
      const lights = race.phase === 'countdown' ? race.startLights : 0;
      if (lights > activeLights && eligible) mix.light(time, lights);
      activeLights = lights;
      const boost = players.map((car) => !finished.has(car.id) && car.boostTime > 0);
      if (eligible && boost.some((active, index) => active && !boostWasActive[index])) mix.signal(time, 'boost');
      boostWasActive = boost;

      if (race.events !== previousEvents) {
        let finishEvent;
        let pass;
        for (const event of race.events ?? []) {
          if (event.type === 'playerFinish') {
            const id = event.playerId ?? race.player.id;
            if (!isLocal(id) || finished.has(id)) continue;
            finished.add(id);
            finishEvent = event;
            bestFinishPosition = Math.min(bestFinishPosition, event.position);
          } else if (eligible && finished.size < players.length) {
            if (event.type === 'impact' && (isLocal(event.aId) || isLocal(event.bId))) {
              const firstHit = event.aId === players[0].id || event.bId === players[0].id;
              const secondHit = shared && (event.aId === players[1].id || event.bId === players[1].id);
              const pan = firstHit === secondHit || !shared ? 0 : firstHit ? -.24 : .24;
              mix.impact(time, event, event.mode ?? race.collisionMode, pan);
            }
            if (event.type === 'raceStart') mix.signal(time, event.type);
            if (event.type === 'pass') {
              // One pass between local players gets one cue, with gain
              // taking precedence over the other player's simultaneous loss.
              if (isLocal(event.passerId)) pass = 'gain';
              else if (isLocal(event.passedId)) pass ??= 'loss';
            }
          }
        }
        if (finishEvent && eligible) {
          if (finished.size === players.length) {
            mix.quiet(time);
            mix.signal(time, 'playerFinish', bestFinishPosition);
          } else {
            mix.signal(time, 'firstFinish', finishEvent.position);
          }
          nextDrive = 0;
        } else if (pass && eligible && time >= nextPass) {
          mix.signal(time, 'pass', pass);
          if (shared) nextPass = time + .28;
        }
        previousEvents = race.events;
      }
      if (eligible && finished.size < players.length && time >= nextDrive) {
        nextDrive = time + 1 / 30;
        mix.drive(time, players, [throttle, throttle2], race.phase === 'countdown', finished);
      }
    },
    pause() {
      paused = true;
      output();
    },
    resume() {
      paused = false;
      output();
    },
    stop() {
      running = false;
      const previous = ctx;
      ctx = undefined;
      mix?.reset();
      mix = undefined;
      previous?.close().catch(() => {});
    },
  };
}
