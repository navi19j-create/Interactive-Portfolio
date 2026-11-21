import * as THREE from 'three';
import { track } from './track.js';

const railOffset = track.width / 2 + 3.83;

function offsetPoint(s, offset, height = 0) {
  const { x, y, z, angle } = track.sample(s);
  return new THREE.Vector3(x + Math.cos(angle) * offset, y + height, -z + Math.sin(angle) * offset);
}

export function getTracksideLights(groundHeight) {
  const count = Math.round(track.length / 30);
  const lights = [];
  for (let i = 0; i < count; i++) {
    const s = 5 + i * track.length / count;
    // Keep the mast out of the start gantry and pit garage frontage.
    const side = s < 73 ? -1 : i % 2 === 0 ? 1 : -1;
    const setback = side * (railOffset + 0.95);
    const foot = offsetPoint(s, setback);
    foot.y = groundHeight(foot.x, foot.z) - 0.16;
    const head = offsetPoint(s, setback - side * 0.46, 7.45);
    const target = offsetPoint(s + 2.5, -side * 0.7, 0.04);
    lights.push({ s, side, foot, head, target });
  }
  return lights;
}

export function addTracksideFixtures(scene, locations) {
  const geometry = new THREE.BoxGeometry();
  const makeBatch = (name, material, count) => {
    const batch = new THREE.InstancedMesh(geometry, material, count);
    batch.name = name;
    scene.add(batch);
    return batch;
  };
  const masts = makeBatch('Floodlight masts and plinths',
    new THREE.MeshStandardMaterial({ color: 0x30475a, metalness: 0.36, roughness: 0.41 }), locations.length * 3);
  const heads = makeBatch('Floodlight housings',
    new THREE.MeshStandardMaterial({ color: 0x203141, metalness: 0.35, roughness: 0.42 }), locations.length);
  const lenses = makeBatch('Floodlight twin lenses',
    new THREE.MeshBasicMaterial({ color: 0xd5edff, toneMapped: false }), locations.length * 2);
  const markers = makeBatch('Floodlight end markers',
    new THREE.MeshBasicMaterial({ color: 0x80abce, toneMapped: false }), locations.length * 2);
  const part = new THREE.Object3D();
  const local = new THREE.Vector3();
  const set = (mesh, index, x, y, z, width, height, depth) => {
    part.position.set(x, y, z);
    part.scale.set(width, height, depth);
    part.updateMatrix();
    mesh.setMatrixAt(index, part.matrix);
  };
  for (const [index, { foot, head, target }] of locations.entries()) {
    const mastHeight = head.y - foot.y;
    part.rotation.set(0, 0, 0);
    set(masts, index * 3, foot.x, foot.y + 0.23, foot.z, 0.54, 0.46, 0.54);
    set(masts, index * 3 + 1, foot.x, foot.y + mastHeight / 2, foot.z, 0.19, mastHeight, 0.19);
    part.rotation.y = Math.atan2(head.x - foot.x, head.z - foot.z);
    set(masts, index * 3 + 2, (head.x + foot.x) / 2, head.y - 0.21, (head.z + foot.z) / 2, 0.19, 0.18, 0.68);
    part.position.copy(head);
    part.lookAt(target);
    local.set(0, 0, -0.13).applyQuaternion(part.quaternion).add(head);
    set(heads, index, local.x, local.y, local.z, 1.52, 0.48, 0.36);
    for (const [lens, x] of [-0.37, 0.37].entries()) {
      local.set(x, 0, 0.064).applyQuaternion(part.quaternion).add(head);
      set(lenses, index * 2 + lens, local.x, local.y, local.z, 0.65, 0.32, 0.045);
      local.set(Math.sign(x) * 0.765, 0.025, -0.13).applyQuaternion(part.quaternion).add(head);
      set(markers, index * 2 + lens, local.x, local.y, local.z, 0.032, 0.10, 0.26);
    }
  }
}
