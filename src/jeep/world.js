import * as THREE from 'three';
import { track } from './track.js';
import { decorateCircuit } from './circuit-art.js';
import { createJeep } from './jeeps.js';
import { createAirflow } from './airflow.js';
import { createImpactEffects } from './impact-effects.js';
import { createRaceView, passDistance, setTrackPosition } from './race-view.js';
import { createNightWeather } from './weather.js';

export { track };

const skyColor = 0x243b51;
const passGrid = [
  { s: passDistance, offset: -2.35 },
  { s: passDistance + 0.65, offset: 2.9 },
  { s: passDistance - 5.8, offset: -3.65 },
  { s: passDistance - 10.8, offset: 0.29 },
];
const coverGrid = [
  { s: 42, offset: -0.65 },
  { s: 36, offset: -3.6 },
  { s: 36.8, offset: 3.5 },
  { s: 32.2, offset: -0.65 },
];

function skyBackdrop() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(760, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        horizon: { value: new THREE.Color(skyColor) },
        zenith: { value: new THREE.Color(0x10172e) },
        cloudLight: { value: new THREE.Color(0x526c8b) },
      },
      vertexShader: `
        varying vec3 vSky;
        void main() {
          vSky = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }
      `,
      fragmentShader: `
        uniform vec3 zenith;
        uniform vec3 horizon;
        uniform vec3 cloudLight;
        varying vec3 vSky;
        void main() {
          vec3 direction = normalize(vSky);
          vec3 moon = normalize(vec3(-0.61, 0.44, 0.32));
          float proximity = max(dot(direction, moon), 0.);
          vec3 color = mix(horizon, zenith, clamp(sqrt(max(0., direction.y)) * 1.56, 0., 1.));
          color = mix(color, cloudLight, pow(proximity, 7.) * 0.28);
          float cloud = sin(dot(direction, vec3(18., 46., 8.)))
            * sin(dot(direction, vec3(6., 25., -12.)) + 1.1);
          color = mix(color, cloudLight * 0.52, smoothstep(-0.5, 0.86, cloud) * 0.11);
          gl_FragColor = vec4(color, 1.);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
}

function miniatureLens() {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    vertexShader: "varying vec2 screen; void main() { screen = position.xy; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: `
      varying vec2 screen;
      void main() {
        float edges = smoothstep(0.48, 1.23, length(screen * vec2(0.95, 1.0)));
        float bands = smoothstep(0.59, 1.0, abs(screen.y));
        gl_FragColor = vec4(mix(vec3(0.008, 0.016, 0.029), vec3(0.019, 0.025, 0.041), bands * 0.60),
          clamp(edges * 0.17 + bands * 0.08, 0., 0.26));
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, camera: new THREE.Camera() };
}

function contactShadows(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 10, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(21, 37, 48, 0.69)');
  gradient.addColorStop(0.7, 'rgba(21, 37, 48, 0.52)');
  gradient.addColorStop(1, 'rgba(21, 37, 48, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const geometry = new THREE.PlaneGeometry(3.25, 4.65);
  geometry.rotateX(-Math.PI / 2);
  return Array.from({ length: 4 }, () => {
    const shadow = new THREE.Mesh(geometry, material);
    shadow.visible = false;
    scene.add(shadow);
    return shadow;
  });
}

function disposeGraph(scene, extraResources = []) {
  const resources = new Set(extraResources);
  scene.traverse(mesh => {
    if (mesh.geometry) resources.add(mesh.geometry);
    for (const material of [mesh.material].flat()) {
      if (!material) continue;
      resources.add(material);
      for (const value of Object.values(material)) {
        if (value?.isTexture) resources.add(value);
      }
    }
  });
  resources.forEach(resource => resource.dispose());
}

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(skyColor, 0.0052);
  const sky = skyBackdrop();
  const lens = miniatureLens();
  // Let opaque scenery fill depth first so the sky shader only shades open sky.
  sky.renderOrder = 100;
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xcadfff, 1.24);
  const sunOffset = new THREE.Vector3(-29, 48, 19);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 42;
  sun.shadow.camera.bottom = -42;
  sun.shadow.camera.far = 138;
  sun.shadow.bias = -0.00008;
  sun.shadow.normalBias = 0.077;
  sun.shadow.intensity = 0.85;
  sun.shadow.radius = 2;
  scene.add(sun.target);
  const fill = new THREE.DirectionalLight(0xe9f2ff, 0.51);
  fill.position.set(6, 13, -27);
  scene.add(sun, fill, new THREE.HemisphereLight(0x9eb7e2, 0x676d8a, 1.21));
  const carGlints = Array.from({ length: 4 }, () => new THREE.Vector3());
  let circuit;
  try {
    circuit = decorateCircuit(scene, carGlints);
  } catch (error) {
    disposeGraph(scene);
    renderer.dispose();
    throw error;
  }
  const shadows = contactShadows(scene);
  const updateNightWeather = createNightWeather(scene, circuit.tracksideLights);
  const airflow = createAirflow(scene, setTrackPosition, shadows.length);
  const wakeCues = [null, null];

  let disposed = false;
  const models = [];
  const jeepBounds = new THREE.Box3();
  const impactEffects = createImpactEffects(scene, setTrackPosition, models);
  const ready = Promise.all(shadows.map(async (_, index) => {
    const model = await createJeep(index);
    if (disposed) {
      model.dispose?.();
      if (!model.dispose) disposeGraph(model.group);
      return;
    }
    models[index] = model;
    if (jeepBounds.isEmpty()) jeepBounds.setFromObject(model.group);
    scene.add(model.group);
  }));

  const views = [createRaceView(), createRaceView()];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let animationTime = 0;
  let pixelRatio = 0;
  let width = 0;
  let height = 0;
  let resolutionScale = 1;
  let sampleTime = 0;
  let sampleFrames = 0;
  let smoothSeconds = 0;

  function trackFramePacing(dt) {
    if (dt <= 0) return;
    sampleTime += dt;
    sampleFrames++;
    if (sampleTime < 1.5) return;
    const average = sampleTime / sampleFrames;
    if (average > 1 / 47) {
      resolutionScale = Math.max(0.7, resolutionScale - 0.1);
      smoothSeconds = 0;
    } else if (average < 1 / 57) {
      smoothSeconds += sampleTime;
      if (smoothSeconds >= 15) {
        resolutionScale = Math.min(1, resolutionScale + 0.1);
        smoothSeconds = 0;
      }
    } else {
      smoothSeconds = 0;
    }
    sampleTime = 0;
    sampleFrames = 0;
  }

  function resize(split = false) {
    const nextWidth = Math.max(1, canvas.clientWidth);
    const nextHeight = Math.max(1, canvas.clientHeight);
    const limit = split ? 1.25 : nextWidth < 680 ? 1.55 : 1.7;
    const ratio = Math.min(window.devicePixelRatio || 1, limit) * resolutionScale;
    if (width === nextWidth && height === nextHeight && ratio === pixelRatio) return;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = ratio;
    renderer.setDrawingBufferSize(width, height, pixelRatio);
  }

  function render(race, dt = 0, mode = 'race', preferences = {}) {
    if (disposed) return;
    const players = race.players ?? [race.player];
    const split = mode === 'race' && players.length === 2;
    if (mode === 'race') trackFramePacing(dt);
    resize(split);
    const portrait = width / height < 0.95;
    const cover = mode === 'cover';
    const pass = mode === 'pass-cover';
    animationTime += dt;
    circuit.updateSignals(race, animationTime);
    circuit.crowd.update(animationTime, mode === 'race' ? players : []);
    for (const [index, car] of race.cars.entries()) {
      const model = models[index];
      if (!model) continue;
      const placement = pass ? passGrid[index] : cover ? coverGrid[index] : car;
      const offset = cover && portrait && index === 3 ? 1.95 : placement.offset;
      const glint = Math.abs(offset) < track.width / 2 - 0.5 ? 0.057 : 0;
      carGlints[index].set(placement.s, offset, glint);
      const pose = setTrackPosition(model.group.position, placement.s, offset, 0.03);
      const grade = track.sample(placement.s + 0.85).y - track.sample(placement.s - 0.85).y;
      const pitch = -Math.atan2(grade, 1.7);
      model.group.rotation.set(pitch, Math.PI - pose.angle - (cover || pass ? 0 : car.heading), 0, 'YXZ');
      model.update(car, dt, mode === 'race' ? race.collisionMode : 'arcade', impactEffects.reducedMotion.matches);

      const shadow = shadows[index];
      shadow.visible = Math.abs(car.offset) <= track.width / 2 + 2.8;
      shadow.position.copy(model.group.position);
      shadow.position.y += 0.013;
      shadow.rotation.copy(model.group.rotation);
      shadow.rotation.z = 0;
    }
    airflow.update(race, animationTime, mode === 'race' && race.phase === 'racing', models);
    impactEffects.update(race, dt, mode);
    const cameraMode = preferences.cameraMode === 'isometric' || preferences.cameraMode === 'miniature'
      ? preferences.cameraMode : 'chase';
    const stacked = preferences.layout === 'stacked' || (preferences.layout !== 'side-by-side' && width < 900);
    const cut = Math.max(1, Math.floor((stacked ? height : width) / 2));
    const panes = !split ? [[0, 0, width, height]]
      : stacked ? [[0, height - cut, width, cut], [0, 0, width, height - cut]]
      : [[0, 0, cut, height], [cut, 0, width - cut, height]];
    const cameras = panes.map((pane, index) => views[index].frame(
      players[index], dt, Math.max(1, pane[2]) / Math.max(1, pane[3]), mode, cameraMode,
      reducedMotion.matches, circuit.groundHeight,
    ));

    // Share one shadow map across both views and expand it for nearby racers.
    // Contact shadows keep each vehicle grounded if the racers are far apart.
    sun.target.position.copy(views[0].focus);
    const distance = split ? views[0].focus.distanceTo(views[1].focus) : 0;
    const extension = Math.min(50, distance * 0.45);
    const bounds = sun.shadow.camera;
    if (bounds.right !== 35 + extension) {
      bounds.left = -(35 + extension);
      bounds.right = 35 + extension;
      bounds.top = 42 + extension;
      bounds.bottom = -(42 + extension);
      bounds.updateProjectionMatrix();
    }
    if (split) sun.target.position.lerp(views[1].focus, 0.5);
    sun.shadow.intensity = 0.69 * (1 - THREE.MathUtils.smoothstep(distance, 87, 149));
    sun.target.position.divideScalar(0.15).round().multiplyScalar(0.15);
    sun.position.copy(sun.target.position).add(sunOffset);
    renderer.shadowMap.needsUpdate = sun.shadow.intensity > 0;
    const diorama = mode === 'race' && cameraMode === 'miniature';
    const elevated = mode === 'race' && cameraMode !== 'chase' && race.phase !== 'countdown';
    scene.fog.density = diorama ? 0.0064 : 0.00565;
    renderer.setScissorTest(split);
    for (const [index, camera] of cameras.entries()) {
      const pane = panes[index];
      renderer.setViewport(...pane);
      if (split) renderer.setScissor(...pane);
      circuit.exposeCars(camera, elevated ? players[index] : null);
      sky.position.copy(camera.position);
      updateNightWeather(camera, views[index].focus, animationTime, reducedMotion.matches);
      renderer.render(scene, camera);
      wakeCues[index] = airflow.project(index, camera, pane[2], pane[3], models, jeepBounds);
      if (diorama) {
        renderer.autoClear = false;
        renderer.render(lens.scene, lens.camera);
        renderer.autoClear = true;
      }
    }
    renderer.setScissorTest(false);
    circuit.exposeCars(null, null);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const model of models) {
      if (model?.dispose) {
        scene.remove(model.group);
        model.dispose();
      }
    }
    disposeGraph(scene, circuit.signalResources);
    disposeGraph(lens.scene);
    sun.shadow.dispose();
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
  }

  function react(events, race) {
    if (disposed || !events?.length) return;
    circuit.crowd.react(events, race, animationTime);
    impactEffects.react(events, race);
  }

  return { ready, render, resize, react, dispose, wakeCues };
}
