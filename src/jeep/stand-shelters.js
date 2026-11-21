import * as THREE from 'three';

const roofTones = [0xa45a43, 0xba6c4e, 0x8a4638, 0x99523e, 0xad6147];

function surface(positions, colors, material, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, material.transparent ? 4 : 3));
  if (indices) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function addStandShelter(scene, instance, terrain, { s, span, rows, side, label, bank }, step, offset, baseBack, angle) {
  const group = new THREE.Group();
  group.name = label + ' copper shelter';
  const height = bank ? 1.98 : (rows - 1) * 0.48 + 2.36;
  const front = offset - side * 0.80;
  const back = baseBack + side * 0.73;
  const ridge = THREE.MathUtils.lerp(front, back, 0.58);
  const bayCount = span > 28 ? 3 : 2;
  const bay = (span + 0.96) / bayCount;
  const positions = [];
  const colors = [];
  const color = new THREE.Color();
  const face = (tone, points) => {
    color.setHex(tone);
    for (const point of points) {
      positions.push(...point);
      colors.push(color.r, color.g, color.b);
    }
  };
  const warm = new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false });
  const strip = new THREE.BoxGeometry(bank ? 0.19 : 0.115, bank ? 0.135 : 0.080, bank ? 2.8 : 2.24);
  const fixtures = new THREE.InstancedMesh(strip, warm, bayCount * 2);
  const fixture = new THREE.Object3D();
  for (let i = 0; i < bayCount; i++) {
    const from = (i - bayCount / 2) * bay;
    const to = from + bay;
    const a = step(from + 0.05, front, height);
    const b = step(to - 0.05, front, height);
    const c = step(to - 0.05, back, height + 0.15);
    const d = step(from + 0.05, back, height + 0.15);
    const lowRidge = step(from + 0.18 * bay, ridge, height + 1.09);
    const highRidge = step(to - 0.18 * bay, ridge, height + 1.16);
    face(bank ? 0xbe6742 : roofTones[i % 2], [a, b, lowRidge]);
    face(bank ? 0xd9854e : roofTones[(i + 1) % 2], [b, highRidge, lowRidge]);
    face(bank ? 0xa35438 : roofTones[2], [b, c, highRidge]);
    face(bank ? 0xab5b3e : roofTones[3], [c, d, highRidge]);
    face(bank ? 0xbf6c43 : roofTones[4], [d, lowRidge, highRidge]);
    face(bank ? 0xa35438 : roofTones[2], [d, a, lowRidge]);
    for (const [p, q] of [[a, b], [d, c]]) {
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const dz = q[2] - p[2];
      const center = p.map((value, axis) => (value + q[axis]) / 2);
      center[1] -= 0.083;
      instance('box', bank ? 0x8f4a32 : 0x703b30, center,
        [0.15, 0.17, Math.hypot(dx, dy, dz)], Math.atan2(dx, dz), -Math.atan2(dy, Math.hypot(dx, dz)));
    }
    for (const [index, location] of [0.24, 0.76].entries()) {
      fixture.position.set(...step(from + bay * location, front + side * 0.15, height - 0.21));
      const next = step(from + bay * location + 1, front + side * 0.15, height - 0.21);
      const delta = next.map((value, axis) => value - fixture.position.getComponent(axis));
      fixture.rotation.set(-Math.atan2(delta[1], Math.hypot(delta[0], delta[2])), Math.atan2(delta[0], delta[2]), 0, 'YXZ');
      fixture.updateMatrix();
      fixtures.setMatrixAt(i * 2 + index, fixture.matrix);
    }
  }
  group.add(fixtures);
  for (let i = 0; i <= bayCount; i++) {
    const along = THREE.MathUtils.clamp((i - bayCount / 2) * bay, -span / 2 + 0.16, span / 2 - 0.16);
    for (const [across, top] of [[front + side * 0.06, height], [back - side * 0.08, height + 0.15]]) {
      const [x, y, z] = step(along, across, top - 0.07);
      const bottom = terrain.height(x, z) - 0.18;
      instance('box', 0x243a42, [x, (bottom + y) / 2, z], [0.24, y - bottom, 0.24], angle);
    }
  }
  const roof = surface(positions, colors, new THREE.MeshStandardMaterial({
    vertexColors: true, metalness: 0.38, roughness: 0.34, side: THREE.DoubleSide,
    emissive: bank ? 0x372015 : 0x000000, emissiveIntensity: 0.48,
  }));
  roof.receiveShadow = true;
  group.add(roof);
  scene.add(group);
  addAmberSpill(scene, terrain, step, front, side, span, bank);
  if (bank || label === 'EAU ROUGE' || label === 'RAIDILLON') addDrainage(scene, terrain, step, span, side, back, s);
  return roof;
}

function addAmberSpill(scene, terrain, step, front, side, span, bank) {
  const positions = [];
  const colors = [];
  const indices = [];
  const amber = new THREE.Color(0xfba33d);
  for (let i = 0; i <= 20; i++) {
    const along = (i / 20 - 0.5) * span;
    for (let j = 0; j <= 5; j++) {
      const [x, , z] = step(along, front + side * (j * 0.59 - 2.7), 0);
      positions.push(x, terrain.height(x, z) + 0.095, z);
      const fade = Math.sin(i / 20 * Math.PI) * Math.sin(j / 5 * Math.PI);
      const breakUp = 0.73 + 0.2 * Math.sin(1.6 * i + 1.96 * j);
      colors.push(amber.r, amber.g, amber.b, fade * breakUp * (bank ? 0.42 : 0.24));
      if (i && j) {
        const n = positions.length / 3 - 1;
        indices.push(n, n - 1, n - 6, n - 1, n - 7, n - 6);
      }
    }
  }
  const spill = surface(positions, colors, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }), indices);
  spill.name = 'Amber reflection below canopy';
  scene.add(spill);
}

function addDrainage(scene, terrain, step, span, side, back, s) {
  const positions = [];
  const colors = [];
  const tint = new THREE.Color();
  const point = (i, lateral, height) => {
    const along = (i / 12 - 0.5) * (span * 0.91);
    const [x, , z] = step(along, back + side * (1.65 + lateral + 0.42 * Math.sin(i * 0.34)), 0);
    const [cx, , cz] = step(along, back + side * (1.65 + 0.42 * Math.sin(i * 0.34)), 0);
    return [x, Math.max(terrain.height(x, z), terrain.height(cx, cz)) + height, z];
  };
  const quad = (a, b, c, d, color) => {
    tint.setHex(color);
    for (const p of [a, b, c, c, b, d]) {
      positions.push(...p);
      colors.push(tint.r, tint.g, tint.b);
    }
  };
  for (let i = 0; i < 12; i++) {
    const stepHeight = i % 4 === 0 && i > 0 ? 0.24 : 0.08;
    quad(point(i, -0.42, stepHeight), point(i, 0.42, stepHeight),
      point(i + 1, -0.42, 0.08), point(i + 1, 0.42, 0.08), i % 2 === 0 ? 0x32535c : 0x385761);
    for (const edge of [-1, 1]) {
      quad(point(i, edge * 0.42, stepHeight), point(i, edge * 0.63, 0.18),
        point(i + 1, edge * 0.42, 0.08), point(i + 1, edge * 0.63, 0.18), 0x454e4a);
    }
    if (stepHeight > 0.08) {
      for (let vein = 0; vein < 11; vein++) {
        const w = -0.4 + vein * 0.075;
        const color = Math.sin(vein * 4.3 + s) > 0.2 ? 0x91b2af : 0x526d74;
        quad(point(i, w, 0.075), point(i, w + 0.065, 0.075),
          point(i, w, stepHeight), point(i, w + 0.065, stepHeight), color);
      }
    }
  }
  const drain = surface(positions, colors, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.32, metalness: 0.19, side: THREE.DoubleSide,
  }));
  drain.name = 'Stepped rainwater drainage';
  drain.receiveShadow = true;
  scene.add(drain);
}
