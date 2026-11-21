// Distances are measured along the road in the horizontal plane. Elevation
// is authored independently so crest grades never change race distances.
const spine = [
  [0, 4, 0, 'Start / Finish'],
  [1, 4.5, 16],
  [0, 5, 36],
  [0, 6, 69],
  [4, 6, 86],
  // Plan-view descent and climb. The valley profile below supplies the grades.
  [19, 5.5, 92, 'La Source'],
  [34, 2.8, 81],
  [37, -2, 60],
  [36, -9, 28],
  [34, -17, -7],
  [35, -28, -43],
  [40, -31.8, -63],
  [47, -35.5, -75, 'Eau Rouge'],
  [58, -30, -94],
  [57, -17.6, -118, 'Raidillon'],
  [73, -4.25, -138],
  [103, 6.5, -146, 'Kemmel Straight'],
  [152, 10, -144],
  [213, 11.5, -140],
  [263, 11.2, -138],
  [282, 10.3, -141, 'Les Combes'],
  [296, 9.4, -151],
  [303, 8.4, -168],
  [298, 7.8, -185],
  [281, 7.2, -197, 'Malmedy'],
  [255, 4.6, -201],
  [230, 2.5, -201],
  [212, 1, -193, 'Bruxelles'],
  [202, -0.5, -180],
  [188, -2.8, -173],
  [171, -5, -178, 'No Name'],
  [154, -6.8, -185],
  [135, -8.5, -187],
  [113, -10, -194, 'Pouhon'],
  [95, -12, -211],
  [76, -14, -218],
  [55, -14.5, -212],
  [38, -14.8, -205, 'Les Fagnes'],
  [24, -14.1, -202],
  [9, -13.7, -204],
  [-6, -13, -201, 'Stavelot'],
  [-18, -12, -190],
  [-27, -11, -174],
  [-36, -9.3, -153, 'Paul Frère'],
  [-42, -7.2, -129],
  [-51, -4.3, -104, 'Blanchimont'],
  [-53, -1.6, -77],
  [-56, 0.6, -48],
  [-49, 2.2, -28, 'Bus Stop'],
  [-33, 3, -21],
  [-16, 3.4, -16],
  [-6, 3.7, -10],
];

const width = 11;
const scale = 1.08;
const subdivisions = 36;
const points = [];
const turns = [];

function wrap(value, period) {
  return ((value % period) + period) % period;
}

function coordinate(p0, p1, p2, p3, t) {
  // Uniform Catmull–Rom. The control points are close and regularly spaced
  // where the route tightens, keeping the spline free of cusps.
  return 0.5 * (
    2 * p1 +
    t * ((p2 - p0) +
      t * (2 * p0 - 5 * p1 + 4 * p2 - p3 +
        t * (-p0 + 3 * p1 - 3 * p2 + p3)))
  );
}

let length = 0;
for (let i = 0; i < spine.length; i += 1) {
  const p0 = spine[wrap(i - 1, spine.length)];
  const p1 = spine[i];
  const p2 = spine[wrap(i + 1, spine.length)];
  const p3 = spine[wrap(i + 2, spine.length)];

  for (let j = 0; j < subdivisions; j += 1) {
    const t = j / subdivisions;
    const x = coordinate(p0[0], p1[0], p2[0], p3[0], t) * scale;
    const y = coordinate(p0[1], p1[1], p2[1], p3[1], t);
    const z = coordinate(p0[2], p1[2], p2[2], p3[2], t) * scale;
    const previous = points.at(-1);
    if (previous) length += Math.hypot(x - previous.x, z - previous.z);
    points.push({ x, y, z, s: length });
    if (j === 0 && p1[3]) turns.push({ name: p1[3], s: length });
  }
}

const first = points[0];
const last = points.at(-1);
length += Math.hypot(first.x - last.x, first.z - last.z);
points.push({ ...first, s: length });

function position(distance) {
  const s = wrap(distance, length);
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >>> 1;
    if (points[middle].s <= s) low = middle;
    else high = middle;
  }
  const a = points[low];
  const b = points[high];
  const t = (s - a.s) / (b.s - a.s);
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function angleAt(distance, radius = 0.8) {
  const a = position(distance - radius);
  const b = position(distance + radius);
  return Math.atan2(b.x - a.x, b.z - a.z);
}

const startOffset = 38;
for (const turn of turns) turn.s = turn.s === 0 ? 0 : turn.s - startOffset;

const laSource = turns.find(turn => turn.name === 'La Source').s;
const eauRouge = turns.find(turn => turn.name === 'Eau Rouge').s;
const kemmel = turns.find(turn => turn.name === 'Kemmel Straight').s;
const lesCombes = turns.find(turn => turn.name === 'Les Combes').s;
const descentStart = laSource + 2;
const descentAtGrade = laSource + 58;
const compressionStart = eauRouge - 49;
const profileEnd = lesCombes - 34;

function splineElevation(s) {
  return position(s + startOffset).y;
}

function splineGrade(s) {
  return (splineElevation(s + 0.01) - splineElevation(s - 0.01)) / 0.02;
}

const profileStartHeight = splineElevation(descentStart);
const startGrade = splineGrade(descentStart);
const climbGrades = [
  [eauRouge, 0],
  [eauRouge + 32, 0.18],
  [kemmel - 36, 0.18],
  [kemmel - 4, 0.093],
  [lesCombes - 80, 0.093],
  [profileEnd, splineGrade(profileEnd)],
];

// Smoothstep changes the grade without a jump in vertical curvature. Its
// average equals the mean of the endpoint grades, so solve the descent grade
// from the height needed to rejoin the original spine after Kemmel.
const climbRise = climbGrades.slice(1).reduce((rise, [s, grade], i) => {
  const [previousS, previousGrade] = climbGrades[i];
  return rise + (s - previousS) * (grade + previousGrade) / 2;
}, 0);
const descentTransition = (descentAtGrade - descentStart) / 2;
const descentGradeDistance = descentTransition + compressionStart - descentAtGrade
  + (eauRouge - compressionStart) / 2;
const descentGrade = (splineElevation(profileEnd) - profileStartHeight - climbRise
  - startGrade * descentTransition) / descentGradeDistance;

const gradeStations = [
  [descentStart, startGrade],
  [descentAtGrade, descentGrade],
  [compressionStart, descentGrade],
  ...climbGrades,
];
let profileHeight = profileStartHeight;
const gradeSegments = gradeStations.slice(1).map(([end, endGrade], i) => {
  const [start, grade] = gradeStations[i];
  const span = end - start;
  const segment = { end, start, span, grade, endGrade, height: profileHeight };
  profileHeight += span * (grade + endGrade) / 2;
  return segment;
});

function elevation(s, standardHeight) {
  if (s < descentStart || s >= profileEnd) return standardHeight;
  const { start, span, grade, endGrade, height } = gradeSegments.find(segment => s < segment.end);
  const t = (s - start) / span;
  // Integrate the smoothstep grade over the fraction of the segment travelled.
  return height + span * (grade * t + (endGrade - grade) * t ** 3 * (1 - t / 2));
}

function sample(distance) {
  const s = distance + startOffset;
  const before = angleAt(s - 2.5, 1.5);
  const after = angleAt(s + 2.5, 1.5);
  const curvature = wrap(after - before + Math.PI, Math.PI * 2) / 5 - Math.PI / 5;
  const point = position(s);
  return { ...point, y: elevation(wrap(distance, length), point.y), angle: angleAt(s), curvature };
}

const checkpoints = Array.from({ length: 11 }, (_, i) => length * (i + 1) / 12);
const brakingBoards = ['La Source', 'Les Combes', 'Bus Stop'].flatMap((corner) => {
  const turn = turns.find((entry) => entry.name === corner);
  return [[100, 98], [50, 53]].map(([label, offset]) => ({ corner, label, s: turn.s - offset }));
});
export const track = { width, length, turns, corners: turns, checkpoints, brakingBoards, gridS: 0, sample };



