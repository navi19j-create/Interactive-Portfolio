import * as THREE from 'three';
import { track } from './track.js';

const up = new THREE.Vector3(0, 1, 0);
const shirtColors = [0xdd574e, 0xffbd51, 0x54bbc1, 0xf3ddab, 0xd87b8e];
const eventStyle = {
  raceStart: { duration: 2.85, height: 1.0, priority: 2 },
  pass: { duration: 1.83, height: 0.79, priority: 1 },
  playerFinish: { duration: 4.10, height: 1.0, priority: 3 },
};

function trackGap(a, b) {
  return ((a - b + track.length * 0.5) % track.length + track.length) % track.length - track.length * 0.5;
}

function flagShape() {
  const vertices = [
    0, -0.22, 0, 0.92, -0.28, 0.13, 0.80, 0.25, 0.16,
    0, -0.22, 0, 0.80, 0.25, 0.16, 0, 0.28, 0,
    0, 0.09, 0.006, 0.83, 0.08, 0.167, 0.81, 0.20, 0.172,
    0, 0.09, 0.006, 0.81, 0.20, 0.172, 0, 0.21, 0.006,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const paint = [];
  for (let i = 0; i < vertices.length / 3; i++) paint.push(...(i < 6 ? [0.85, 0.81, 0.72] : [1, 1, 1]));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(paint, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function createCrowd(scene) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sleeveGeometry = new THREE.BoxGeometry(0.13, 1, 0.13);
  const gloveGeometry = new THREE.BoxGeometry(0.15, 0.15, 0.15);
  const flagGeometry = flagShape();
  const staffGeometry = new THREE.BoxGeometry(0.042, 1, 0.042);
  const staffMaterial = new THREE.MeshStandardMaterial({ color: 0xe3b27e, roughness: 0.88 });
  const sleeveMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.83 });
  const gloveMaterial = new THREE.MeshStandardMaterial({ color: 0xe9b17f, roughness: 0.83 });
  const flagMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, roughness: 0.86,
  });
  const groupList = [];
  const transform = new THREE.Object3D();
  const origin = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const arm = new THREE.Vector3();

  function addStand(s, side, yaw, seats) {
    if (!seats.length) return;
    let flags = 0;
    const fans = seats.map((seat, i) => {
      const peak = i % 4 === 0 && seat.row < 4;
      return {
        ...seat, peak,
        phase: (i * 0.61803399) % 1,
        flagIndex: peak ? flags++ : -1,
      };
    });
    const sleeves = new THREE.InstancedMesh(sleeveGeometry, sleeveMaterial, fans.length * 2);
    const hands = new THREE.InstancedMesh(gloveGeometry, gloveMaterial, fans.length * 2);
    const cloth = new THREE.InstancedMesh(flagGeometry, flagMaterial, flags);
    const staffs = new THREE.InstancedMesh(staffGeometry, staffMaterial, flags);
    const group = { s, side, yaw, fans, sleeves, hands, cloth, staffs, trigger: null, lastAmbient: -Infinity, raised: false, visible: true };
    for (const batch of [sleeves, hands, cloth, staffs]) {
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(batch);
    }
    const tint = new THREE.Color();
    for (const [i, fan] of fans.entries()) {
      tint.setHex(fan.paint);
      sleeves.setColorAt(i * 2, tint);
      sleeves.setColorAt(i * 2 + 1, tint);
      if (fan.peak) cloth.setColorAt(fan.flagIndex, tint.setHex(shirtColors[fan.flagIndex % shirtColors.length]));
    }
    const bounds = new THREE.Box3();
    for (const fan of fans) {
      const [x, y, z] = fan.position;
      bounds.expandByPoint(new THREE.Vector3(x, y, z));
    }
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    sphere.radius += 2.8;
    for (const batch of [sleeves, hands, cloth, staffs]) batch.boundingSphere = sphere;
    groupList.push(group);
    pose(group, Infinity, reducedMotion.matches);
  }

  function pose(group, time, reduced) {
    const { fans, yaw, side, sleeves, hands, cloth, staffs, trigger } = group;
    const alongX = Math.sin(yaw);
    const alongZ = Math.cos(yaw);
    const towardX = side * alongZ;
    const towardZ = -side * alongX;

    for (const [i, fan] of fans.entries()) {
      const phase = trigger ? time - trigger.at - fan.phase * 0.37 : -1;
      const active = Boolean(trigger && time >= trigger.at && phase <= trigger.duration && (!trigger.ambient || fan.phase < 0.32));
      const lift = active ? reduced ? trigger.height : trigger.height
        * THREE.MathUtils.smoothstep(phase, -0.14, 0.17)
        * (1 - THREE.MathUtils.smoothstep(phase, trigger.duration - 0.52, trigger.duration))
        : fan.peak && fan.phase < 0.28 ? 0.34 : 0;
      const pulse = reduced ? fan.phase : phase * 8.2 + fan.phase * 4;
      const beat = Math.sin(pulse);
      const [x, y, z] = fan.position;
      for (const direction of [-1, 1]) {
        const index = i * 2 + Number(direction === 1);
        const shoulderAcross = direction * 0.134;
        origin.set(x + alongX * shoulderAcross, y, z + alongZ * shoulderAcross);
        const bow = direction * (0.024 + lift * (0.17 + beat * 0.13));
        const reach = 0.24 + 0.22 * lift;
        tip.set(
          origin.x + reach * towardX + bow * alongX,
          origin.y - 0.23 + lift * (0.87 + 0.09 * beat),
          origin.z + reach * towardZ + bow * alongZ,
        );
        arm.subVectors(tip, origin);
        transform.position.copy(origin).addScaledVector(arm, 0.5);
        transform.scale.set(1, arm.length(), 1);
        transform.quaternion.setFromUnitVectors(up, arm.normalize());
        transform.updateMatrix();
        sleeves.setMatrixAt(index, transform.matrix);
        transform.position.copy(tip);
        transform.scale.setScalar(1);
        transform.rotation.set(0, yaw, 0);
        transform.updateMatrix();
        hands.setMatrixAt(index, transform.matrix);
        if (fan.peak && direction === -1) {
          const rise = 0.24 + lift * 0.37;
          const lean = beat * lift * 0.18;
          arm.set(alongX * lean, rise, alongZ * lean);
          transform.position.copy(tip).addScaledVector(arm, 0.5);
          transform.scale.set(1, arm.length() + 0.19, 1);
          transform.quaternion.setFromUnitVectors(up, origin.copy(arm).normalize());
          transform.updateMatrix();
          staffs.setMatrixAt(fan.flagIndex, transform.matrix);
          transform.position.copy(tip).add(arm);
          transform.rotation.set(0.06, yaw + Math.PI + beat * lift * 0.48, 0.58 - lift * (0.41 + beat * 0.31), 'YXZ');
          transform.scale.setScalar(0.52 + lift * 0.83);
          transform.updateMatrix();
          cloth.setMatrixAt(fan.flagIndex, transform.matrix);
        }
      }
    }
    for (const batch of [sleeves, hands, cloth, staffs]) batch.instanceMatrix.needsUpdate = true;
  }

  function react(events, race, time) {
    for (const event of events) {
      const style = eventStyle[event.type];
      if (!style) continue;
      const pass = event.type === 'pass';
      let s = track.gridS;
      if (pass) {
        const passer = race.cars.find(car => car.id === event.passerId);
        const passed = race.cars.find(car => car.id === event.passedId);
        if (!passer || !passed) continue;
        s = passer.s - trackGap(passer.s, passed.s) * 0.5;
      }
      for (const group of groupList) {
        const delta = trackGap(group.s, s);
        if (pass ? Math.abs(delta) > 74 : delta < -7 || delta > 60) continue;
        if (group.trigger && group.trigger.at + group.trigger.duration > time && group.trigger.priority >= style.priority) continue;
        const delay = pass ? Math.abs(delta) * 0.006 : Math.max(0, delta) * 0.013;
        group.trigger = { ...style, at: time + delay };
      }
    }
  }

  function update(time, players) {
    const reduced = reducedMotion.matches;
    for (const group of groupList) {
      let delta = players.length ? Infinity : 0;
      let entering = false;
      for (const player of players) {
        const gap = trackGap(group.s, player.s);
        if (Math.abs(gap) < Math.abs(delta)) delta = gap;
        entering ||= player.speed > 7 && gap >= 5 && gap <= 45;
      }
      const visible = Math.abs(delta) < 126;
      if (visible !== group.visible) {
        group.visible = visible;
        for (const batch of [group.sleeves, group.hands, group.cloth, group.staffs]) batch.visible = visible;
      }
      if (!players.length) continue;
      if (!group.trigger && entering && time - group.lastAmbient > 9) {
        group.lastAmbient = time;
        group.trigger = { at: time + 0.09, ambient: true, duration: 2.12, height: 0.83, priority: 0 };
      }
      if (!group.trigger || time < group.trigger.at) continue;
      if (time > group.trigger.at + group.trigger.duration + 0.38) {
        group.trigger = null;
        if (group.raised) pose(group, time, reduced);
        group.raised = false;
      } else if (visible && (!reduced || group.trigger.motionPose !== reduced)) {
        group.raised = true;
        pose(group, time, reduced);
        group.trigger.motionPose = reduced;
      }
    }
  }

  return { addStand, react, update };
}
