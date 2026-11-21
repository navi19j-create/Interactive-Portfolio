import * as THREE from 'three';
import { track } from './track.js';

const streakCount = 12;

function streaks(color, count) {
  const vertices = new Float32Array([
    0, 0, -0.5, 0.52, 0, 0.05, 0.38, 0, 0.5,
    0, 0, -0.5, 0.38, 0, 0.5, -0.38, 0, 0.5,
    0, 0, -0.5, -0.38, 0, 0.5, -0.52, 0, 0.05,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  const material = new THREE.MeshBasicMaterial({
    color, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

export function createAirflow(scene, setTrackPosition, carCount) {
  const effects = Array.from({ length: 2 }, () => {
    const tow = streaks(0x96ffef, 10);
    scene.add(tow);
    return {
      tow, rivalIndex: -1, wakePosition: 0,
      wakeEdges: [new THREE.Vector3(), new THREE.Vector3()],
    };
  });
  const boost = streaks(0xffffff, carCount * streakCount);
  boost.name = 'Overtake boost';
  boost.material.opacity = 0.92;
  const boostFlash = new THREE.Color(0xffeb9e);
  const boostTrail = new THREE.Color(0xffbd40);
  scene.add(boost);
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const transform = new THREE.Object3D();

  function drawWake(mesh, count, s, offset, span, time, reduced) {
    mesh.count = count;
    for (let i = 0; i < count; i++) {
      const seed = (i * 0.618) % 1;
      const phase = reduced ? seed : (seed + time * 1.2) % 1;
      const side = i % 2 ? 1 : -1;
      const spread = 1.28 + phase * 1.1;
      const along = s - 1.94 - span * phase;
      const pose = setTrackPosition(transform.position, along, offset(along) + side * spread, 0.22 + (i % 3) * 0.30);
      transform.rotation.set(0, Math.PI - pose.angle, (i % 3 - 1) * 0.47, 'YXZ');
      transform.scale.set(0.16, 1, 0.88 + seed * 0.68);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  function updatePlayer(race, time, player, effect) {
    const { tow, wakeEdges } = effect;
    const rivalIndex = race.cars.findIndex(car => car.id === player.towRivalId);
    const supplier = race.cars[rivalIndex];
    const gap = supplier ? ((supplier.s - player.s) % track.length + track.length) % track.length : 0;
    const wake = player.wake > 0.055 && supplier && gap < 36 && gap > 2.8 &&
      !player.recovering && player.finishTime == null;
    const reduced = preference.matches;
    tow.visible = Boolean(wake);
    if (wake) {
      tow.material.opacity = Math.min(0.85, 0.22 + player.wake * 0.63);
      const span = Math.min(gap - 2.15, 15);
      const at = s => THREE.MathUtils.lerp(supplier.offset, player.offset, (supplier.s - s) / Math.max(gap, 1));
      drawWake(tow, reduced ? 5 : 10, supplier.s, at, span, time, reduced);
      effect.rivalIndex = rivalIndex;
      const mid = supplier.s - 1.94 - span * 0.52;
      const center = at(mid);
      setTrackPosition(wakeEdges[0], mid, center - 1.85, 0.6);
      setTrackPosition(wakeEdges[1], mid, center + 1.85, 0.6);
    }
  }

  function drawBoost(group, time, reduced, start) {
    const count = reduced ? 6 : streakCount;
    group.updateMatrix();
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const flash = i < 2;
      if (flash) {
        const flicker = reduced ? 0 : 0.10 * Math.sin(time * 28 + i * Math.PI);
        // Keep the bright roots at the rear bumper as the Jeep pitches and turns.
        transform.position.set(side * 0.81, 0.86, -2.18);
        transform.rotation.set(0.25, -side * 0.16, side * 0.49, 'YXZ');
        transform.scale.set(0.54 + flicker, 1, 0.99 - flicker);
      } else {
        const seed = (i * 0.618) % 1;
        const phase = reduced ? seed : (seed + time * 2.0) % 1;
        transform.position.set(side * (0.86 + phase * 0.73), 0.79 - phase * 0.35 + (i % 3) * 0.14, -2.84 - phase * 3.25);
        transform.rotation.set(0.12, -side * 0.17, side * 0.47, 'YXZ');
        transform.scale.set(0.25 - phase * 0.10, 1, 1.26 - phase * 0.54);
      }
      transform.updateMatrix();
      boost.setMatrixAt(start + i, transform.matrix.premultiply(group.matrix));
      boost.setColorAt(start + i, flash ? boostFlash : boostTrail);
    }
    return start + count;
  }

  function update(race, time, enabled, models) {
    const players = race.players ?? [race.player];
    for (const [index, effect] of effects.entries()) {
      const player = enabled ? players[index] : null;
      if (player) updatePlayer(race, time, player, effect);
      else effect.tow.visible = false;
    }

    let count = 0;
    if (enabled) {
      const reduced = preference.matches;
      for (const [index, car] of race.cars.entries()) {
        const model = models[index];
        if (model && car.boostTime > 0 && car.speed > 2 && car.finishTime == null) {
          count = drawBoost(model.group, time, reduced, count);
        }
      }
    }
    boost.count = count;
    boost.visible = count > 0;
    if (boost.visible) {
      boost.instanceMatrix.needsUpdate = true;
      boost.instanceColor.needsUpdate = true;
    }
  }

  const projected = [new THREE.Vector3(), new THREE.Vector3()];
  const vehicleBox = new THREE.Box2();
  const corner = new THREE.Vector3();

  function projectVehicle(model, bounds, camera, width, height) {
    vehicleBox.makeEmpty();
    const { min, max } = bounds;
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      corner.set(x, y, z).applyMatrix4(model.group.matrixWorld).project(camera);
      if (corner.z > -1 && corner.z < 1) {
        vehicleBox.expandByPoint(corner.set((corner.x + 1) * width * 0.5, (1 - corner.y) * height * 0.5, 0));
      }
    }
  }

  function project(index, camera, width, height, models, jeepBounds) {
    const effect = effects[index];
    if (!effect.tow.visible) {
      effect.wakePosition = 0;
      return null;
    }
    const [a, b] = projected;
    a.copy(effect.wakeEdges[0]).project(camera);
    b.copy(effect.wakeEdges[1]).project(camera);
    if (![a, b].some(point => point.z > -1 && point.z < 1 && Math.abs(point.x) < 1.16 &&
      Math.abs(point.y) < 1.16)) return null;

    const labelWidth = THREE.MathUtils.clamp(width * 0.23, 122, 155);
    const halfWidth = labelWidth * 0.5;
    const halfHeight = 25;
    const margin = halfWidth + 12;
    const left = a.x < b.x ? a : b;
    const right = left === a ? b : a;
    const minY = Math.min(108, height * 0.37);
    const maxY = height - Math.min(78, height * 0.32);
    const positions = [0, -38, 38].flatMap(shift => [left, right].map((edge, i) => {
      const desiredX = (edge.x + 1) * width * 0.5 + (i * 2 - 1) * (halfWidth + 9);
      const desiredY = (1 - edge.y) * height * 0.5 - 9;
      const x = THREE.MathUtils.clamp(desiredX, margin, Math.max(margin, width - margin));
      const y = THREE.MathUtils.clamp(desiredY + shift, minY, maxY);
      return { x, y, cost: Math.abs(x - desiredX) + Math.abs(y - desiredY) };
    }));
    for (const model of models) {
      if (!model) continue;
      projectVehicle(model, jeepBounds, camera, width, height);
      for (const position of positions) {
        const { x, y } = position;
        const overlapX = Math.max(0, Math.min(x + halfWidth, vehicleBox.max.x) - Math.max(x - halfWidth, vehicleBox.min.x));
        const overlapY = Math.max(0, Math.min(y + halfHeight, vehicleBox.max.y) - Math.max(y - halfHeight, vehicleBox.min.y));
        position.cost += overlapX * overlapY * 0.16;
      }
    }
    // Preserve position through small changes in the amount of free space.
    let best = 0;
    for (const [position, candidate] of positions.entries()) {
      if (candidate.cost < positions[best].cost) best = position;
    }
    if (positions[best].cost + 22 < positions[effect.wakePosition].cost) effect.wakePosition = best;
    const { x, y } = positions[effect.wakePosition];
    return { x, y, width: labelWidth, rivalIndex: effect.rivalIndex };
  }

  return { update, project };
}
