import { track } from './track.js';

const rail = track.width / 2 + 3.83;
const at = name => track.turns.find(turn => turn.name === name).s;
const start = track.gridS;
const hairpin = at('La Source');
const dip = at('Eau Rouge');
const ridge = at('Raidillon');
const straight = at('Kemmel Straight');
const chicane = at('Les Combes');
const bends = at('Les Fagnes');
const returnStraight = at('Paul Frère');

function between(a, b, mix) {
  return a + (b - a) * mix;
}

const seating = [
  [start + 10,   1, 13, 4, 0.25, '', 'coral'],
  [start + 45,  -1, 34, 8, 0.35, 'ARDENNES GRANDSTAND', 'coral'],
  [hairpin + 1, -1, 15, 5, 1.65, '', 'gold'],
  [hairpin + (dip - hairpin) * 0.38, 1, 22, 5, 1.50, 'EAU ROUGE DESCENT', 'mint'],
  [dip - 27,     1, 24, 7, 1.10, 'EAU ROUGE', 'mint'],
  [ridge + (straight - ridge) * 0.62, -1, 21, 5, 0.85, 'RAIDILLON', 'mint'],
  [straight + (chicane - straight) * 0.34, 1, 23, 6, 1.45, 'KEMMEL', 'gold'],
  [chicane - 79, -1, 18, 4, 1.60, '', 'gold'],
  [chicane - 37,  1, 16, 4, 1.55, '', 'coral'],
  [chicane + 9,  -1, 14, 4, 1.30, '', 'coral'],
  [at('Bruxelles') - 9, -1, 20, 6, 1.30, 'BRUXELLES', 'coral'],
  [at('Pouhon') - 24, -1, 24, 7, 0.85, 'POUHON', 'mint'],
  [bends - 11, 1, 24, 6, 0.95, 'LES FAGNES', 'gold'],
  [at('Stavelot') + 23, -1, 19, 5, 0.85, '', 'mint'],
  [returnStraight + 43, 1, 24, 5, 0.85, 'ARDENNES TERRACE', 'gold'],
  [at('Blanchimont') - 12, -1, 22, 5, 1.25, 'BLANCHIMONT', 'coral'],
  [at('Bus Stop') + 9, 1, 17, 4, 1.75, '', 'coral'],
];

const banks = [
  [between(hairpin, dip, 0.19), -1, 24, 2, 0.40, '', 'gold'],
  [between(hairpin, dip, 0.52), -1, 28, 3, 0.65, '', 'mint'],
  [between(hairpin, dip, 0.75), -1, 27, 3, 0.60, '', 'mint'],
  [dip + 12, -1, 22, 3, 0.70, '', 'mint', 'Eau Rouge bank'],
  [between(dip, ridge, 0.76), 1, 24, 2, 0.65, '', 'gold'],
  [between(ridge, straight, 0.63), 1, 24, 3, 0.70, '', 'mint'],
  [straight + 31, -1, 27, 3, 0.70, '', 'gold'],
  [between(straight, chicane, 0.54), -1, 26, 3, 0.80, '', 'gold'],
  [between(straight, chicane, 0.68), 1, 25, 3, 0.95, '', 'coral'],
  [between(chicane, at('Malmedy'), 0.60), -1, 25, 3, 0.85, '', 'coral'],
  [at('Malmedy') + 12, 1, 23, 3, 0.92, '', 'coral'],
  [between(at('Malmedy'), at('Bruxelles'), 0.56), 1, 24, 3, 0.90, '', 'gold'],
  [between(at('Bruxelles'), at('No Name'), 0.48), -1, 24, 3, 0.95, '', 'coral'],
  [at('No Name') + 25, 1, 24, 3, 0.85, '', 'mint'],
  [at('Pouhon') + 18, -1, 25, 3, 0.85, '', 'mint'],
  [between(at('Pouhon'), bends, 0.43), 1, 27, 3, 0.92, '', 'mint'],
  [between(bends, at('Stavelot'), 0.54), -1, 23, 2, 0.78, '', 'gold'],
  [returnStraight - 17, 1, 23, 3, 0.90, '', 'mint'],
  [returnStraight + 9, 1, 22, 3, 0.90, '', 'gold'],
  [between(returnStraight, at('Blanchimont'), 0.80), -1, 25, 3, 1.1, '', 'gold'],
  [between(at('Blanchimont'), at('Bus Stop'), 0.53), 1, 24, 3, 0.85, '', 'coral'],
  [between(at('Bus Stop'), track.length, 0.52), -1, 24, 3, 0.95, '', 'coral'],
  [between(at('Bus Stop'), track.length, 0.80), 1, 22, 3, 1.15, '', 'gold'],
];
let sections;

function footprintIsClear(spine, s, side, span, rows, offset, label) {
  const p = track.sample(s);
  const x = Math.cos(p.angle);
  const z = -Math.sin(p.angle);
  const dx = Math.sin(p.angle);
  const dz = Math.cos(p.angle);
  const front = rail + 1.75 + offset - (label ? 0.95 : 0.65);
  const back = front + rows * 0.82 + (label ? 1.35 : 0.75);
  const minClearance2 = (rail + 0.26) ** 2;
  for (let along = -span * 0.54; along <= span * 0.54 + 0.25; along += 2.1) {
    for (let depth = front; depth <= back + 0.30; depth += 1.35) {
      const ax = p.x + x * depth * side + dx * along;
      const az = p.z + z * depth * side + dz * along;
      if (spine.some(node => (node.x - ax) ** 2 + (node.z - az) ** 2 < minClearance2)) return false;
    }
  }
  return true;
}

function fit(spine, filled, bank, [origin, side, span, rows, offset, label, paint, shelter]) {
  for (const direction of [side, -side]) {
    for (const adjustment of [0, 6, -6, 12, -12]) {
      for (const extra of [0, 2.65, 5.25]) {
        const s = ((origin + adjustment) % track.length + track.length) % track.length;
        const clashes = filled.some(stand => {
          const gap = Math.abs(s - stand.s);
          return stand.side === direction && Math.min(gap, track.length - gap) < (span + stand.span) / 2 + 3;
        });
        if (clashes) continue;
        if (footprintIsClear(spine, s, direction, span, rows, offset + extra, label)) {
          return { s, side: direction, span, rows, offset: offset + extra, label, paint, bank, shelter };
        }
      }
    }
  }
  return null;
}

export function getCrowdSections() {
  if (!sections) {
    const spine = [];
    for (let s = 0; s < track.length; s += 2.5) spine.push(track.sample(s));
    sections = [];
    for (const [plan, bank] of [[seating, false], [banks, true]]) {
      for (const request of plan) {
        const result = fit(spine, sections, bank, request);
        if (result) sections.push(result);
      }
    }
  }
  return sections;
}
