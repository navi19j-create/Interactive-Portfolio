import { Color, EdgesGeometry, Group, LineBasicMaterial, LineSegments, MathUtils, SRGBColorSpace, TextureLoader } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { liveries } from './liveries.js';
import { separateBumpers } from './bumper-assemblies.js';
export { liveries } from './liveries.js';

const asset = (name) => new URL('../assets/jeep-race/' + name, document.baseURI).href;
const gltfLoader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const textureLoader = new TextureLoader();
let geometry;
const paintTextures = new Map();
const contours = new WeakMap();

function loadGeometry() {
  geometry ??= gltfLoader.loadAsync(asset('little-box.glb')).then((gltf) => {
    const chassis = separateBumpers(gltf.scene);
    // Relight the lenses on the source model once for all four liveries.
    chassis.getObjectByName('Body_Headlamp').material.emissiveIntensity = 4.2;
    chassis.getObjectByName('Body_Tail').material.emissiveIntensity = 3.8;
    return chassis;
  })
    .catch((error) => {
      geometry = undefined;
      throw error;
    });
  return geometry;
}

function loadPaint(name) {
  if (!paintTextures.has(name)) {
    paintTextures.set(name, textureLoader.loadAsync(asset(name + '.webp')).then((image) => {
      image.colorSpace = SRGBColorSpace;
      image.flipY = false;
      image.anisotropy = 4;
      image.needsUpdate = true;
      return image;
    }).catch((error) => {
      paintTextures.delete(name);
      throw error;
    }));
  }
  return paintTextures.get(name);
}

export async function createJeep(livery = 0) {
  const scheme = liveries[livery] ?? liveries[0];
  const [template, texture] = await Promise.all([loadGeometry(), loadPaint(scheme.texture)]);
  const vehicle = template.clone(true);
  const materials = new Map();
  const linedPanels = [];
  const outline = new LineBasicMaterial({ color: 0x0b1522, opacity: 0.42, transparent: true });
  vehicle.traverse((object) => {
    if (!object.isMesh) return;
    const source = object.material;
    if (source.name === 'Race_Paint' || source.name === 'Rims') {
      if (!materials.has(source)) {
        const material = source.clone();
        if (source.name === 'Race_Paint') {
          material.map = texture;
          material.emissive.set(0xffffff);
          material.emissiveMap = texture;
          material.emissiveIntensity = 0.23;
          material.onBeforeCompile = shader => {
            shader.uniforms.liveryRimTint = { value: new Color(scheme.color) };
            shader.fragmentShader = 'uniform vec3 liveryRimTint;\n' + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
              #include <lights_fragment_end>
              float grazingEdge = pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 2.35);
              vec3 rim = mix(vec3(0.06, 0.15, 0.18), liveryRimTint, 0.42);
              reflectedLight.indirectDiffuse += (rim * 0.43 + diffuseColor.rgb * 0.21) * grazingEdge;
            `);
          };
          material.metalness = 0.27;
          material.roughness = 0.40;
          material.polygonOffset = true;
          material.polygonOffsetFactor = 0.40;
          material.polygonOffsetUnits = 0.30;
        } else {
          material.color.set(scheme.color);
          material.metalness = 0.36;
          material.roughness = 0.46;
        }
        materials.set(source, material);
      }
      object.material = materials.get(source);
    }
    if (source.name === 'Race_Paint') linedPanels.push(object);
    object.castShadow = true;
    object.receiveShadow = true;
  });
  for (const object of linedPanels) {
    if (!contours.has(object.geometry)) contours.set(object.geometry, new EdgesGeometry(object.geometry, 57));
    object.add(new LineSegments(contours.get(object.geometry), outline));
  }
  const front = ['FL', 'FR'].map((corner) => vehicle.getObjectByName('Steer_' + corner));
  const wheelTags = ['FL', 'FR', 'RL', 'RR'];
  const wheels = wheelTags.map((corner) => vehicle.getObjectByName('Roll_' + corner));
  const parts = {
    frontBumper: vehicle.getObjectByName('frontBumper'),
    rearBumper: vehicle.getObjectByName('rearBumper'),
    ...Object.fromEntries(wheelTags.map((tag, index) => ['wheel' + tag, wheels[index]])),
  };
  const body = vehicle.getObjectByName('Chassis');
  const wheelRadius = wheels[2].position.y;
  const group = new Group();
  group.name = scheme.name;
  group.add(vehicle);
  const restHeight = body.position.y;
  const kick = { time: 0, pitch: 0, roll: 0, down: 0 };
  let activeMode = null;
  let activeCar = null;
  const repair = Object.entries(parts).map(([id, object]) => ({
    id, object, position: object.position.clone(), scale: object.scale.clone(),
    detached: false, progress: 1,
  }));

  return {
    group,
    parts,
    impact(side, severity, mode, reduced) {
      if (reduced) return;
      const scale = { light: 0.38, medium: 0.70, heavy: 1 }[severity] ?? 0.45;
      const response = (mode === 'arcade' ? 0.19 : 0.13) * scale;
      kick.time = 0;
      kick.pitch = side === 'front' ? response : side === 'rear' ? -response : response * 0.23;
      kick.roll = side === 'left' ? -response : side === 'right' ? response : response * 0.14;
      kick.down = scale * (mode === 'arcade' ? 0.16 : 0.10);
    },
    resetImpact() {
      kick.pitch = 0;
      kick.roll = 0;
      kick.down = 0;
    },
    update(car, dt = 0, mode = 'arcade', reduced = false) {
      const changed = mode !== activeMode || car !== activeCar;
      if (changed) {
        activeMode = mode;
        activeCar = car;
        this.resetImpact();
      }
      const off = mode === 'breakaway' ? car.detachedParts ?? [] : [];
      const step = MathUtils.clamp(dt, 0, 0.08);
      for (const part of repair) {
        const detached = off.includes(part.id);
        const wasRepairing = part.progress < 1;
        if (changed || reduced || detached) part.progress = 1;
        else if (part.detached) part.progress = 0;
        part.detached = detached;
        part.object.visible = !detached;
        if (part.progress === 1 && !changed && !wasRepairing) continue;
        part.progress = Math.min(1, part.progress + step / 0.21);
        const gap = (1 - part.progress) ** 2;
        part.object.position.copy(part.position);
        part.object.scale.copy(part.scale).multiplyScalar(1 - gap * 0.14);
        part.object.position.y += gap * 0.12;
        if (part.id.startsWith('wheel')) part.object.position.x += gap * (part.id.endsWith('L') ? 0.29 : -0.29);
        else part.object.position.z += gap * (part.id === 'frontBumper' ? 0.21 : -0.21);
      }
      // The source axle pivots remain level while the sprung body leans and heaves.
      const angle = -MathUtils.clamp(car.steer * 0.48, -0.48, 0.48);
      for (const pivot of front) pivot.rotation.y = angle;
      for (const wheel of wheels) wheel.rotation.x = (car.distance / wheelRadius) % (Math.PI * 2);
      kick.time += step;
      const damping = reduced ? 0 : Math.exp(-kick.time * 8.7);
      const spring = Math.cos(kick.time * 24) * damping;
      const leftMissing = Number(off.includes('wheelFL')) + Number(off.includes('wheelRL'));
      const rightMissing = Number(off.includes('wheelFR')) + Number(off.includes('wheelRR'));
      const frontMissing = Number(off.includes('wheelFL')) + Number(off.includes('wheelFR'));
      const rearMissing = Number(off.includes('wheelRL')) + Number(off.includes('wheelRR'));
      body.rotation.x = kick.pitch * spring + (frontMissing - rearMissing) * 0.12;
      body.rotation.z = -car.lean * 0.48 + kick.roll * spring + (rightMissing - leftMissing) * 0.14;
      body.position.y = restHeight - kick.down * damping - (leftMissing + rightMissing) * 0.10 + Math.sin(car.distance * 4.6) * Math.min(Math.abs(car.speed) * 0.0006, 0.016);
    },
    dispose() {
      outline.dispose();
      for (const material of materials.values()) material.dispose();
    },
  };
}


