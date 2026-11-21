import * as THREE from 'three';
import { track } from './track.js';
import { createCrowd } from './crowd.js';
import { getCrowdSections } from './crowd-sections.js';
import { wetRoadMaterial } from './weather.js';
import { addStandShelter } from './stand-shelters.js';
import { addTracksideFixtures, getTracksideLights } from './trackside-lights.js';
import { addSilverBirches } from './silver-birches.js';

const half = track.width / 2;
const railOffset = half + 3.83;
const tau = Math.PI * 2;
const worldYaw = s => Math.PI - track.sample(s).angle;
const materials = new Map();
const geometry = {
  box: new THREE.BoxGeometry(1, 1, 1),
  structure: new THREE.BoxGeometry(1, 1, 1),
  canopy: new THREE.CylinderGeometry(0.07, Math.SQRT1_2, 1, 4, 1),
  rock: new THREE.DodecahedronGeometry(1),
  sphere: new THREE.IcosahedronGeometry(1, 1),
  head: new THREE.SphereGeometry(1, 7, 4),
  tire: new THREE.CylinderGeometry(0.5, 0.5, 1, 12),
};
const turnAt = name => track.turns.find(turn => turn.name === name).s;
const eauRouge = turnAt('Eau Rouge');
const kemmel = turnAt('Kemmel Straight');
const lesCombes = turnAt('Les Combes');
const pouhon = turnAt('Pouhon');
const stavelot = turnAt('Stavelot');
const gantryHeight = 7.45;
const busStop = turnAt('Bus Stop');
const inkBlue = 0x122c3d;
const palettes = {
  grid: { curb: [0xff574c, 0xffbf36], curbBorder: 0xffdd85, service: 0xe87152, asphalt: 0x403f40 },
  forest: { curb: [0xf5bf4c, 0xf6ecb9], curbBorder: 0x58e7cc, service: 0x197d7d, asphalt: 0x3d3d3b },
  braking: { curb: [0xf94b48, 0xffe5cb], curbBorder: 0xf05e59, service: 0xac2841, asphalt: 0x3f3e40 },
  valley: { curb: [0x2ca9bc, 0xf5e5a3], curbBorder: 0x9be3d0, service: 0x638592, asphalt: 0x3e403f },
  finish: { curb: [0xec4c5a, 0xffd269], curbBorder: 0xf67f53, service: 0xd35d57, asphalt: 0x414040 },
};
function sector(distance) {
  const s = ((distance % track.length) + track.length) % track.length;
  if (s < turnAt('La Source') + (eauRouge - turnAt('La Source')) * 0.56 || s > track.length - 37) return 'grid';
  if (s < kemmel + 114) return 'forest';
  if (s < lesCombes + 68) return 'braking';
  if (s >= busStop - 74) return 'finish';
  return 'valley';
}
const flags = [0x28354b, 0xffd566, 0xec5358];
const cream = 0xf9f2d9;
const bannerBlue = 0x182e46;

function rng(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function colorMaterial(color) {
  if (!materials.has(color)) {
    materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.83 }));
  }
  return materials.get(color);
}

function lateral(s, offset, above = 0) {
  const pose = track.sample(s);
  return [
    pose.x + Math.cos(pose.angle) * offset,
    pose.y + above,
    -pose.z + Math.sin(pose.angle) * offset,
  ];
}

function sceneObjects(scene, { seating = false, amberFill = false, cellSize = 0 } = {}) {
  const batches = new Map();
  const matrix = new THREE.Object3D();
  const shelterFill = amberFill ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.83 }) : null;
  if (shelterFill) {
    shelterFill.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += (diffuseColor.rgb + vec3(0.06)) * vec3(0.55, 0.21, 0.045);');
    };
  }

  function instance(shape, color, position, dimensions, yaw = 0, pitch = 0, roll = 0) {
    const key = cellSize ? [shape, Math.floor(position[0] / cellSize), Math.floor(position[2] / cellSize)].join('/') : shape;
    if (!batches.has(key)) batches.set(key, { shape, matrices: [], tints: [] });
    matrix.position.set(...position);
    matrix.rotation.set(pitch, yaw, roll, 'YXZ');
    matrix.scale.set(...dimensions);
    matrix.updateMatrix();
    const batch = batches.get(key);
    batch.matrices.push(matrix.matrix.clone());
    batch.tints.push(color);
  }

  function flush() {
    for (const { shape, matrices, tints } of batches.values()) {
      const material = shelterFill ?? colorMaterial(0xffffff);
      const mesh = new THREE.InstancedMesh(geometry[shape], material, matrices.length);
      mesh.castShadow = shape === 'structure' || (!seating && (shape === 'box' || shape === 'canopy'));
      mesh.receiveShadow = true;
      const tint = new THREE.Color();
      matrices.forEach((value, index) => {
        mesh.setMatrixAt(index, value);
        mesh.setColorAt(index, tint.setHex(tints[index]));
      });
      scene.add(mesh);
    }
  }

  return { instance, flush };
}

function roadMesh(scene, bands, tracksideLights, carGlints) {
  const positions = [];
  const colors = [];
  const trackCoordinates = [];
  const faces = [];
  const tint = new THREE.Color();
  for (const {start, end, left, right, y, color, skew = 0, leftY = y, rightY = y, asphalt = false} of bands) {
    const slices = Math.max(1, Math.ceil((end - start) / 2.1));
    for (let index = 0; index <= slices; index++) {
      const s = start + (end - start) * index / slices;
      const first = positions.length / 3;
      const value = typeof color === 'function' ? color(s) : color;
      tint.setHex(value);
      for (const offset of [left, right]) {
        const distance = s + (offset === left ? -skew / 2 : skew / 2);
        positions.push(...lateral(distance, offset, offset === left ? leftY : rightY));
        trackCoordinates.push(distance, offset, Number(asphalt));
        colors.push(tint.r, tint.g, tint.b);
      }
      if (index) faces.push(first - 2, first - 1, first, first - 1, first + 1, first);
    }
  }
  const shape = new THREE.BufferGeometry();
  shape.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shape.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shape.setAttribute('trackCoordinate', new THREE.Float32BufferAttribute(trackCoordinates, 3));
  shape.setIndex(faces);
  shape.computeVertexNormals();
  const material = wetRoadMaterial(tracksideLights, carGlints);
  const mesh = new THREE.Mesh(shape, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function ground(scene, random) {
  const samples = [];
  const buckets = new Map();
  const bucketSize = 32;
  const counts = Math.ceil(track.length / 1.8);
  for (let index = 0; index < counts; index++) {
    const pose = track.sample(index / counts * track.length);
    pose.z *= -1;
    pose.s = index / counts * track.length;
    pose.index = index;
    samples.push(pose);
    const key = Math.floor(pose.x / bucketSize) + ',' + Math.floor(pose.z / bucketSize);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(pose);
  }
  const nearest = (x, z) => {
    let best = samples[0];
    let distance2 = Infinity;
    const bx = Math.floor(x / bucketSize);
    const bz = Math.floor(z / bucketSize);
    for (let row = bz - 2; row <= bz + 2; row++) {
      for (let column = bx - 2; column <= bx + 2; column++) {
        const bucket = buckets.get(column + ',' + row);
        if (!bucket) continue;
        for (const pose of bucket) {
          const d2 = (x - pose.x) ** 2 + (z - pose.z) ** 2;
          if (d2 < distance2) {
            distance2 = d2;
            best = pose;
          }
        }
      }
    }
    if (!Number.isFinite(distance2)) return { y: 0, s: 0, distance: Infinity };
    let y = best.y;
    for (const direction of [-1, 1]) {
      const other = samples[(best.index + direction + counts) % counts];
      const dx = other.x - best.x;
      const dz = other.z - best.z;
      const t = THREE.MathUtils.clamp(((x - best.x) * dx + (z - best.z) * dz) / (dx * dx + dz * dz), 0, 1);
      const gap = (x - best.x - t * dx) ** 2 + (z - best.z - t * dz) ** 2;
      if (gap < distance2) {
        distance2 = gap;
        y = THREE.MathUtils.lerp(best.y, other.y, t);
      }
    }
    return { y, s: best.s, distance: Math.sqrt(distance2) };
  };
  const rawHeight = (x, z, road) => {
    const banks = Math.sin(x * 0.032 + z * 0.02) * 7
      + Math.cos(z * 0.047 - x * 0.028) * 5
      + Math.sin(x * 0.1) * Math.cos(z * 0.08) * 1.4;
    const transition = THREE.MathUtils.smoothstep(road.distance, half + 5, 48);
    const local = Number.isFinite(road.distance) ? road.y : 0;
    const rolling = THREE.MathUtils.lerp(local, 0, THREE.MathUtils.smoothstep(road.distance, 48, 84));
    const roadClearance = 1.42 * (1 - THREE.MathUtils.smoothstep(road.distance, railOffset + 0.3, railOffset + 2.8));
    return rolling - 0.58 - roadClearance + transition * banks;
  };
  const minX = Math.min(...samples.map(p => p.x));
  const maxX = Math.max(...samples.map(p => p.x));
  const minZ = Math.min(...samples.map(p => p.z));
  const maxZ = Math.max(...samples.map(p => p.z));
  const pad = 85;
  const width = maxX - minX + 2 * pad;
  const depth = maxZ - minZ + 2 * pad;
  const cols = Math.ceil(width / 2.6) + 1;
  const rows = Math.ceil(depth / 2.6) + 1;
  const plane = new THREE.PlaneGeometry(width, depth, cols - 1, rows - 1);
  plane.rotateX(-Math.PI / 2);
  plane.translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const position = plane.attributes.position;
  const greens = new THREE.Color(0x526443);
  const yellow = new THREE.Color(0x83904d);
  const wooded = new THREE.Color(0x315948);
  const gorge = new THREE.Color(0x204d42);
  const warm = new THREE.Color(0x797347);
  let current = new Float32Array(position.count);
  let smoothed = new Float32Array(position.count);
  const softness = new Float32Array(position.count);
  const tint = new THREE.Color();
  const colors = [];
  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const road = nearest(x, z);
    current[index] = rawHeight(x, z, road);
    softness[index] = THREE.MathUtils.smoothstep(road.distance, railOffset + 1.25, railOffset + 19);
    const variation = 0.45 + 0.26 * Math.sin(x * 0.08 + z * 0.14)
      + 0.18 * Math.sin(x * 0.14 - z * 0.078) + random() * 0.14;
    const zone = sector(road.s);
    const deep = THREE.MathUtils.smoothstep(road.distance, 8, 38);
    const groveShade = 0.5 + Math.sin(x * 0.043 - z * 0.092) * Math.cos(z * 0.042 + x * 0.145) * 0.5;
    const sheltered = THREE.MathUtils.smoothstep(groveShade * 0.74 + variation * 0.26, 0.16, 0.87);
    const bankLight = THREE.MathUtils.lerp(0.43, 0.28, deep) + sheltered * 0.62;
    tint.copy(greens).lerp(yellow, variation).lerp(wooded, deep * 0.84);
    if (zone === 'forest') tint.lerp(gorge, 0.70 + deep * 0.16);
    if (zone === 'grid' || zone === 'braking') tint.lerp(warm, (1 - deep) * 0.53);
    tint.multiplyScalar(bankLight);
    colors.push(tint.r, tint.g, tint.b);
  }
  for (let pass = 0; pass < 6; pass++) {
    smoothed.set(current);
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const i = row * cols + col;
        const neighbors = (current[i - 1] + current[i + 1] + current[i - cols] + current[i + cols]) * 0.25;
        smoothed[i] = THREE.MathUtils.lerp(current[i], neighbors, softness[i] * 0.70);
      }
    }
    [current, smoothed] = [smoothed, current];
  }
  for (let i = 0; i < current.length; i++) position.setY(i, current[i]);
  function height(x, z, triangulated = false) {
    const gridX = THREE.MathUtils.clamp((x - minX + pad) / width * (cols - 1), 0, cols - 1.0001);
    const gridZ = THREE.MathUtils.clamp((z - minZ + pad) / depth * (rows - 1), 0, rows - 1.0001);
    const column = Math.floor(gridX);
    const row = Math.floor(gridZ);
    const i = row * cols + column;
    if (triangulated) {
      // Match the terrain mesh's split from the top-right to bottom-left vertex.
      const u = gridX - column;
      const v = gridZ - row;
      const diagonal = u * current[i + 1] + v * current[i + cols];
      return u + v <= 1
        ? diagonal + (1 - u - v) * current[i]
        : diagonal + (u + v - 1) * (current[i + cols + 1] - current[i + 1] - current[i + cols]);
    }
    const top = THREE.MathUtils.lerp(current[i], current[i + 1], gridX - column);
    const bottom = THREE.MathUtils.lerp(current[i + cols], current[i + cols + 1], gridX - column);
    return THREE.MathUtils.lerp(top, bottom, gridZ - row);
  }
  plane.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  plane.computeVertexNormals();
  // Mipmapped grass strokes break up the turf in Miniature view without
  // shimmering in the distance or adding thousands of individual blades.
  const grass = document.createElement('canvas');
  grass.width = grass.height = 128;
  const grassInk = grass.getContext('2d');
  grassInk.fillStyle = '#dddddd';
  grassInk.fillRect(0, 0, 128, 128);
  const blade = rng(72143);
  for (let i = 0; i < 1500; i++) {
    const x = blade() * 128;
    const y = blade() * 128;
    grassInk.strokeStyle = i % 3 ? '#c0c0c0' : '#f4f4f4';
    grassInk.beginPath();
    grassInk.moveTo(x, y);
    grassInk.lineTo(x + (blade() - 0.40) * 2.6, y - 1.2 - blade() * 3.2);
    grassInk.stroke();
  }
  const turf = new THREE.CanvasTexture(grass);
  turf.wrapS = turf.wrapT = THREE.RepeatWrapping;
  turf.repeat.set(width / 5, depth / 5);
  turf.anisotropy = 4;
  const terrain = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({ map: turf, vertexColors: true, roughness: 0.91 }));
  terrain.receiveShadow = true;
  scene.add(terrain);
  return { height, surfaceHeight: (x, z) => height(x, z, true), nearest, minX, maxX, minZ, maxZ };
}

function panel(scene, text, caption, position, width, height, yaw, { background = '#223e57', ink = '#fff2c8', arrow = false, flag = false, roll = 0 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = Math.max(192, Math.round(1024 * height / width));
  const ctx = canvas.getContext('2d');
  const h = canvas.height;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1024, h);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 7;
  ctx.strokeRect(15, 15, 994, h - 30);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = flag ? 540 : 512;
  ctx.fillStyle = ink;
  ctx.font = '900 ' + Math.min(h * (caption ? 0.52 : 0.67), text.length < 4 ? 360 : 170) + 'px system-ui';
  ctx.fillText(text, x, h * (caption ? 0.44 : 0.53), flag ? 740 : 890);
  if (caption) {
    ctx.font = '700 ' + Math.min(h * 0.19, 47) + 'px system-ui';
    ctx.fillText(caption, x, h * 0.79, 870);
  }
  if (flag) {
    ['#161d2b', '#ffcb4c', '#ef5157'].forEach((tone, index) => {
      ctx.fillStyle = tone;
      ctx.fillRect(38 + index * 25, h * 0.20, 25, h * 0.6);
    });
  }
  if (arrow) {
    ctx.fillStyle = '#ffd25e';
    for (const side of [60, 920]) {
      ctx.beginPath();
      ctx.moveTo(side, h * 0.26);
      ctx.lineTo(side + 42, h * 0.5);
      ctx.lineTo(side, h * 0.74);
      ctx.closePath();
      ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture }),
  );
  sign.position.set(...position);
  sign.rotation.set(0, yaw, roll, 'YXZ');
  scene.add(sign);
}

function signBridge(scene, s, title, caption, flag = false) {
  const angle = worldYaw(s);
  const width = 2 * (railOffset + 0.55);
  const header = new THREE.Group();
  const supports = sceneObjects(header);
  for (const side of [-1, 1]) {
    supports.instance('box', bannerBlue, lateral(s, side * railOffset, gantryHeight / 2), [0.49, gantryHeight + 1.04, 0.69], angle);
    supports.instance('box', cream, lateral(s, side * railOffset, 0.38), [0.67, 0.76, 0.92], angle);
  }
  supports.flush();
  const beam = new THREE.Mesh(geometry.box, colorMaterial(bannerBlue));
  beam.position.set(...lateral(s, 0, gantryHeight));
  beam.scale.set(width, 1.58, 0.65);
  beam.rotation.y = angle;
  beam.castShadow = true;
  beam.receiveShadow = true;
  header.add(beam);
  scene.add(header);
  panel(header, title, caption, lateral(s - 0.38, 0, gantryHeight), width - 0.22, 1.44, angle + Math.PI, { flag, background: flag ? '#292338' : '#143b4c', ink: flag ? '#ffe099' : '#aafee7' });
  panel(header, title, caption, lateral(s + 0.38, 0, gantryHeight), width - 0.22, 1.44, angle, { flag, background: flag ? '#292338' : '#143b4c', ink: flag ? '#ffe099' : '#aafee7' });
  const { x, y, z } = track.sample(s);
  return { header, s, angle, x, y, z: -z, width };
}

const standColors = {
  coral: { trim: 0xd96c58, seat: [0xd85c56, 0xe3ad58, 0x38495d], crowd: [0xec6754, 0xffbb65, 0x4eb7b2, 0xf1d3a4, 0xdd778a] },
  gold: { trim: 0xe6b75d, seat: [0xd8a84e, 0x3b6370, 0xe2d0a2], crowd: [0xefad54, 0x498c96, 0xf4d488, 0xdf6752, 0xe4e0b8] },
  mint: { trim: 0x54a39d, seat: [0x3d8c91, 0xd0b45f, 0x365362], crowd: [0x72d0bd, 0x248d86, 0xf1c25d, 0xe98265, 0xdddab5] },
};

function stand(scene, crowd, section, random, terrain, shelters) {
  const { s, side, span, label, offset: setback, rows, paint } = section;
  const { instance, flush } = sceneObjects(scene, { seating: true });
  const selection = standColors[paint];
  const angle = worldYaw(s);
  const depth = 0.82;
  const tierRise = 0.48;
  const offset = side * (railOffset + 1.75 + setback);
  const yaw = angle - side * Math.PI / 2;
  const front = lateral(s, offset);
  const baseY = Math.max(0.18, terrain.height(front[0], front[2]) - front[1] + 0.20);
  const grade = THREE.MathUtils.clamp((track.sample(s + span / 2).y - track.sample(s - span / 2).y) / span, -0.21, 0.21);
  const pitch = -Math.atan(grade);
  const step = (along, across, up) => {
    const position = lateral(s, across, up + baseY + grade * along);
    position[0] += along * Math.sin(angle);
    position[2] += along * Math.cos(angle);
    return position;
  };
  const seatPitch = 0.66;
  const aisles = span > 27 ? [-span / 5, span / 5] : span > 17 ? [0] : [];
  const seats = [];
  for (let row = 0; row < rows; row++) {
    const base = row * tierRise;
    const back = offset + side * row * depth;
    const concrete = row % 2 ? 0xcbb99c : 0xa8998b;
    instance('structure', concrete, step(0, back, base + 0.20), [0.88, 0.44, span], angle, pitch);
    const panels = Math.ceil(span / 2.8);
    const panelSpan = span / panels;
    for (let bearing = 0; bearing < panels; bearing++) {
      const along = (bearing + 0.5) * panelSpan - span / 2;
      const foot = step(along, back, base + 0.18);
      let floor = Infinity;
      for (const run of [-0.49, 0.49]) {
        for (const cross of [-0.42, 0.42]) {
          const corner = step(along + run * panelSpan, back + cross, 0);
          floor = Math.min(floor, terrain.height(corner[0], corner[2]));
        }
      }
      const bottom = floor - 0.24;
      const top = foot[1] - Math.abs(grade) * panelSpan * 0.5 + 0.08;
      if (top <= bottom + 0.06) continue;
      foot[1] = (top + bottom) * 0.5;
      instance('structure', concrete, foot, [0.87, top - bottom, panelSpan + 0.02], angle);
    }
    instance('box', 0xe1cdb0, step(0, back - side * 0.42, base + 0.44), [0.055, 0.075, span], angle, pitch);
    for (const aisle of aisles) {
      instance('box', 0xdfc29e, step(aisle, back - side * depth * 0.26, base + 0.21), [0.46, 0.14, 1.03], angle, pitch);
      for (const end of [-0.39, 0.39]) {
        instance('box', 0x344550, step(aisle + end, back + side * 0.18, base + 0.75), [0.055, 0.68, 0.055], angle);
      }
    }
    for (let seat = 0; seat < Math.floor(span / seatPitch); seat++) {
      const part = seat * seatPitch - span * 0.5 + seatPitch * 0.55;
      if (aisles.some(aisle => Math.abs(part - aisle) < 0.64)) continue;
      const banner = Math.floor(seat / 8 + row / 3) % selection.seat.length;
      instance('box', selection.seat[banner], step(part, back, base + 0.53), [0.50, 0.18, 0.54], angle, pitch);
      if (random() > 0.94) continue;
      const sectionHue = Math.floor(seat / 5 + row / 2) % selection.crowd.length;
      const fan = selection.crowd[random() < 0.63 ? sectionHue : Math.floor(random() * selection.crowd.length)];
      const skin = [0xe9b080, 0xc78b63, 0xf4cc9c, 0x916243][(seat + row) % 4];
      const height = (random() - 0.5) * 0.088;
      instance('box', fan, step(part, back, base + 0.80 + height), [0.34, 0.46, 0.35], angle);
      instance('head', skin, step(part, back, base + 1.125 + height), [0.142, 0.15, 0.14]);
      instance('box', selection.seat[banner], step(part, back + side * 0.03, base + 1.249 + height), [0.24, 0.075, 0.27], angle);
      for (const leg of [-0.089, 0.089]) {
        instance('box', 0x354859, step(part + leg, back - side * 0.16, base + 0.625), [0.32, 0.12, 0.14], angle);
        instance('box', 0x354859, step(part + leg, back - side * 0.29, base + 0.51), [0.14, 0.22, 0.14], angle);
      }
      if (seat % 3 === 0 || (row < 2 && seat % 2 === 0)) {
        seats.push({ position: step(part, back, base + 0.94 + height), paint: fan, row });
      }
    }
  }
  crowd.addStand(s, side, angle, seats);
  const frontEdge = offset - side * 0.56;
  instance('box', 0x263d50, step(0, frontEdge, 0.29), [0.19, 0.56, span + 0.13], angle, pitch);
  instance('box', selection.trim, step(0, frontEdge, 0.59), [0.16, 0.10, span + 0.15], angle, pitch);
  for (let end = -span / 2 + 0.15; end < span / 2 + 0.1; end += 2.8) {
    instance('box', 0x425363, step(end, frontEdge, 0.88), [0.075, 0.48, 0.075], angle);
  }
  instance('box', 0x586875, step(0, frontEdge, 1.13), [0.060, 0.060, span], angle, pitch);
  const baseBack = offset + side * (rows - 1) * depth;
  for (const edge of [-1, 1]) {
    const along = edge * (span * 0.5 - 0.1);
    for (let row = 1; row < rows; row++) {
      const base = row * tierRise;
      const back = offset + side * row * depth;
      instance('box', 0x3d5060, step(along, back, base + 0.89), [0.07, 0.83, 0.08], angle);
      instance('box', 0x3d5060, step(along, back - side * depth * 0.50, base + 1.12), [0.98, 0.085, 0.085], angle, 0, side * 0.53);
    }
  }
  if (label) {
    const roof = addStandShelter(scene, instance, terrain, section, step, offset, baseBack, angle);
    shelters.push({ s, span, roof });
    panel(roof.parent, label, '', step(0, offset - side * 0.90, (rows - 1) * tierRise + 2.25),
      Math.min(span * 0.42, 10.5), 0.37, yaw + Math.PI,
      { background: '#48332c', ink: '#ffdcac', roll: Math.atan(-side * grade) });
  }
  flush();
}
function fanBank(scene, crowd, section, random, terrain, shelters) {
  const { s, span, side, offset: setback, rows, paint, shelter } = section;
  const { instance, flush } = sceneObjects(scene, { seating: true, amberFill: Boolean(shelter) });
  const selection = standColors[paint];
  const seats = [];
  const pitch = 2.20;
  const offset = side * (railOffset + 2.15 + setback);
  const back = offset + side * (rows - 1) * 1.17;
  for (let part = -span / 2 + pitch * 0.5; part < span / 2; part += pitch) {
    const sample = s + part;
    const yaw = worldYaw(sample);
    let lastLevel = -Infinity;
    for (let row = 0; row < rows; row++) {
      const across = offset + side * row * 1.17;
      const base = lateral(sample, across);
      if (terrain.nearest(base[0], base[2]).distance < railOffset + 1.0) continue;
      const floor = terrain.height(base[0], base[2]);
      const level = Math.max(floor + 0.23, base[1] - 0.18, lastLevel + 0.26);
      lastLevel = level;
      const plank = selection.seat[(row + Math.floor((part + span / 2) / 4.4)) % 3];
      const bottom = floor - 0.17;
      const top = level - 0.09;
      const feet = [base[0], (bottom + top) * 0.5, base[2]];
      instance('box', 0x64715b, feet, [0.94, top - bottom, pitch * 0.94], yaw);
      instance('box', plank, [base[0], level, base[2]], [1.01, 0.19, pitch * 0.98], yaw);
      for (let seat = 0; seat < 3; seat++) {
        if (random() > 0.96) continue;
        const position = lateral(sample + (seat - 1) * 0.58, across);
        const [x, , z] = position;
        const shirt = selection.crowd[(seat + row + Math.floor((part + span / 2) / 4.4)) % 5];
        const skin = [0xe9b080, 0xbd865e, 0xf7d1a5, 0xa87957][(seat + row) % 4];
        const slight = (random() - 0.5) * 0.07;
        instance('box', shirt, [x, level + 0.30 + slight, z], [0.27, 0.37, 0.30], yaw);
        instance('head', skin, [x, level + 0.58 + slight, z], [0.13, 0.14, 0.132]);
        const shoes = lateral(sample + (seat - 1) * 0.58, across - side * 0.23);
        instance('box', 0x314956, [shoes[0], level + 0.10, shoes[2]], [0.32, 0.14, 0.25], yaw);
        if (seat === 1) seats.push({ position: [x, level + 0.43 + slight, z], paint: shirt, row });
      }
    }
    if ((Math.floor((part + span / 2) / pitch) % 4) === 0) {
      const paint = flags[Math.abs(Math.round(part * 0.39)) % flags.length];
      flagPole(instance, sample + 0.24, side * (railOffset + 1.65), paint, 2.25);
    }
  }
  crowd.addStand(s, side, worldYaw(s), seats);
  if (shelter) {
    const canopy = sceneObjects(scene, { seating: true });
    const step = (along, across, up) => {
      const sample = s + along;
      const p = lateral(sample, across);
      const far = lateral(sample, back);
      p[1] = Math.max(p[1] + (rows - 1) * 0.26, terrain.height(far[0], far[2]) + 0.30) + up;
      return p;
    };
    const roof = addStandShelter(scene, canopy.instance, terrain, { ...section, label: shelter },
      step, offset, back, worldYaw(s));
    canopy.flush();
    shelters.push({ s, span, roof });
  }
  flush();
}

function flagPole(instance, s, offset, color, height = 6) {
  const angle = worldYaw(s);
  instance('box', cream, lateral(s, offset, height / 2), [0.10, height, 0.10], angle);
  const flap = angle - 0.55;
  const origin = lateral(s, offset, height - 0.58);
  const colors = color === flags[0] ? flags : [color, cream, color];
  for (const [index, stripe] of colors.entries()) {
    const distance = (index + 0.5) * 0.52;
    const position = [origin[0] + Math.sin(flap) * distance, origin[1], origin[2] + Math.cos(flap) * distance];
    instance('box', stripe, position, [0.075, 0.93, 0.52], flap);
  }
}

function landscape(scene, instance, field, random) {
  const occupied = getCrowdSections().map(({ s, side, span, rows, offset, bank }) => {
    const origin = lateral(s, 0);
    const angle = worldYaw(s);
    const tangentX = Math.sin(angle);
    const tangentZ = Math.cos(angle);
    const end = railOffset + 2.3 + offset + rows * (bank ? 1.17 : 0.82);
    return { origin, tangentX, tangentZ, side, span: span / 2 + 3.3, end };
  });
  const insideSeating = (x, z, margin) => occupied.some(({ origin, tangentX, tangentZ, side, span, end }) => {
    const dx = x - origin[0];
    const dz = z - origin[2];
    const across = side * (-tangentZ * dx + tangentX * dz);
    return across >= railOffset - (margin ?? 0.5) && across <= end + (margin ?? 2.4)
      && Math.abs(tangentX * dx + tangentZ * dz) <= span + (margin ?? 0);
  });
  const treeRandom = rng(60580);
  const trees = [];
  const tree = (x, z, height, near, gap) => {
    const road = field.nearest(x, z);
    const gridGap = Math.min(road.s, track.length - road.s);
    if (road.distance < railOffset + 5.2 || (gridGap < 57 && road.distance < railOffset + 10)) return;
    if (insideSeating(x, z, 4.3) || trees.some(tree => (x - tree.x) ** 2 + (z - tree.z) ** 2 < gap ** 2)) return;
    trees.push({ x, z, height, near, width: 0.74 + treeRandom() * 0.31, yaw: treeRandom() * tau,
      variant: Math.floor(treeRandom() * 4) });
  };
  for (const side of [-1, 1]) {
    for (let s = 8; s < track.length; s += 7.5 + treeRandom() * 7) {
      const offset = railOffset + 7.8 + treeRandom() ** 1.8 * 17.0;
      const [x, , z] = lateral(s, side * offset);
      tree(x, z, 4.8 + treeRandom() * 2.55, true, 5.1);
      if (treeRandom() < 0.44) {
        const [px, , pz] = lateral(s + 2.1 + treeRandom() * 1.2, side * (offset + 1.4 + treeRandom() * 1.1));
        tree(px, pz, 4.0 + treeRandom() * 2.5, true, 2.4);
      }
    }
  }
  for (let i = 0; i < 1430; i++) {
    const x = THREE.MathUtils.lerp(field.minX - 46, field.maxX + 46, treeRandom());
    const z = THREE.MathUtils.lerp(field.minZ - 46, field.maxZ + 46, treeRandom());
    const distance = field.nearest(x, z).distance;
    const brush = Math.sin(x * 0.114 + z * 0.068)
      + 0.75 * Math.sin(z * 0.122 - x * 0.062) + 0.56 * Math.sin((x + z) * 0.032);
    if (distance < railOffset + 19 || brush < 0.12) continue;
    tree(x, z, 4.5 + treeRandom() * 3.9, false, 5.3);
  }
  addSilverBirches(scene, trees, field, (x, z) => field.nearest(x, z).distance > railOffset + 1.7
    && !insideSeating(x, z, 3.1), treeRandom);
  for (let i = 0; i < 900; i++) {
    const s = random() * track.length;
    const offset = (random() > 0.5 ? 1 : -1) * (half + 5 + random() * 23);
    const [x, , z] = lateral(s, offset);
    if (field.nearest(x, z).distance < half + 4.5 || insideSeating(x, z)) continue;
    const y = field.height(x, z);
    const h = random();
    instance('rock', h > 0.25 ? 0x6ba451 : 0xadab7d, [x, y + 0.13, z], [0.17 + h * 0.42, 0.19 + h * 0.41, 0.26 + h * 0.29], random() * tau);
    if (h > 0.78) {
      const flower = random() > 0.49 ? 0xf7d156 : 0xf5e9d5;
      for (let petal = -1; petal <= 1; petal++) {
        instance('sphere', flower, [x + petal * 0.14, y + 0.39 + random() * 0.3, z], [0.09, 0.07, 0.09]);
      }
    }
  }

  const hills = [0x34787d, 0x478189, 0x649a94, 0x56958d];
  const cx = (field.minX + field.maxX) / 2;
  const cz = (field.minZ + field.maxZ) / 2;
  const reach = Math.hypot(field.maxX - field.minX, field.maxZ - field.minZ) / 2 + 74;
  for (let i = 0; i < 28; i++) {
    const yaw = i * tau / 28;
    const range = reach + 170 * random();
    instance('sphere', hills[i % hills.length], [cx + Math.cos(yaw) * range, -33, cz + Math.sin(yaw) * range], [78 + random() * 81, 47 + random() * 53, 82 + random() * 57], random() * tau);
  }
}

function paddock(scene, instance) {
  const booths = [
    [6, -1, 0xeb5f55, 0xffdb79],
    [12.6, -1, 0xffc956, 0xf7ecd0],
    [19.2, -1, 0x378d9a, 0x9ee2d8],
    [26, 1, 0xed7761, 0xfece6c],
    [20.8, 1, 0x397d89, 0xa1ddcd],
  ];
  for (const [s, side, fabric, trim] of booths) {
    const offset = side * (railOffset + 4.2);
    const yaw = worldYaw(s);
    instance('box', 0xe2b887, lateral(s, offset, -0.12), [7.1, 0.18, 5.3], yaw);
    instance('canopy', fabric, lateral(s, offset, 3.60), [5.7, 1.56, 5.1], yaw + Math.PI / 4);
    instance('box', trim, lateral(s, offset, 2.89), [5.69, 0.27, 5.08], yaw);
    instance('box', fabric, lateral(s, offset + side * 2.65, 1.4), [0.15, 2.67, 4.9], yaw);
    instance('box', 0x33616a, lateral(s, offset - side * 1.31, 0.56), [1.08, 1.1, 3.71], yaw);
    instance('box', cream, lateral(s, offset - side * 1.31, 1.14), [1.33, 0.12, 4.03], yaw);
    for (const edge of [-2.67, 2.67]) {
      for (const fore of [-2.42, 2.42]) {
        instance('box', cream, lateral(s + fore, offset + edge, 1.52), [0.13, 3.04, 0.13], yaw);
      }
    }
    flagPole(instance, s, offset + side * 0.6, flags[0], 5.5);
  }
  const balloon = lateral(-35, 20, 23);
  const skin = [0x1d566b, 0xffce63, 0xf9e9cb, 0x46a09c, 0xed5a5e, 0xffce63, 0xf9e9cb, 0x46a09c];
  for (const [index, paint] of skin.entries()) {
    const shape = new THREE.SphereGeometry(1, 7, 18, index * tau / 8, tau / 8, 0, Math.PI * 0.88);
    const vertices = shape.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const y = vertices.getY(i);
      const taper = 1 - Math.max(0, -y) * 0.33;
      vertices.setXYZ(i, vertices.getX(i) * taper, y, vertices.getZ(i) * taper);
    }
    shape.computeVertexNormals();
    const mesh = new THREE.Mesh(shape, colorMaterial(paint));
    mesh.position.set(...balloon);
    mesh.rotation.y = 0.45;
    mesh.scale.set(5.78, 6.3, 5.78);
    scene.add(mesh);
  }
  instance('box', 0xaa724c, [balloon[0], balloon[1] - 8.1, balloon[2]], [1.6, 1.2, 1.6]);
  instance('box', 0xddad71, [balloon[0], balloon[1] - 7.5, balloon[2]], [1.75, 0.17, 1.75]);
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.7, 0.7]) {
      instance('box', 0x8d6958, [balloon[0] + x, balloon[1] - 6.6, balloon[2] + z], [0.055, 1.82, 0.055]);
    }
  }
}

function tracksideSculpture(instance) {
  const lookout = pouhon + 16;
  const yaw = worldYaw(lookout);
  const side = track.sample(lookout).curvature > 0 ? -1 : 1;
  const edge = side * (railOffset + 5.5);
  const deck = (along, across, y) => {
    const p = lateral(lookout, across, y);
    p[0] += along * Math.sin(yaw);
    p[2] += along * Math.cos(yaw);
    return p;
  };
  instance('box', 0x25486a, deck(0, edge, 1.68), [6.72, 5.35, 14.8], yaw);
  instance('box', 0x53a5a9, deck(0, edge - side * 3.10, 2.30), [0.69, 3.44, 13.5], yaw);
  instance('box', 0x183448, deck(0, edge, 4.32), [7.02, 0.48, 15.9], yaw);
  instance('box', 0xf6cc6a, deck(0, edge - side * 3.57, 4.43), [0.29, 0.33, 15.98], yaw);
  instance('box', 0x4c9a9c, deck(0, edge + side * 0.1, 7.19), [8.12, 0.38, 16.91], yaw, 0, side * -0.14);
  instance('box', 0x183448, deck(0, edge - side * 3.96, 6.65), [0.19, 0.43, 16.94], yaw);
  instance('box', 0xebe7c6, deck(0, edge - side * 3.49, 5.17), [0.17, 0.10, 15.7], yaw);
  for (let x = -6.9; x <= 7; x += 2.3) {
    instance('box', 0xf07350, deck(x, edge - side * 3.17, 5.54), [0.27, 2.65, 0.30], yaw, 0, side * -0.16);
    instance('box', 0xe7d3a5, deck(x, edge - side * 3.52, 4.86), [0.11, 0.57, 0.11], yaw);
    instance('box', 0xf0cc75, deck(x + 0.73, edge - side * 2.06, 4.89), [0.41, 0.72, 0.36], yaw);
    instance('sphere', 0xdc9469, deck(x + 0.73, edge - side * 2.07, 5.37), [0.17, 0.18, 0.17], yaw);
    flagPole(instance, lookout + x, edge + side * 2.1, flags[(Math.round(x / 2.3) + 6) % 3], 8.28);
  }

  // Sculpted turn markers, grouped from low to high along the approach.
  const blanchimont = turnAt('Blanchimont');
  for (const [location, shades, invert] of [
    [blanchimont + 1, [0xf76557, 0xfabc63], 1],
    [stavelot + 3, [0x4bb5b5, 0x9dedcf], -1],
  ]) {
    const side = track.sample(location).curvature > 0 ? -1 : 1;
    for (let i = 0; i < 3; i++) {
      const s = location + i * 3.35;
      const angle = worldYaw(s);
      const edge = side * (railOffset + 2.8 + i * 0.42);
      const base = 1.1 + i * 0.31;
      instance('box', 0x243747, lateral(s, edge, 0.47), [3.17, 1.55, 1.62], angle);
      for (const branch of [-1, 1]) {
        const height = base + 1.22 + branch * 0.63;
        const position = lateral(s, edge, height);
        instance('box', shades[i % 2], position, [0.78, 1.99 + i * 0.39, 0.63], angle, 0, branch * invert * 0.655);
      }
    }
  }
}

function courseLandmarks(scene, instance) {
  tracksideSculpture(instance);
  for (const [s, name, subtitle, background, ink] of [
    [eauRouge - 13, 'EAU ROUGE', 'ARDENNES VALLEY', '#153b4a', '#65f0d3'],
    [lesCombes - 20, 'LES COMBES', 'BRAKE  /  RIGHT-LEFT', '#66243a', '#ffdbb4'],
    [pouhon - 9, 'POUHON', 'DOUBLE APEX', '#204858', '#c5efd4'],
    [stavelot - 10, 'STAVELOT', 'FOREST EXIT', '#22394d', '#f8c473'],
    [busStop - 18, 'BUS STOP', 'FINAL CHICANE', '#4b273d', '#ffce9f'],
  ]) {
    const side = track.sample(s).curvature > 0 ? -1 : 1;
    const edge = side * (railOffset + 2.15);
    const angle = worldYaw(s);
    instance('box', inkBlue, lateral(s, edge, 1.15), [0.77, 2.9, 1.02], angle);
    instance('box', inkBlue, lateral(s, edge, 2.93), [4.80, 1.66, 0.33], angle);
    panel(scene, name, subtitle, lateral(s - 0.19, edge, 2.95), 4.64, 1.48, angle + Math.PI, { background, ink });
  }
  const crest = turnAt('Raidillon') + 45;
  for (const side of [-1, 1]) {
    const edge = side * (railOffset + 0.58);
    for (let i = 0; i < 4; i++) {
      const s = crest + 3.2 * i;
      const skew = side * 0.11;
      const h = 2.5 + 0.5 * i;
      const a = worldYaw(s);
      instance('box', 0x143642, lateral(s, edge, h * 0.47), [0.62, h, 1.56], a, 0, skew);
      instance('box', 0x48d6b7, lateral(s - 0.78, edge, h * 0.57), [0.38, h * 0.66, 0.12], a, 0, skew);
      instance('box', 0xf7c76c, lateral(s - 0.84, edge, h * 0.84), [0.37, 0.17, 0.14], a);
    }
    for (const [s, span, base, accent] of [
      [lesCombes - 55, 38, 0x672a3f, 0xff6053],
      [pouhon - 9, 24, 0x144f61, 0x5ac8b9],
      [busStop - 12, 26, 0x492f44, 0xf55a56],
    ]) {
      for (let j = -span / 2; j <= span / 2; j += 2.05) {
        const mark = s + j;
        const angle = worldYaw(mark);
        const edge = side * (railOffset + 0.31);
        instance('box', base, lateral(mark, edge, 0.42), [0.53, 1.17, 2.12], angle);
        instance('box', accent, lateral(mark, edge, 0.99), [0.53, 0.15, 2.13], angle);
        if (Math.round(j / 2) % 2 === 0) {
          instance('box', cream, lateral(mark, edge - side * 0.28, 0.56), [0.08, 0.31, 0.56], angle, 0, side * 0.23);
        }
      }
    }
  }
}

function infrastructure(scene, instance, crowd, random, field, shelters) {
  courseLandmarks(scene, instance);
  paddock(scene, instance);
  const grid = track.gridS;
  const startGate = signBridge(scene, grid + 17, 'LITTLE BOX GRAND PRIX', 'SPA-FRANCORCHAMPS  /  BELGIUM', true);
  const at = name => track.turns.find(turn => turn.name === name).s;
  const kemmelGate = signBridge(scene, at('Kemmel Straight') + 22, 'KEMMEL', 'SPA-FRANCORCHAMPS');
  for (const section of getCrowdSections()) {
    if (section.bank) fanBank(scene, crowd, section, random, field, shelters);
    else stand(scene, crowd, section, random, field, shelters);
  }
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) flagPole(instance, grid + 29 + i * 9, side * (railOffset + 0.90), flags[i % flags.length]);
  }
  for (const [name, text, delta] of [
    ['La Source', 'LA SOURCE', 19],
    ['Raidillon', 'RAIDILLON', 13],
    ['Bruxelles', 'BRUXELLES', 13],
    ['Les Fagnes', 'LES FAGNES', 13],
    ['Blanchimont', 'BLANCHIMONT', 16],
  ]) {
    const s = at(name) - delta;
    const angle = worldYaw(s);
    const offset = railOffset + 2.31;
    for (const d of [-0.8, 0.8]) {
      instance('box', cream, lateral(s, offset + d, 1.51), [0.12, 3.03, 0.12], angle);
    }
    instance('box', 0x2a545f, lateral(s, offset, 2.80), [3.05, 0.94, 0.19], angle);
    panel(scene, text, '', lateral(s - 0.13, offset, 2.8), 2.96, 0.90, angle + Math.PI, {background: '#163d4a', ink: '#aefbe9'});
    panel(scene, text, '', lateral(s + 0.13, offset, 2.8), 2.96, 0.90, angle, {background: '#163d4a', ink: '#aefbe9'});
  }
  for (const { label, s } of track.brakingBoards) {
    const yaw = worldYaw(s);
    const offset = -(railOffset + 1.03);
    for (const side of [-1, 1]) {
      const x = offset * side;
      instance('box', flagColor(label), lateral(s, x, 1.56), [0.18, 3.2, 0.18], yaw);
      panel(scene, String(label), '', lateral(s - 0.16, x, 2.74), 1.74, 1.03, yaw + Math.PI, {background: label === 50 ? '#6b2338' : '#fff1cc', ink: label === 50 ? '#ffd9ba' : '#522b38'});
    }
  }

  for (let i = 0; i < 6; i++) {
    const s = grid + 29 + i * 7;
    const yaw = worldYaw(s);
    const x = half + 8.7;
    const paint = i % 3 === 1 ? 0xe3584d : 0xffbb60;
    instance('box', 0xe8bd9a, lateral(s, x, 2.0), [6.5, 4.0, 6.85], yaw);
    instance('box', 0x2b4d5b, lateral(s, x - 3.27, 1.5), [0.13, 2.75, 5.97], yaw);
    instance('box', paint, lateral(s, x - 3.29, 3.44), [0.23, 0.73, 6.83], yaw);
    instance('box', 0x256d7d, lateral(s, x, 4.04), [7.15, 0.26, 6.84], yaw);
    for (let row = -1; row <= 1; row++) {
      instance('box', 0x7aaabb, lateral(s + row * 1.88, x - 3.36, 1.64), [0.10, 1.84, 1.64], yaw);
    }
  }

  for (const name of ['La Source', 'Eau Rouge', 'Raidillon', 'Les Combes', 'Bruxelles', 'Pouhon', 'Les Fagnes', 'Bus Stop']) {
    const atCorner = at(name);
    const side = track.sample(atCorner).curvature > 0 ? -1 : 1;
    for (let along = -9; along <= 9; along += 0.69) {
      const s = atCorner + along;
      const yaw = worldYaw(s);
      const x = side * (railOffset + 0.33);
      instance('tire', 0x3b4854, lateral(s, x, 0.10), [0.76, 0.57, 0.76], yaw);
      instance('tire', 0x455766, lateral(s, x, 0.51), [0.73, 0.39, 0.73], yaw);
    }
  }

  for (let i = 0; i < Math.ceil(track.length / 4); i++) {
    const s = i * 4;

    const grade = (track.sample(s + 1).y - track.sample(s - 1).y) / 2;
    for (const side of [-1, 1]) {
      const offset = side * railOffset;
      instance('box', 0x233945, lateral(s, offset, 0.64), [0.15, 0.79, 0.15], worldYaw(s));
      instance('box', 0x9fabb0, lateral(s + 2, offset, 0.68), [0.16, 0.24, 4.20], worldYaw(s + 2), -Math.atan(grade));
      instance('box', 0x36525e, lateral(s + 2, offset, 0.45), [0.12, 0.09, 4.21], worldYaw(s + 2), -Math.atan(grade));
    }
  }
  return [startGate, kemmelGate];
}

function numberGrid(scene) {
  const geometry = new THREE.PlaneGeometry(0.68, 0.8);
  geometry.rotateX(-Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.font = '850 105px system-ui';
    ctx.fillStyle = '#fff1ba';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), 64, 67);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    const number = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }));
    const s = -5 - i * 7 + 1.54;
    const side = i % 2 === 0 ? -1 : 1;
    number.position.set(...lateral(s, side * 0.53, 0.056));
    const grade = (track.sample(s + 1).y - track.sample(s - 1).y) / 2;
    number.rotation.set(Math.atan(grade), worldYaw(s) + Math.PI, 0, 'YXZ');
    scene.add(number);
  }
}

function raceSignals(scene, instance, startGate) {
  const s = 17;
  const yaw = worldYaw(s);
  const overhead = sceneObjects(startGate.header);
  overhead.instance('box', 0x192c3e, lateral(s, 0, gantryHeight - 1.22), [6.32, 0.86, 0.62], yaw);
  const lamps = [];
  const lens = new THREE.SphereGeometry(1, 18, 9);
  const dark = new THREE.MeshBasicMaterial({ color: 0x482731 });
  const lit = new THREE.MeshBasicMaterial({ color: 0xff4137, toneMapped: false });
  const coreDim = new THREE.MeshBasicMaterial({ color: 0x5f3339 });
  const coreLit = new THREE.MeshBasicMaterial({ color: 0xff6a4c, toneMapped: false });
  for (let i = 0; i < 5; i++) {
    const offset = (i - 2) * 1.10;
    overhead.instance('box', 0x30465a, lateral(s - 0.31, offset, gantryHeight - 1.23), [0.91, 0.68, 0.13], yaw);
    const lamp = new THREE.Mesh(lens, dark);
    lamp.position.set(...lateral(s - 0.49, offset, gantryHeight - 1.24));
    lamp.rotation.y = yaw;
    lamp.scale.set(0.335, 0.327, 0.123);
    startGate.header.add(lamp);
    const core = new THREE.Mesh(lens, coreDim);
    core.position.set(...lateral(s - 0.60, offset, gantryHeight - 1.22));
    core.rotation.y = yaw;
    core.scale.set(0.162, 0.151, 0.024);
    startGate.header.add(core);
    lamps.push({ lamp, core });
  }

  overhead.flush();
  const marshalS = 1.75;
  const marshalOffset = railOffset + 1.3;
  const marshalYaw = worldYaw(marshalS) + Math.PI;
  instance('box', 0x365166, lateral(marshalS, marshalOffset, 0.66), [1.55, 2.42, 1.39], marshalYaw);
  instance('box', 0xd8dfcc, lateral(marshalS, marshalOffset, 1.92), [1.79, 0.18, 1.64], marshalYaw);
  for (const edge of [-0.8, 0.8]) {
    instance('box', cream, lateral(marshalS, marshalOffset + edge, 2.36), [0.08, 0.88, 0.08], marshalYaw);
  }
  instance('box', 0xf0a856, lateral(marshalS, marshalOffset, 2.61), [1.63, 0.16, 0.14], marshalYaw);

  const marshal = new THREE.Group();
  marshal.position.set(...lateral(marshalS, marshalOffset, 2.03));
  marshal.rotation.y = marshalYaw;
  scene.add(marshal);
  const limbGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sleeve = colorMaterial(0xf07e48);
  const glove = colorMaterial(0xf9f4e1);
  const coveralls = colorMaterial(0x263b58);
  const addPiece = (parent, material, position, dimensions, rotation = 0) => {
    const piece = new THREE.Mesh(limbGeometry, material);
    piece.position.set(...position);
    piece.scale.set(...dimensions);
    piece.rotation.z = rotation;
    piece.castShadow = true;
    parent.add(piece);
  };
  for (const foot of [-0.14, 0.14]) {
    addPiece(marshal, coveralls, [foot, 0.254, 0], [0.20, 0.51, 0.25]);
    addPiece(marshal, colorMaterial(0x252f3b), [foot, 0.057, 0.05], [0.24, 0.11, 0.33]);
  }
  addPiece(marshal, sleeve, [0, 0.739, 0], [0.47, 0.55, 0.29]);
  addPiece(marshal, glove, [0, 0.735, 0.154], [0.46, 0.084, 0.017]);
  addPiece(marshal, sleeve, [0.291, 0.745, 0], [0.147, 0.45, 0.16], -0.18);
  const head = new THREE.Mesh(geometry.sphere, colorMaterial(0xe2a674));
  head.position.y = 1.160;
  head.scale.set(0.198, 0.218, 0.193);
  marshal.add(head);
  const cap = new THREE.Mesh(geometry.sphere, sleeve);
  cap.position.y = 1.305;
  cap.scale.set(0.225, 0.104, 0.210);
  marshal.add(cap);
  addPiece(marshal, sleeve, [0, 1.244, 0.154], [0.29, 0.063, 0.21]);

  const arm = new THREE.Group();
  arm.position.set(-0.20, 0.93, 0.01);
  marshal.add(arm);
  addPiece(arm, sleeve, [-0.195, 0.04, 0.02], [0.48, 0.18, 0.19], -0.20);
  addPiece(arm, glove, [-0.43, 0.075, 0.02], [0.153, 0.165, 0.159]);
  addPiece(arm, colorMaterial(0xdec697), [-0.43, 0.44, 0.023], [0.065, 1.47, 0.065]);

  const flagWidth = 1.95;
  const flagGeometry = new THREE.PlaneGeometry(flagWidth, 1.14, 10, 6);
  const green = new THREE.MeshStandardMaterial({ color: 0x41ed77, side: THREE.DoubleSide, roughness: 0.96 });
  const flagCanvas = document.createElement('canvas');
  flagCanvas.width = 128;
  flagCanvas.height = 80;
  const ctx = flagCanvas.getContext('2d');
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 8; column++) {
      ctx.fillStyle = (row + column) % 2 ? '#12171e' : '#fff1ce';
      ctx.fillRect(column * 16, row * 16, 16, 16);
    }
  }
  const checkers = new THREE.CanvasTexture(flagCanvas);
  checkers.colorSpace = THREE.SRGBColorSpace;
  const checkered = new THREE.MeshStandardMaterial({ map: checkers, side: THREE.DoubleSide, roughness: 1 });
  const flag = new THREE.Mesh(flagGeometry, green);
  flag.position.set(-0.43 - flagWidth / 2, 0.726, 0.026);
  arm.add(flag);

  function updateSignals(race, elapsed) {
    const count = race.startLights ?? 0;
    for (const [i, { lamp, core }] of lamps.entries()) {
      lamp.material = i < count ? lit : dark;
      core.material = i < count ? coreLit : coreDim;
    }
    const finish = race.cars.some(car => car.finishTime != null
      || (car.lap === 2 && car.s >= track.length * 2 - 68));
    const wave = finish || (race.phase === 'racing' && race.elapsed < 5);
    flag.material = finish ? checkered : green;
    flag.visible = wave;
    arm.rotation.set(
      wave ? Math.sin(elapsed * 9.7) * 0.37 : 0.08,
      wave ? Math.sin(elapsed * 8.3 + 1.1) * 0.45 : 0.14,
      wave ? Math.sin(elapsed * 8.3) * 0.17 - 0.09 : 1.03,
    );
    if (!wave) return;
    const vertices = flagGeometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const across = 0.5 - vertices.getX(i) / flagWidth;
      const wave = Math.sin(elapsed * 14.2 - across * 8.1 + vertices.getY(i));
      vertices.setZ(i, wave * across * 0.24);
    }
    vertices.needsUpdate = true;
    flagGeometry.computeVertexNormals();
  }
  return { updateSignals, signalResources: [lit, dark, coreLit, coreDim, green, checkered, checkers] };
}

function flagColor(count) {
  return count === 100 ? 0xffd566 : 0xec5358;
}

export function decorateCircuit(scene, carGlints) {
  const random = rng(19236);
  // Keep distant railings and props out of each camera and local shadow pass.
  const { instance, flush } = sceneObjects(scene, { cellSize: 112 });
  const field = ground(scene, random);
  const tracksideLights = getTracksideLights(field.height);
  addTracksideFixtures(scene, tracksideLights);
  const shelters = [];
  landscape(scene, instance, field, random);
  const start = 0;
  const end = track.length;
  const bands = [
    {start, end, left: -railOffset - 1.12, right: -railOffset - 0.18, y: -0.21, leftY: -1.88, color: 0x6e6c49},
    {start, end, left: railOffset + 0.18, right: railOffset + 1.12, y: -0.21, rightY: -1.88, color: 0x6e6c49},
    {start, end, left: -railOffset - 0.18, right: -half, y: -0.21, color: 0x7b704c},
    {start, end, left: half, right: railOffset + 0.18, y: -0.21, color: 0x7b704c},
    {start, end, left: -half, right: half, y: 0.01, asphalt: true, color: s => {
      const base = palettes[sector(s)].asphalt;
      const light = Math.round(2.2 * Math.sin(s * 0.12) + 1.1 * Math.sin(s * 1.62));
      return base + light * 0x010101;
    }},
    {start, end, left: -half + 0.08, right: -half + 0.20, y: 0.04, color: cream},
    {start, end, left: half - 0.20, right: half - 0.08, y: 0.04, color: cream},
  ];
  for (const side of [-1, 1]) {

    const segment = 2.8;
    for (let s = 0; s < track.length; s += segment) {
      const middle = track.sample(s + segment / 2);
      const sStart = s;
      const sEnd = Math.min(s + segment, track.length);
      const tight = Math.abs(middle.curvature) > 0.013 || track.turns.some(turn => Math.abs(turn.s - s) < 10);
      const left = side < 0 ? -half - (tight ? 1.04 : 0.64) : half;
      const right = side < 0 ? -half : half + (tight ? 1.04 : 0.64);
      const palette = palettes[sector(s + segment / 2)];
      const block = Math.floor(s / segment + 0.25);
      bands.push({ start: sStart, end: sEnd, left, right, y: 0.018, color: palette.curb[block % 2] });
      if (tight || sector(s) !== 'valley') {
        const edge = side < 0 ? left : right;
        const outer = edge + side * 1.26;
        const accent = edge + side * 1.08;
        bands.push({ start: sStart, end: sEnd, left: Math.min(accent, outer), right: Math.max(accent, outer), y: -0.037, color: palette.curbBorder });
        const runoff = side < 0 ? left - 1.26 : right + 1.26;
        bands.push({ start: sStart, end: sEnd, left: Math.min(left, runoff), right: Math.max(right, runoff), y: -0.056, color: palette.service });
      }
    }
  }
  for (const [start, end, color, cadence] of [
    [-37, 61, 0xeab769, 5.0],
    [eauRouge - 26, kemmel + 62, 0x4ee5c5, 4.9],
    [lesCombes - 106, lesCombes + 62, 0xf97862, 4.2],
    [pouhon - 16, stavelot + 21, 0x52b8b6, 5.7],
    [busStop - 64, busStop + 35, 0xe79a5c, 4.3],
  ]) {
    for (let s = start; s < end; s += cadence) {
      for (const side of [-1, 1]) {
        const a = side * (half + 0.98);
        const b = side * (half + 2.10);
        bands.push({start: s, end: s + 0.37, left: Math.min(a, b), right: Math.max(a, b), skew: side * 0.63, y: -0.018, color});
      }
    }
  }
  const tile = track.width / 18;
  for (let column = 0; column < 18; column++) {
    const left = column * tile - half;
    for (let row = 0; row < 2; row++) {
      bands.push({start: row * tile - tile, end: (row + 1) * tile - tile, left, right: left + tile, y: 0.045, color: (row + column) % 2 ? 0x253441 : cream});
    }
  }
  for (let grid = 0; grid < 4; grid++) {
    const s = -5 - grid * 7;
    const x = grid % 2 ? 2.35 : -2.35;
    for (const offset of [-1.52, 1.41]) {
      bands.push({start: s - 2.4, end: s + 2.02, left: x + offset, right: x + offset + 0.10, y: 0.048, color: cream});
    }
    bands.push({start: s - 2.44, end: s - 2.34, left: x - 1.52, right: x + 1.51, y: 0.048, color: cream});
    bands.push({start: s + 1.95, end: s + 2.07, left: x - 1.52, right: x + 1.51, y: 0.048, color: 0xffc45a});
  }
  roadMesh(scene, bands, tracksideLights, carGlints);

  const crowd = createCrowd(scene);
  const gates = infrastructure(scene, instance, crowd, random, field, shelters);
  numberGrid(scene);
  const signals = raceSignals(scene, instance, gates[0]);
  flush();
  // Cache only within one world. Subsequent launches build fresh materials.
  materials.clear();
  const viewRay = new THREE.Vector3();
  const roofRay = new THREE.Raycaster();
  const roofHits = [];
  const carPoint = new THREE.Vector3();
  function exposeCars(camera, player) {
    for (const { roof, s, span } of shelters) {
      roof.parent.visible = true;
      if (!player) continue;
      const gap = ((player.s - s) % track.length + track.length) % track.length;
      if (Math.min(gap, track.length - gap) > span / 2 + 23) continue;
      for (const height of [0.44, 1.65, 2.82]) {
        carPoint.set(...lateral(player.s, player.offset, height));
        if (camera.isOrthographicCamera) {
          camera.getWorldDirection(viewRay).negate();
          roofRay.far = 90;
        } else {
          viewRay.subVectors(camera.position, carPoint);
          roofRay.far = viewRay.length();
          viewRay.normalize();
        }
        roofRay.set(carPoint, viewRay);
        roofHits.length = 0;
        roofRay.intersectObject(roof, false, roofHits);
        if (!roofHits.length) continue;
        roof.parent.visible = false;
        break;
      }
    }
    for (const { header, s, angle, x, y, z, width } of gates) {
      header.visible = true;
      if (!player) continue;
      const delta = ((player.s - s + track.length * 0.5) % track.length + track.length) % track.length - track.length * 0.5;
      if (Math.abs(delta) > 20) continue;
      const normalX = Math.sin(angle);
      const normalZ = Math.cos(angle);
      const floor = s === gates[0].s ? gantryHeight - 2.2 : gantryHeight - 1.1;
      const [px, road, pz] = lateral(player.s, player.offset);
      const sourceDistance = (px - x) * normalX + (pz - z) * normalZ;
      for (const carHeight of [0.44, 1.65, 2.82]) {
        const py = road + carHeight;
        const back = camera.isOrthographicCamera
          ? camera.getWorldDirection(viewRay).negate()
          : viewRay.set(camera.position.x - px, camera.position.y - py, camera.position.z - pz);
        const projected = back.x * normalX + back.z * normalZ;
        if (Math.abs(projected) < 0.001) continue;
        const t = -sourceDistance / projected;
        if (t <= 0 || t >= (camera.isOrthographicCamera ? 90 : 1)) continue;
        const height = py + back.y * t - y;
        const widthPosition = Math.abs((px + back.x * t - x) * normalZ - (pz + back.z * t - z) * normalX);
        const beam = height >= floor && height <= gantryHeight + 1.26 && widthPosition < width * 0.56;
        const column = height >= 0 && height <= gantryHeight + 0.9 && Math.abs(widthPosition - railOffset) < 0.53;
        if (beam || column) {
          header.visible = false;
          break;
        }
      }
    }
  }
  return { ...signals, crowd, groundHeight: field.height, tracksideLights, exposeCars };
}

