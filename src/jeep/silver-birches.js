import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const tau = Math.PI * 2;
const colors = [0xbd561e, 0xd46d20, 0xe98624, 0xf3a022, 0xffbc36, 0xffce52].map(hex => new THREE.Color(hex));
const bark = [0xf4e8ce, 0xd7d3c0, 0xece1c7, 0xfff1d5].map(hex => new THREE.Color(hex));
const scars = [0x373130, 0x514642, 0x6d5d50].map(hex => new THREE.Color(hex));
const up = new THREE.Vector3(0, 1, 0);

function geometryBuilder() {
  const positions = [];
  const tints = [];
  return {
    triangle(a, b, c, tint) {
      positions.push(...a, ...b, ...c);
      for (let vertex = 0; vertex < 3; vertex++) tints.push(tint.r, tint.g, tint.b);
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(tints, 3));
      geometry.computeVertexNormals();
      return geometry;
    },
  };
}

function drawLimb(mesh, start, end, baseRadius, tipRadius, random, marked = true) {
  const a = new THREE.Vector3(...start);
  const axis = new THREE.Vector3(...end).sub(a).normalize();
  const radial = new THREE.Vector3(axis.y, -axis.x, 0).normalize();
  const cross = new THREE.Vector3().crossVectors(axis, radial);
  const sides = 6;
  const ring = (side, t, clearance = 0) => {
    const theta = side / sides * tau;
    const radius = THREE.MathUtils.lerp(baseRadius, tipRadius, t) + clearance;
    return start.map((value, j) => THREE.MathUtils.lerp(value, end[j], t)
      + radius * (radial.getComponent(j) * Math.cos(theta) + cross.getComponent(j) * Math.sin(theta)));
  };
  const bands = marked ? 3 + Math.floor(random() * 2) : 0;
  const scarsByHeight = Array.from({ length: bands }, (_, i) => ({
    t: (i + 0.45 + random() * 0.38) / bands,
    face: Math.floor(random() * sides),
    span: 2 + Math.floor(random() * 3),
    width: 0.015 + random() * 0.040,
  }));
  for (let side = 0; side < sides; side++) {
    const tint = bark[side % bark.length];
    mesh.triangle(ring(side, 0), ring(side + 1, 0), ring(side, 1), tint);
    mesh.triangle(ring(side + 1, 0), ring(side + 1, 1), ring(side, 1), tint);
    if (tipRadius > 0.006) mesh.triangle(ring(side, 1), ring(side + 1, 1), end, bark[0]);
    for (const mark of scarsByHeight) {
      const index = (side - mark.face + sides) % sides;
      if (index >= mark.span) continue;
      const drift = Math.sin(index * 0.8 + mark.t * 5) * mark.width * 0.36;
      const low = mark.t + drift;
      const high = low + mark.width * (index === mark.span - 1 ? 0.42 : 1);
      const left = side + (index === 0 ? 0.17 : 0);
      const right = side + 1 - (index === mark.span - 1 ? 0.19 : 0);
      const onFace = (u, t) => {
        const first = ring(side, t, 0.0015);
        const second = ring(side + 1, t, 0.0015);
        return first.map((value, j) => THREE.MathUtils.lerp(value, second[j], u - side));
      };
      mesh.triangle(onFace(left, low), onFace(right, low + drift), onFace(left, high), scars[index % scars.length]);
      mesh.triangle(onFace(right, low + drift), onFace(right, high + drift), onFace(left, high), scars[index % scars.length]);
    }
  }
}

function drawCrown(mesh, tip, scale, colorShift, random) {
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * tau + random() * 0.42;
    const center = new THREE.Vector3(
      tip[0] + Math.cos(angle) * scale * (0.32 + random() * 0.55),
      tip[1] + scale * (random() - 0.30),
      tip[2] + Math.sin(angle) * scale * (0.32 + random() * 0.55),
    );
    const width = scale * (1.06 + random() * 0.34);
    const right = new THREE.Vector3(Math.cos(angle), -0.18 + random() * 0.36, Math.sin(angle));
    const long = new THREE.Vector3(-0.73 * Math.sin(angle), 0.60 + random() * 0.23, 0.73 * Math.cos(angle));
    const normal = new THREE.Vector3().crossVectors(right, long).normalize();
    const point = (x, y, fold = 0) => center.clone()
      .addScaledVector(right, x * width)
      .addScaledVector(long, y * width)
      .addScaledVector(normal, fold * width).toArray();
    const a = point(0, -0.70);
    const b = point(0.68, -0.05, -0.07);
    const c = point(0.02, 0.73, 0.04);
    const d = point(-0.66, 0.04, -0.10);
    const tint = colors[Math.min(colors.length - 1, 1 + colorShift + Math.floor(random() * 4))];
    mesh.triangle(a, b, c, tint);
    mesh.triangle(a, c, d, tint.clone().multiplyScalar(0.84));
  }
}

function makeBirch(variant, random, detailed) {
  const mesh = geometryBuilder();
  const base = [0, -0.035, 0];
  const fork = [0.015, 0.39 + random() * 0.08, 0.017];
  const high = [-0.047, 0.73, -0.023];
  const leader = [0.015 + random() * 0.049, 0.98, -0.045];
  drawLimb(mesh, base, fork, 0.031, 0.023, random);
  drawLimb(mesh, fork, high, 0.023, 0.014, random);
  drawLimb(mesh, high, leader, 0.014, 0.003, random, detailed);
  drawCrown(mesh, leader, 0.096, variant % 3 + 1, random);

  for (let i = 0; i < 5; i++) {
    const angle = i * 2.399963 + variant * 0.7 + random() * 0.49;
    const reach = (i === 0 ? 0.28 : 0.20) + random() * 0.07;
    const x = Math.cos(angle) * reach;
    const z = Math.sin(angle) * reach;
    const start = i < 2 ? fork : high.map((value, j) => THREE.MathUtils.lerp(fork[j], value, (i - 1) * 0.24));
    const elbow = [x * 0.57, start[1] + 0.15 + random() * 0.07, z * 0.57];
    const tip = [x, elbow[1] + 0.10 + random() * 0.08, z];
    const twig = [x * 0.63 - z * 0.30, elbow[1] + 0.15, z * 0.63 + x * 0.30];
    const radius = i === 0 ? 0.014 : 0.010;
    drawLimb(mesh, start, elbow, radius, radius * 0.63, random, detailed && i < 2);
    drawLimb(mesh, elbow, tip, radius * 0.63, 0.002, random, false);
    drawCrown(mesh, tip, 0.071 + random() * 0.038, variant % 3, random);
    if (detailed) {
      drawLimb(mesh, elbow, twig, radius * 0.45, 0.002, random, false);
      drawCrown(mesh, twig, 0.045 + random() * 0.022, variant % 3 + 1, random);
    }
  }
  // Index coplanar vertices after computing normals so bark edges and tints stay distinct.
  return mergeVertices(mesh.finish(), 1e-5);
}

function fallenLeafGeometry() {
  const mesh = geometryBuilder();
  const base = [-0.47, 0, 0];
  const shoulder = [0, 0, -0.30];
  const tip = [0.51, 0, 0.035];
  const side = [0.07, 0, 0.37];
  const fold = [0.02, 0.060, 0];
  const light = new THREE.Color(0xffffff);
  const shade = light.clone().multiplyScalar(0.72);
  mesh.triangle(base, fold, shoulder, light);
  mesh.triangle(shoulder, fold, tip, light);
  mesh.triangle(tip, fold, side, shade);
  mesh.triangle(side, fold, base, shade);
  return mesh.finish();
}

export function addSilverBirches(scene, trees, field, leafAllowed, random) {
  const prototypes = Array.from({ length: 6 }, (_, i) => makeBirch(i, random, i < 4));
  const barkAndCrown = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.88 });
  barkAndCrown.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * mix(0.12, 0.33, smoothstep(0.35, 0.72, vColor.r - vColor.b));
    `);
  };
  const leafMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, polygonOffset: true, polygonOffsetFactor: -1 });
  const leafGeometry = fallenLeafGeometry();
  const groups = new Map();
  for (const tree of trees) {
    const key = `${Math.floor(tree.x / 100)},${Math.floor(tree.z / 100)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(tree);
  }

  const instance = new THREE.Object3D();
  const tilt = new THREE.Quaternion();
  const normal = new THREE.Vector3();
  for (const tile of groups.values()) {
    for (let i = 0; i < prototypes.length; i++) {
      const selected = tile.filter(tree => (tree.near ? tree.variant : 4 + tree.variant % 2) === i);
      if (!selected.length) continue;
      const batch = new THREE.InstancedMesh(prototypes[i], barkAndCrown, selected.length);
      batch.name = 'Silver birches';
      for (const [index, tree] of selected.entries()) {
        instance.position.set(tree.x, field.surfaceHeight(tree.x, tree.z), tree.z);
        instance.rotation.set(0, tree.yaw, 0);
        instance.scale.set(tree.width * tree.height, tree.height, tree.width * tree.height);
        instance.updateMatrix();
        batch.setMatrixAt(index, instance.matrix);
      }
      batch.castShadow = selected.some(tree => tree.near);
      batch.receiveShadow = true;
      scene.add(batch);
    }

    const scatter = [];
    for (const tree of tile) {
      const count = tree.near ? 76 + Math.floor(random() * 36) : 10;
      const drift = 1.2 + tree.height * 0.26;
      for (let i = 0; i < count; i++) {
        const angle = random() * tau;
        const radius = drift * random() ** 1.02;
        const x = tree.x + Math.cos(angle) * radius * 1.24 + drift * 0.16;
        const z = tree.z + Math.sin(angle) * radius * 0.80 - drift * 0.09;
        if (!leafAllowed(x, z)) continue;
        const size = 0.21 + random() * 0.27;
        scatter.push({ x, z, size, yaw: random() * tau, tint: colors[Math.floor(random() * colors.length)] });
      }
    }
    if (!scatter.length) continue;
    const batch = new THREE.InstancedMesh(leafGeometry, leafMaterial, scatter.length);
    batch.name = 'Fallen amber leaves';
    batch.receiveShadow = true;
    for (const [index, { x, z, size, yaw, tint }] of scatter.entries()) {
      const gradientX = field.surfaceHeight(x + 0.14, z) - field.surfaceHeight(x - 0.14, z);
      const gradientZ = field.surfaceHeight(x, z + 0.14) - field.surfaceHeight(x, z - 0.14);
      normal.set(-gradientX, 0.28, -gradientZ).normalize();
      tilt.setFromAxisAngle(up, yaw);
      instance.quaternion.setFromUnitVectors(up, normal).multiply(tilt);
      instance.position.set(x, field.surfaceHeight(x, z) + 0.031, z);
      instance.scale.set(size, size, size * 0.94);
      instance.updateMatrix();
      batch.setMatrixAt(index, instance.matrix);
      batch.setColorAt(index, tint);
    }
    scene.add(batch);
  }
}
