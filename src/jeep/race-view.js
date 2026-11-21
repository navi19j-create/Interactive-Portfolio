import * as THREE from 'three';
import { track } from './track.js';

const laSource = track.turns.find(turn => turn.name === 'La Source').s;
const eauRouge = track.turns.find(turn => turn.name === 'Eau Rouge').s;
const raidillon = track.turns.find(turn => turn.name === 'Raidillon').s;
const kemmelStart = track.turns.find(turn => turn.name === 'Kemmel Straight').s;
export const passDistance = kemmelStart + 58;

export function setTrackPosition(vector, s, offset, up = 0) {
  const pose = track.sample(s);
  vector.set(
    pose.x + Math.cos(pose.angle) * offset,
    pose.y + up,
    -pose.z + Math.sin(pose.angle) * offset,
  );
  return pose;
}

export function createRaceView() {
  const perspective = new THREE.PerspectiveCamera(53, 1, 0.18, 850);
  const orthographic = new THREE.OrthographicCamera(-13, 13, 13, -13, 0.18, 850);
  const eye = new THREE.Vector3();
  let priorAspect;
  let priorPlayer;
  const look = new THREE.Vector3();
  const eyeTarget = new THREE.Vector3();
  const aimTarget = new THREE.Vector3();
  const eyeVelocity = new THREE.Vector3();
  const aimVelocity = new THREE.Vector3();
  const error = new THREE.Vector3();
  const playerCenter = new THREE.Vector3();
  const cameraGuide = new THREE.Vector3();
  const centerBearing = new THREE.Vector3();
  const nextVelocity = new THREE.Vector3();
  let previousMode;
  let previousDistance;

  function damp(position, target, velocity, rate, dt) {
    const decay = Math.exp(-rate * dt);
    error.subVectors(position, target);
    nextVelocity.copy(velocity).addScaledVector(error, rate);
    position.copy(target).addScaledVector(error, decay).addScaledVector(nextVelocity, dt * decay);
    velocity.addScaledVector(nextVelocity, -dt * rate).multiplyScalar(decay);
  }

  function frame(player, dt, aspect, mode, cameraMode, reduced, groundHeight) {
    const s = ((player.s % track.length) + track.length) % track.length;
    const racing = mode === 'race' && cameraMode === 'chase';
    const isometric = mode === 'race' && cameraMode === 'isometric';
    const miniature = mode === 'race' && cameraMode === 'miniature';
    const camera = isometric ? orthographic : perspective;
    const portrait = aspect < 0.95;
    const view = mode === 'race' ? cameraMode : mode;
    const cover = mode === 'cover';
    const pass = mode === 'pass-cover';
    const descent = THREE.MathUtils.lerp(laSource, eauRouge, 0.37);
    const valleyView = racing
      ? THREE.MathUtils.smoothstep(s, descent, eauRouge + 10)
        * (1 - THREE.MathUtils.smoothstep(s, raidillon + 16, kemmelStart + 44))
      : 0;
    const baseFov = portrait ? 66 : 53;
    const fov = miniature ? (portrait ? 49 : 39) : racing && reduced
      ? baseFov + (portrait ? 2 : 3)
      : baseFov + valleyView * 5.7;
    if (isometric) {
      if (aspect !== priorAspect || view !== previousMode) {
        const span = Math.max(23, 20.5 / aspect);
        camera.left = -span * aspect / 2;
        camera.right = span * aspect / 2;
        camera.top = span / 2;
        camera.bottom = -span / 2;
        camera.updateProjectionMatrix();
      }
    } else if (camera.aspect !== aspect || Math.abs(camera.fov - fov) > 0.001) {
      camera.aspect = aspect;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (pass) {
      setTrackPosition(eyeTarget, passDistance + (portrait ? 13.2 : 8.3), portrait ? -3.2 : -6.85, portrait ? 3.58 : 2.92);
      setTrackPosition(aimTarget, passDistance - 5.4, -0.05, 1.90);
    } else if (cover) {
      setTrackPosition(eyeTarget, portrait ? 55.5 : 51.75, portrait ? -3.3 : -6.08, portrait ? 4.65 : 4.12);
      setTrackPosition(aimTarget, 34.4, -0.20, portrait ? 2.58 : 2.16);
    } else if (mode === 'preview') {
      const inside = player.offset < 0;
      setTrackPosition(eyeTarget, player.s + (portrait ? 8.5 : 8), inside ? -5.4 : -7.9, portrait ? 3.65 : 3.8);
      setTrackPosition(aimTarget, player.s - (portrait ? 1.2 : 3.6), player.offset * 0.49, 1.13);
    } else if (isometric || miniature) {
      const offset = THREE.MathUtils.clamp(player.offset, -4.3, 4.3);
      const lead = miniature ? 8.1 + player.speed * 0.13 : 5.6 + player.speed * 0.09;
      setTrackPosition(aimTarget, player.s + lead, offset * 0.40, 0.55);
      const road = track.sample(player.s);
      const orbit = track.sample(player.s + 2.8).angle + (miniature ? 0.70 : Math.PI / 4);
      const span = miniature ? 45 : 25;
      eyeTarget.set(
        aimTarget.x - Math.sin(orbit) * span,
        Math.max(aimTarget.y, road.y) + (miniature ? 27 : span * Math.SQRT1_2),
        aimTarget.z + Math.cos(orbit) * span,
      );
      eyeTarget.y = Math.max(eyeTarget.y, groundHeight(eyeTarget.x, eyeTarget.z) + 8);
      aimTarget.y = THREE.MathUtils.lerp(road.y + 0.55, aimTarget.y, 0.62);
    } else {
      const follow = (portrait ? 8.7 : 8.3) + valleyView * 1.38;
      const offset = THREE.MathUtils.clamp(player.offset, -4.3, 4.3);
      const steer = THREE.MathUtils.clamp(player.heading, -0.8, 0.8);
      setTrackPosition(eyeTarget, player.s - follow, offset * 0.72 - steer * 0.55, portrait ? 5.24 : 4.66);
      const ahead = 8.0 + player.speed * 0.26;
      setTrackPosition(aimTarget, player.s + ahead, offset * 0.34 + steer * 1.45, portrait ? -0.22 : 0.21);
      const road = track.sample(player.s);
      const floor = road.y + (portrait ? 4.8 : 4.26);
      const clearance = floor - eyeTarget.y;
      const blend = valleyView * 0.76;
      if (clearance >= blend) eyeTarget.y = floor;
      else if (clearance > -blend) eyeTarget.y += (clearance + blend) ** 2 / (4 * blend);
      aimTarget.y = THREE.MathUtils.lerp(road.y + 0.27, aimTarget.y, 0.65);
    }

    const rawDelta = previousDistance == null ? 0 : Math.abs(player.s - previousDistance);
    const teleport = Math.min(rawDelta, Math.abs(rawDelta - track.length)) > 13;
    if (view !== previousMode || player !== priorPlayer || teleport) {
      eye.copy(eyeTarget);
      look.copy(aimTarget);
      eyeVelocity.set(0, 0, 0);
      aimVelocity.set(0, 0, 0);
    } else {
      const step = THREE.MathUtils.clamp(dt, 0, 0.05);
      damp(eye, eyeTarget, eyeVelocity, miniature ? 7 : 12, step);
      damp(look, aimTarget, aimVelocity, miniature ? 7 : 9, step);
    }
    previousMode = view;
    priorAspect = aspect;
    priorPlayer = player;
    camera.position.copy(eye);
    previousDistance = player.s;
    if (racing) {
      setTrackPosition(playerCenter, player.s, player.offset, 1.52);
      centerBearing.subVectors(playerCenter, camera.position);
      cameraGuide.subVectors(look, camera.position);
      const centerYaw = Math.atan2(centerBearing.x, centerBearing.z);
      const desiredYaw = Math.atan2(cameraGuide.x, cameraGuide.z);
      const yawChange = Math.atan2(Math.sin(desiredYaw - centerYaw), Math.cos(desiredYaw - centerYaw));
      const yawLimit = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect * 0.4);
      const yaw = centerYaw + THREE.MathUtils.clamp(yawChange, -yawLimit, yawLimit);
      const centerPitch = Math.atan2(centerBearing.y, Math.hypot(centerBearing.x, centerBearing.z));
      const desiredPitch = Math.atan2(cameraGuide.y, Math.hypot(cameraGuide.x, cameraGuide.z));
      const pitch = THREE.MathUtils.clamp(desiredPitch, centerPitch + 0.052, centerPitch + (portrait ? 0.17 : 0.18) + valleyView * 0.042);
      cameraGuide.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(cameraGuide.add(camera.position));
    } else {
      camera.lookAt(look);
    }
    return camera;
  }

  return { frame, focus: look };
}