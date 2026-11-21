const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const wrap = (value, period) => ((value % period) + period) % period;

function curvatureOf(a, b, c) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const bcx = c.x - b.x;
  const bcz = c.z - b.z;
  return 2 * (abz * bcx - abx * bcz) /
    (Math.hypot(abx, abz) * Math.hypot(bcx, bcz) * Math.hypot(abx + bcx, abz + bcz));
}

export function planRacingLine(track) {
  const count = Math.round(track.length / 5.2);
  const spacing = track.length / count;
  const inset = 1.65;
  const lane = track.width / 2 - inset;
  const centers = Array.from({ length: count }, (_, i) => track.sample(i * spacing));
  const offsets = new Float64Array(count);
  const points = centers.map(({ x, z }) => ({ x, z }));
  const normals = centers.map(({ angle }) => ({ x: Math.cos(angle), z: -Math.sin(angle) }));
  const costs = new Float64Array(count);
  const cornerGuide = new Float64Array(count);
  const guideWeight = new Float64Array(count);
  const candidates = centers.map(({ curvature }, index) => ({ curvature, index }))
    .filter(({ curvature }) => Math.abs(curvature) >= 0.025)
    .sort((a, b) => Math.abs(b.curvature) - Math.abs(a.curvature));
  const peaks = [];

  function bind(index, offset, weight) {
    const wrapped = (index + count) % count;
    cornerGuide[wrapped] += offset * weight;
    guideWeight[wrapped] += weight;
  }

  for (const { curvature, index } of candidates) {
    const crowded = peaks.some((peak) => {
      const distance = Math.abs(index - peak.index);
      return Math.sign(curvature) === Math.sign(peak.curvature) && Math.min(distance, count - distance) <= 7;
    });
    if (crowded) continue;
    peaks.push({ curvature, index });
    const inside = Math.sign(curvature);
    const severity = clamp(Math.abs(curvature) / 0.062, 0.38, 1);
    for (let step = -7; step <= 8; step += 1) {
      const apex = Math.exp(-((step / 2.1) ** 2));
      const entry = Math.exp(-(((step + 4.0) / 2.2) ** 2));
      const exit = Math.exp(-(((step - 4.7) / 2.4) ** 2));
      const weight = (apex + 0.66 * (entry + exit)) * severity;
      const bias = inside * lane * (0.90 * apex - 0.76 * entry - 0.65 * exit);
      bind(index + step, bias, weight);
    }
  }
  for (let i = 0; i < count; i += 1) {
    if (guideWeight[i] > 0) cornerGuide[i] /= guideWeight[i];
    offsets[i] = cornerGuide[i];
    pointAt(i, offsets[i]);
  }

  function pointAt(index, offset) {
    const point = points[index];
    const center = centers[index];
    point.x = center.x + offset * normals[index].x;
    point.z = center.z + offset * normals[index].z;
  }

  function costAt(index) {
    const current = points[index];
    const after = points[(index + 1) % count];
    const before = points[(index + count - 1) % count];
    const curvature = Math.abs(curvatureOf(before, current, after));
    const span = Math.hypot(after.x - current.x, after.z - current.z);
    return (0.021 + 120 * Math.pow(curvature, 1.75)) * span
      + 0.00025 * offsets[index] ** 2
      + 0.023 * guideWeight[index] * (offsets[index] - cornerGuide[index]) ** 2;
  }

  // Relax a periodic path inside the road envelope. The local objective
  // penalizes tight curvature more strongly than extra path length, letting
  // the solver take a wider entry and exit to open a corner radius.
  for (let i = 0; i < count; i += 1) costs[i] = costAt(i);
  for (let sweep = 0; sweep < 95; sweep += 1) {
    const step = sweep < 38 ? 0.24 : sweep < 72 ? 0.11 : 0.045;
    for (let j = 0; j < count; j += 1) {
      const i = sweep % 2 === 0 ? j : count - 1 - j;
      const row = [(i + count - 1) % count, i, (i + 1) % count];
      const current = offsets[i];
      let best = current;
      let cost = costs[row[0]] + costs[row[1]] + costs[row[2]];
      for (const change of [-step, step]) {
        const candidate = clamp(current + change, -lane, lane);
        offsets[i] = candidate;
        pointAt(i, candidate);
        const nextCost = costAt(row[0]) + costAt(row[1]) + costAt(row[2]);
        if (nextCost < cost) {
          cost = nextCost;
          best = candidate;
        }
      }
      offsets[i] = best;
      pointAt(i, best);
      for (const index of row) costs[index] = costAt(index);
    }
  }

  const smoothOffsets = Float64Array.from(offsets, (_, i) => (
    offsets[(i - 1 + count) % count] + 2 * offsets[i] + offsets[(i + 1) % count]
  ) / 4);
  function offsetAt(s) {
    const index = wrap(s / spacing, count);
    const i = Math.floor(index);
    const t = index - i;
    const before = smoothOffsets[(i - 1 + count) % count];
    const start = smoothOffsets[i];
    const end = smoothOffsets[(i + 1) % count];
    const after = smoothOffsets[(i + 2) % count];
    return 0.5 * (2 * start + t * (-before + end + t * (
      2 * before - 5 * start + 4 * end - after + t * (-before + 3 * start - 3 * end + after)
    )));
  }
  function worldAt(s) {
    const { x, z, angle } = track.sample(s);
    const offset = offsetAt(s);
    return { x: x + offset * Math.cos(angle), z: z - offset * Math.sin(angle) };
  }

  const hints = Array.from({ length: count }, (_, i) => {
    const s = i * spacing;
    const center = worldAt(s);
    const before = worldAt(s - spacing);
    const after = worldAt(s + spacing);
    const span = Math.hypot(after.x - before.x, after.z - before.z) * 0.5;
    const arcCurvature = Math.abs(curvatureOf(before, center, after));
    const relativeAngle = Math.atan2(after.x - before.x, after.z - before.z) - centers[i].angle;
    return {
      relativeHeading: wrap(relativeAngle + Math.PI, Math.PI * 2) - Math.PI,
      stretch: span / spacing,
      curvature: arcCurvature,
    };
  });

  function sample(s) {
    const index = wrap(s / spacing, count);
    const i = Math.floor(index);
    const weight = index - i;
    const a = hints[i];
    const b = hints[(i + 1) % count];
    return {
      offset: offsetAt(s),
      relativeHeading: a.relativeHeading + (b.relativeHeading - a.relativeHeading) * weight,
      stretch: a.stretch + (b.stretch - a.stretch) * weight,
      curvature: a.curvature + (b.curvature - a.curvature) * weight,
    };
  }

  return { sample, spacing };
}

