import * as THREE from 'three';
import { track } from './track.js';

const tau = Math.PI * 2;
const severityScale = { light: 0.37, medium: 0.72, heavy: 1 };

export function createImpactEffects(scene, place, models) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const activePieces = new Map();
  const skids = [];
  const puffs = [];
  const queued = [];
  const transform = new THREE.Object3D();
  const anchor = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const skidGeo = new THREE.PlaneGeometry(1, 1);
  skidGeo.rotateX(-Math.PI / 2);
  const skidPaint = new THREE.MeshBasicMaterial({
    color: 0x15252f, transparent: true, opacity: 0.67, polygonOffset: true,
    polygonOffsetFactor: -1, polygonOffsetUnits: -2, depthWrite: false,
  });
  const dustGeo = new THREE.IcosahedronGeometry(1, 0);
  const dustPaint = new THREE.MeshBasicMaterial({
    color: 0xffbb67, transparent: true, opacity: 0.69, depthWrite: false,
  });
  const marks = new THREE.InstancedMesh(skidGeo, skidPaint, 32);
  const flecks = new THREE.InstancedMesh(dustGeo, dustPaint, 48);
  for (const batch of [marks, flecks]) {
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.frustumCulled = false;
    batch.count = 0;
    scene.add(batch);
  }
  let previousRace;
  let previousMode;

  function clear() {
    skids.length = 0;
    puffs.length = 0;
    marks.count = 0;
    flecks.count = 0;
    for (const part of activePieces.values()) {
      part.age = Infinity;
      part.mesh.visible = false;
    }
    for (const model of models) model?.resetImpact();
  }

  function fly(model, car, partId, side, scale, wall) {
    const source = model.parts[partId];
    if (!source) return;
    const key = car.id + '/' + partId;
    let piece = activePieces.get(key);
    if (!piece) {
      const mesh = source.clone(true);
      mesh.traverse(node => {
        node.castShadow = false;
        node.receiveShadow = false;
      });
      piece = { mesh, carId: car.id, partId, velocity: new THREE.Vector3() };
      activePieces.set(key, piece);
      scene.add(mesh);
    }
    source.getWorldPosition(piece.mesh.position);
    source.getWorldQuaternion(rotation);
    piece.mesh.quaternion.copy(rotation);
    piece.mesh.visible = true;
    const wheel = partId.startsWith('wheel');
    const left = partId.endsWith('L');
    const broadside = side === 'left' ? -1 : side === 'right' ? 1 : 0;

    const end = partId === 'rearBumper' || partId.startsWith('wheelR') ? -1 : 1;
    const direction = wall ? -Math.sign(car.offset || broadside || 1)
      : wheel ? (left ? -1 : 1)
      : broadside || (car.offset > 0 ? -end : end);
    const heading = track.sample(car.s).angle;
    piece.s = car.s + end * (wheel ? 1.0 : 1.52);
    piece.advance = wheel
      ? wall ? -(1.8 + car.speed * 0.13) : 3.1 + car.speed * 0.18
      : end * (2.8 + car.speed * 0.12);
    const slip = direction * (wheel ? 5.6 : 4.2) * scale;
    piece.velocity.set(
      Math.sin(heading) * piece.advance + Math.cos(heading) * slip,
      (wheel ? 4.1 : 3.1) * scale,
      -Math.cos(heading) * piece.advance + Math.sin(heading) * slip,
    );
    piece.spin = direction * (wheel ? 7.7 : 5.6) * scale;
    piece.radius = wheel ? 0.45 : 0.15;
    piece.age = 0;
    if (preference.matches) {
      // Keep the silhouette change with a stationary prop beside the vehicle.
      place(piece.mesh.position, wall ? car.s - 1.45 : piece.s, car.offset + direction * (wheel ? 2.18 : 1.94), piece.radius + 0.04);
    }
  }

  function markImpact(model, car, side, severity, mode) {
    const scale = severityScale[severity] ?? 0.65;
    model.impact(side, severity, mode, preference.matches);
    const across = side === 'left' ? -1 : side === 'right' ? 1 : car.offset > 0 ? 1 : -1;
    if (mode === 'arcade') {
      for (const lane of [-1, 1]) {
        for (let stage = 0; stage < 2; stage++) {
          if (skids.length === 32) skids.shift();
          skids.push({
            s: car.s - (stage + 0.2) * (1.39 + scale * 1.05),
            x: car.offset + lane * 0.88 + across * stage * 0.20,
            length: 1.14 + 1.52 * scale,
            shear: across * (stage ? 0.13 : 0.39),
            age: 0,
          });
        }
      }
    }
    const count = preference.matches ? 2 : severity === 'heavy' ? 6 : 4;
    for (let i = 0; i < count; i++) {
      if (puffs.length === 48) puffs.shift();
      const band = (i * 0.618) % 1;
      const end = side === 'front' ? 1.47 : side === 'rear' ? -1.48 : 0.12;
      puffs.push({
        s: car.s + end + (band - 0.5) * 1.43,
        x: car.offset + across * (1.13 + band * 0.65),
        lateral: across * (1.3 + band * 2) * scale,
        age: 0, band, scale,
      });
    }
  }

  function react(events, race) {
    for (const event of events) {
      if (event.type === 'impact') queued.push({ event, race, mode: event.mode ?? race.collisionMode });
    }
  }

  function update(race, dt, mode) {
    const style = mode === 'race' ? race.collisionMode : null;
    if (race !== previousRace || style !== previousMode) {
      clear();
      previousRace = race;
      previousMode = style;
    }
    for (const entry of queued.splice(0)) {
      if (!style || entry.race !== race || entry.mode !== style) continue;
      const { event } = entry;
      for (const [id, side] of [[event.aId, event.aSide], [event.bId, event.bSide]]) {
        const index = race.cars.findIndex(car => car.id === id);
        if (index >= 0 && models[index]) markImpact(models[index], race.cars[index], side, event.severity, style);
      }
      if (style !== 'breakaway') continue;
      for (const { carId, partId } of event.parts ?? []) {
        const index = race.cars.findIndex(car => car.id === carId);
        if (index < 0 || !models[index]) continue;
        const { detachedParts } = race.cars[index];
        if (detachedParts?.includes(partId)) {
          const side = carId === event.aId ? event.aSide : event.bSide;
          fly(models[index], race.cars[index], partId, side, severityScale[event.severity] ?? 0.7, event.bId === null);
        }
      }
    }

    const reduced = preference.matches;
    const step = THREE.MathUtils.clamp(dt, 0, 0.08);
    for (const piece of activePieces.values()) {
      if (!piece.mesh.visible) continue;
      const car = race.cars.find(candidate => candidate.id === piece.carId);
      if (!car?.detachedParts?.includes(piece.partId)) {
        piece.mesh.visible = false;
        continue;
      }
      piece.age += step;
      piece.mesh.visible = piece.age < (reduced ? 0.85 : 1.42);
      if (reduced || !piece.mesh.visible || !step) continue;
      piece.s += piece.advance * step;
      piece.velocity.y -= 13.8 * step;
      piece.mesh.position.addScaledVector(piece.velocity, step);
      piece.mesh.rotateX(piece.spin * step);
      piece.mesh.rotateZ(piece.spin * 0.52 * step);
      const floor = track.sample(piece.s).y + piece.radius;
      if (piece.mesh.position.y < floor) {
        piece.mesh.position.y = floor;
        piece.velocity.y = Math.abs(piece.velocity.y) * 0.33;
        piece.velocity.x *= 0.78;
        piece.velocity.z *= 0.78;
        piece.advance *= 0.78;
        piece.spin *= 0.78;
      }
    }
    let n = 0;
    for (let i = skids.length - 1; i >= 0; i--) {
      const mark = skids[i];
      mark.age += step;
      const life = 1.92;
      if (mark.age > life) {
        skids.splice(i, 1);
        continue;
      }
      const extra = Math.abs(mark.x) - track.width / 2;
      const surface = extra > 2.2 ? -0.193 : extra > 1.04 ? -0.036 : 0.047;
      const pose = place(anchor, mark.s, mark.x, surface);
      const grade = Math.atan2(track.sample(mark.s + 0.5).y - track.sample(mark.s - 0.5).y, 1);
      transform.position.copy(anchor);
      transform.rotation.set(-grade, Math.PI - pose.angle + mark.shear, 0, 'YXZ');
      transform.scale.set(0.23 * Math.min(1, (life - mark.age) / 0.45), 1, mark.length);
      transform.updateMatrix();
      marks.setMatrixAt(n++, transform.matrix);
    }
    marks.count = n;
    marks.instanceMatrix.needsUpdate = Boolean(n);
    n = 0;
    for (let i = puffs.length - 1; i >= 0; i--) {
      const puff = puffs[i];
      puff.age += step;
      const life = reduced ? 0.53 : 0.39 + puff.band * 0.17;
      if (puff.age > life) {
        puffs.splice(i, 1);
        continue;
      }
      const age = reduced ? 0.10 : puff.age;
      place(transform.position, puff.s - age * 1.7, puff.x + age * puff.lateral, 0.10 + Math.sin(age * Math.PI / life) * 0.39);
      transform.rotation.set(age * tau, puff.band * tau, age * 2.9);
      const size = ((0.065 + puff.scale * 0.087) * (0.54 + puff.band * 0.82)) * Math.min(1, (life - age) / 0.20);
      transform.scale.set(size * 1.46, size * 0.59, size);
      transform.updateMatrix();
      flecks.setMatrixAt(n++, transform.matrix);
    }
    flecks.count = n;
    flecks.instanceMatrix.needsUpdate = Boolean(n);
  }

  return { react, update, reducedMotion: preference };
}
